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
  created_at: "2026-10-10T10:00:00+00:00",
};

const CHURCH_ROW = { id: "c1", slug: "grace", name: "Grace", status: "active", provider_subaccount_code: null };

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
      createdAt: "2026-10-10T10:00:00+00:00",
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
    const { l } = ledger([{ json: [{ status: "succeeded", was_paid: true, refunded_pesewas: 0 }] }]);
    expect(await l.currentStatus("mz_ref_12345678")).toEqual({ status: "succeeded", wasPaid: true, refundedPesewas: 0 });
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

describe("supabase ledger: churches and givers", () => {
  it("finds a church without ever creating one", async () => {
    const { l, calls } = ledger([{ json: [CHURCH_ROW] }, { json: [] }]);
    expect(await l.findChurch("grace")).toEqual({
      id: "c1",
      slug: "grace",
      name: "Grace",
      status: "active",
      subaccountCode: null,
      payoutBankName: null,
      payoutAccountLast4: null,
      payoutAccountName: null,
    });
    expect(await l.findChurch("nope")).toBeNull();
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("creates a giver with name and number only", async () => {
    const { l, calls } = ledger([{ status: 201, json: [{ id: "u1" }] }]);
    expect(await l.createGiver({ fullName: "Ama", phone: "0551234987" })).toBe("u1");
    expect(calls[0]!.body).toEqual({ full_name: "Ama", phone: "0551234987" });
  });

  it("links a gift to a giver, or leaves it unlinked", async () => {
    const { l, calls } = ledger([{ status: 201, json: [GIFT_ROW] }, { status: 201, json: [GIFT_ROW] }]);
    const base = { reference: "mz_ref_12345678", churchId: "c1", giftType: "seed" as const, amountPesewas: 100, feePesewas: 2 };
    await l.createGift({ ...base, giverId: "u1" });
    await l.createGift(base);
    expect((calls[0]!.body as Record<string, unknown>).giver_id).toBe("u1");
    expect((calls[1]!.body as Record<string, unknown>).giver_id).toBeNull();
  });
});

describe("supabase ledger: lists for the daily check", () => {
  it("lists unsettled gifts oldest first, with limits encoded", async () => {
    const { l, calls } = ledger([{ json: [{ ...GIFT_ROW, id: "g1" }] }]);
    const gifts = await l.listUnsettled({ olderThanMinutes: 10, newerThanDays: 3, limit: 50 });
    expect(gifts).toHaveLength(1);
    const url = calls[0]!.url;
    expect(url).toContain("gift_status?status=eq.pending");
    expect(url).toContain("order=created_at.asc");
    expect(url).toContain("limit=50");
    expect(url).toMatch(/created_at=lt\.\d{4}-\d{2}-\d{2}T/);
  });

  it("lists recent paid gifts", async () => {
    const { l, calls } = ledger([{ json: [{ ...GIFT_ROW, id: "g1" }] }]);
    await l.listRecentPaid({ sinceDays: 3, limit: 20 });
    expect(calls[0]!.url).toContain("was_paid=eq.true");
  });
});

describe("supabase ledger: church accounts", () => {
  it("creates a church as pending, and refuses a taken address", async () => {
    const a = ledger([{ status: 201, json: [{ ...CHURCH_ROW, status: "pending" }] }]);
    expect((await a.l.createChurch({ slug: "grace", name: "Grace" })).status).toBe("pending");
    expect(a.calls[0]!.body).toEqual({ slug: "grace", name: "Grace" });
    const b = ledger([{ status: 409, json: { code: "23505" } }]);
    await expect(b.l.createChurch({ slug: "grace", name: "Grace" })).rejects.toThrow(/already exists/);
  });

  it("lists churches", async () => {
    const { l } = ledger([{ json: [CHURCH_ROW, { ...CHURCH_ROW, id: "c2", slug: "two", status: "pending" }] }]);
    const all = await l.listChurches();
    expect(all.map((c) => c.status)).toEqual(["active", "pending"]);
  });

  it("refuses a church row with an unknown status", async () => {
    const { l } = ledger([{ json: [{ ...CHURCH_ROW, status: "open" }] }]);
    await expect(l.findChurch("grace")).rejects.toThrow(LedgerError);
  });

  it("saves payout details with only the last four digits, and changes status", async () => {
    const { l, calls } = ledger([{ json: [{ id: "c1" }] }, { json: [{ id: "c1" }] }, { json: [] }]);
    await l.setChurchPayout("c1", { subaccountCode: "ACCT_abc", bankCode: "MTN", bankName: "MTN", accountLast4: "4987", accountName: "Grace" });
    await l.setChurchStatus("c1", "active");
    expect(calls[0]!.method).toBe("PATCH");
    expect(calls[0]!.url).toContain("churches?id=eq.c1");
    expect(JSON.stringify(calls[0]!.body)).not.toContain("0551234987");
    expect(calls[1]!.body).toEqual({ status: "active" });
    await expect(l.setChurchStatus("nope", "active")).rejects.toThrow(/not found/);
  });

  it("sends Maizz's fee with a gift", async () => {
    const { l, calls } = ledger([{ status: 201, json: [GIFT_ROW] }]);
    await l.createGift({ reference: "mz_ref_12345678", churchId: "c1", giftType: "tithe", amountPesewas: 10_000, feePesewas: 301, maizzFeePesewas: 100 });
    expect((calls[0]!.body as Record<string, unknown>).maizz_fee_pesewas).toBe(100);
  });
});
