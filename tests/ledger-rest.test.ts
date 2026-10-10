import { describe, expect, it } from "vitest";
import { createSupabaseLedger, LedgerError } from "../src/lib/ledger";
import { mockFetch } from "./helpers";

const URL_ = "https://abcdefghij.supabase.co";
const GIFT_ROW = {
  id: "g1",
  reference: "mz_ref_12345678",
  church_id: "c1",
  amount_pesewas: 10_000,
  fee_pesewas: 150,
  total_pesewas: 10_150,
};

function ledger(replies: Parameters<typeof mockFetch>[0], key = "sb_secret_abc") {
  const m = mockFetch(replies);
  return { l: createSupabaseLedger({ url: `${URL_}/`, serviceKey: key, fetchFn: m.fn }), calls: m.calls };
}

describe("supabase ledger", () => {
  it("sends the secret key as apikey only for new-style keys", async () => {
    const { l, calls } = ledger([{ json: [GIFT_ROW] }]);
    await l.findGiftByReference("mz_ref_12345678");
    expect(calls[0]!.headers.apikey).toBe("sb_secret_abc");
    expect(calls[0]!.headers.Authorization).toBeUndefined();
  });

  it("also sends Authorization for legacy JWT keys", async () => {
    const { l, calls } = ledger([{ json: [GIFT_ROW] }], "eyJhbGciOi.payload.sig");
    await l.findGiftByReference("mz_ref_12345678");
    expect(calls[0]!.headers.Authorization).toBe("Bearer eyJhbGciOi.payload.sig");
  });

  it("finds a gift and returns whole pesewas", async () => {
    const { l, calls } = ledger([{ json: [GIFT_ROW] }]);
    const gift = await l.findGiftByReference("mz_ref_12345678");
    expect(gift).toEqual({
      id: "g1",
      reference: "mz_ref_12345678",
      churchId: "c1",
      amountPesewas: 10_000,
      feePesewas: 150,
      totalPesewas: 10_150,
    });
    expect(calls[0]!.url).toContain("/rest/v1/gifts?reference=eq.mz_ref_12345678");
  });

  it("returns null when there is no such gift", async () => {
    const { l } = ledger([{ json: [] }]);
    expect(await l.findGiftByReference("nope_nope_nope")).toBeNull();
  });

  it("encodes a hostile reference so it cannot change the query", async () => {
    const { l, calls } = ledger([{ json: [] }]);
    await l.findGiftByReference("a&select=*&limit=1000");
    expect(calls[0]!.url).toContain("reference=eq.a%26select%3D*%26limit%3D1000");
    expect(calls[0]!.url.match(/select=/g)).toHaveLength(1);
  });

  it("creates a gift with the total worked out from whole pesewas", async () => {
    const { l, calls } = ledger([{ status: 201, json: [GIFT_ROW] }]);
    await l.createGift({ reference: "mz_ref_12345678", churchId: "c1", giftType: "tithe", amountPesewas: 10_000, feePesewas: 150 });
    expect(calls[0]!.body).toMatchObject({ amount_pesewas: 10_000, fee_pesewas: 150, total_pesewas: 10_150, gift_type: "tithe" });
  });

  it("refuses to create a gift with a decimal amount", async () => {
    const { l, calls } = ledger([]);
    await expect(
      l.createGift({ reference: "mz_ref_12345678", churchId: "c1", giftType: "tithe", amountPesewas: 100.5, feePesewas: 0 }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("adds an event, and reports a repeated provider event as a duplicate", async () => {
    const { l } = ledger([{ status: 201, json: {} }, { status: 409, json: { code: "23505" } }]);
    const event = { giftId: "g1", status: "succeeded" as const, providerEventId: "paystack:charge.success:1" };
    expect(await l.addEvent(event)).toBe("added");
    expect(await l.addEvent(event)).toBe("duplicate");
  });

  it("does not treat other conflicts or errors as duplicates", async () => {
    const { l } = ledger([{ status: 409, json: { code: "23503" } }, { status: 500, json: {} }]);
    const event = { giftId: "g1", status: "succeeded" as const };
    await expect(l.addEvent(event)).rejects.toThrow(LedgerError);
    await expect(l.addEvent(event)).rejects.toThrow(LedgerError);
  });

  it("reads the current status", async () => {
    const { l } = ledger([{ json: [{ status: "succeeded", was_paid: true }] }]);
    expect(await l.currentStatus("mz_ref_12345678")).toEqual({ status: "succeeded", wasPaid: true });
  });

  it("creates the test church once, and finds it afterwards", async () => {
    const first = ledger([{ json: [] }, { status: 201, json: [{ id: "c9" }] }]);
    expect(await first.l.getOrCreateChurch("maizz-test-church", "Maizz Test Church")).toBe("c9");
    const second = ledger([{ json: [{ id: "c9" }] }]);
    expect(await second.l.getOrCreateChurch("maizz-test-church", "Maizz Test Church")).toBe("c9");
    expect(second.calls).toHaveLength(1);
  });

  it("refuses a database row that is not whole pesewas", async () => {
    const { l } = ledger([{ json: [{ ...GIFT_ROW, amount_pesewas: 10.5 }] }]);
    await expect(l.findGiftByReference("mz_ref_12345678")).rejects.toThrow();
  });
});
