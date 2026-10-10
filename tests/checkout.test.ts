import { beforeEach, describe, expect, it, vi } from "vitest";
import { CHECKOUT_CHURCHES, giverStatus, parseCheckout, REFERENCE_PATTERN, startCheckout, toGiverStep } from "../src/lib/checkout";
import { createPaystackProvider } from "../src/lib/payments/paystack";
import { FakeLedger, mockFetch } from "./helpers";

const good = {
  church: "maizz-test-church",
  amountPesewas: 10_000,
  giftType: "tithe",
  anonymous: false,
  fullName: "  Ama   Mensah ",
  phone: "055 123 4987",
  network: "mtn",
};

describe("parseCheckout", () => {
  it("accepts a good request and tidies the name and phone", () => {
    const r = parseCheckout(good);
    expect(r).toMatchObject({ ok: true, input: { fullName: "Ama Mensah", phone: "0551234987", amountPesewas: 10_000, giftType: "tithe" } });
  });

  it("accepts every gift type on the page", () => {
    for (const t of ["tithe", "offering", "thanksgiving", "seed", "building", "missions", "other"]) {
      expect(parseCheckout({ ...good, giftType: t }).ok, t).toBe(true);
    }
  });

  it("does not need a name when anonymous, and drops any name sent", () => {
    const r = parseCheckout({ ...good, anonymous: true, fullName: "" });
    expect(r.ok).toBe(true);
    expect(r.ok && r.input.fullName).toBeUndefined();
  });

  it("refuses bad input with plain messages", () => {
    const bad: Record<string, unknown>[] = [
      { church: "nope" },
      { church: "__proto__" },
      { church: "constructor" },
      { amountPesewas: 99 },
      { amountPesewas: 5_000_001 },
      { amountPesewas: 100.5 },
      { amountPesewas: "100" },
      { amountPesewas: -5 },
      { giftType: "project" },
      { giftType: "x" },
      { network: "telecel" },
      { phone: "12345" },
      { fullName: "A" },
      { fullName: "x".repeat(81) },
    ];
    for (const over of bad) {
      const r = parseCheckout({ ...good, ...over });
      expect(r.ok, JSON.stringify(over)).toBe(false);
    }
    expect(parseCheckout(null).ok).toBe(false);
    expect(parseCheckout("text").ok).toBe(false);
  });

  it("only knows the test church for now", () => {
    expect(Object.keys(CHECKOUT_CHURCHES)).toEqual(["maizz-test-church"]);
  });
});

describe("startCheckout", () => {
  let ledger: FakeLedger;
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    ledger = new FakeLedger();
    ledger.churches.set("maizz-test-church", { id: "c1", name: "Maizz Test Church" });
  });

  const run = async (replies: Parameters<typeof mockFetch>[0], over: Record<string, unknown> = {}) => {
    const m = mockFetch(replies);
    const provider = createPaystackProvider({ secretKey: "sk_test_abc", fetchFn: m.fn });
    const parsed = parseCheckout({ ...good, ...over });
    if (!parsed.ok) throw new Error(parsed.error);
    const out = await startCheckout({ ledger, provider, input: parsed.input, testMode: true });
    return { out, calls: m.calls };
  };
  const offline = { json: { status: true, data: { status: "pay_offline", display_text: "Paystack: approve" } } };

  it("adds the fee so the church gets the exact gift, and charges the total", async () => {
    const { out, calls } = await run([offline]);
    expect(out.fees).toEqual({ giftPesewas: 10_000, feePesewas: 199, totalPesewas: 10_199 });
    expect(ledger.gifts[0]).toMatchObject({ amountPesewas: 10_000, feePesewas: 199, totalPesewas: 10_199 });
    expect((calls[0]!.body as { amount: number }).amount).toBe(10_199);
    expect(out.reference).toMatch(REFERENCE_PATTERN);
    expect(out.step).toEqual({ kind: "waiting" });
    expect(ledger.events.map((e) => e.status)).toEqual(["pending"]);
  });

  it("stores the giver's name and number for a named gift", async () => {
    await run([offline]);
    expect(ledger.givers).toEqual([{ id: "giver-1", fullName: "Ama Mensah", phone: "0551234987" }]);
    expect(ledger.giftGivers.get(ledger.gifts[0]!.reference)).toBe("giver-1");
  });

  it("stores nothing about an anonymous giver", async () => {
    await run([offline], { anonymous: true, fullName: "Ama" });
    expect(ledger.givers).toHaveLength(0);
    expect(ledger.giftGivers.get(ledger.gifts[0]!.reference)).toBeUndefined();
  });

  it("sends the provider no name, only the number it needs", async () => {
    const { calls } = await run([offline]);
    expect(JSON.stringify(calls[0]!.body)).not.toContain("Ama");
  });

  it("records a failed gift when the provider refuses, with a message that does not name the provider", async () => {
    const { out } = await run([{ status: 400, json: { status: false, message: "Paystack says no" } }]);
    expect(out.step.kind).toBe("failed");
    expect(JSON.stringify(out.step)).not.toMatch(/paystack/i);
    expect(ledger.events.map((e) => e.status)).toEqual(["failed"]);
  });

  it("does not tell the giver thank you from the charge reply alone", async () => {
    const { out } = await run([{ json: { status: true, data: { status: "success" } } }]);
    expect(out.step).toEqual({ kind: "confirming" });
  });

  it("never passes the provider's own wording on to the giver", () => {
    for (const r of [
      { kind: "failed", message: "Paystack: declined" },
      { kind: "prompt", message: "Paystack: approve" },
      { kind: "redirect", url: "https://x" },
    ] as const) {
      expect(JSON.stringify(toGiverStep(r))).not.toMatch(/paystack/i);
    }
  });

  it("refuses when the church does not exist in the ledger", async () => {
    ledger.churches.clear();
    await expect(run([offline])).rejects.toThrow("church_missing");
  });
});

describe("giver status", () => {
  it("gives a giver one plain word", () => {
    expect(giverStatus(null)).toBe("unknown");
    expect(giverStatus({ status: "pending", wasPaid: false })).toBe("confirming");
    expect(giverStatus({ status: "succeeded", wasPaid: true })).toBe("paid");
    expect(giverStatus({ status: "failed", wasPaid: false })).toBe("failed");
    expect(giverStatus({ status: "abandoned", wasPaid: false })).toBe("failed");
    expect(giverStatus({ status: "refunded", wasPaid: true })).toBe("paid");
  });
  it("accepts only our own reference shapes", () => {
    expect(REFERENCE_PATTERN.test("mz_" + "a".repeat(24))).toBe(true);
    expect(REFERENCE_PATTERN.test("mz_test_" + "0".repeat(24))).toBe(true);
    for (const bad of ["", "mz_abc", "mz_" + "g".repeat(24), "x" + "mz_" + "a".repeat(24), "mz_" + "a".repeat(24) + "\n&x=1"]) {
      expect(REFERENCE_PATTERN.test(bad), bad).toBe(false);
    }
  });
});
