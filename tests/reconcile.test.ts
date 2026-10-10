import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPaystackProvider } from "../src/lib/payments/paystack";
import { ProviderError, type PaymentProvider, type VerifyResult } from "../src/lib/payments/types";
import { processWebhook } from "../src/lib/payments/webhookHandler";
import { ABANDON_AFTER_MINUTES, reconcile, settleGift } from "../src/lib/reconcile";
import { FakeAudit, FakeLedger, mockFetch, sign } from "./helpers";

const MIN = 60_000;
let clock = Date.parse("2026-10-10T12:00:00Z");
let ledger: FakeLedger;
let audit: FakeAudit;
let answers: Map<string, VerifyResult | "404" | "boom">;

function fakeProvider(): PaymentProvider {
  return {
    name: "paystack",
    capabilities: {} as PaymentProvider["capabilities"],
    initialize: async () => ({ kind: "failed", message: "x" }),
    submitOtp: async () => ({ kind: "failed", message: "x" }),
    refund: async () => ({ status: "pending", providerRefundId: "r" }),
    parseWebhook: () => ({ kind: "ignored", providerEventId: "x", reference: "" }),
    verify: async (reference) => {
      const a = answers.get(reference);
      if (a === "404") throw new ProviderError("not found", 404);
      if (a === "boom") throw new ProviderError("provider down", 500);
      if (!a) throw new ProviderError("not found", 404);
      return a;
    },
  };
}

const answer = (reference: string, over: Partial<VerifyResult> = {}): VerifyResult => ({
  reference,
  status: "succeeded",
  amountPesewas: 10_150,
  currency: "GHS",
  providerTransactionId: "777",
  ...over,
});

async function gift(ref: string, ageMinutes: number) {
  ledger.now = () => clock - ageMinutes * MIN;
  const g = await ledger.createGift({ reference: ref, churchId: "c", giftType: "tithe", amountPesewas: 10_000, feePesewas: 150 });
  ledger.now = () => clock;
  await ledger.addEvent({ giftId: g.id, status: "pending" });
  return g;
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  ledger = new FakeLedger();
  audit = new FakeAudit();
  answers = new Map();
});

describe("settleGift", () => {
  it("records a paid gift when the provider says paid for the exact amount", async () => {
    const g = await gift("mz_aaaaaaaa", 5);
    answers.set(g.reference, answer(g.reference));
    expect(await settleGift({ ledger, provider: fakeProvider(), audit, gift: g, now: clock })).toBe("paid");
    expect(await ledger.currentStatus(g.reference)).toMatchObject({ status: "succeeded", wasPaid: true });
  });

  it("refuses to record a payment of the wrong amount or currency, and raises an alert", async () => {
    const g = await gift("mz_aaaaaaaa", 5);
    for (const over of [{ amountPesewas: 1 }, { currency: "USD" }]) {
      answers.set(g.reference, answer(g.reference, over));
      expect(await settleGift({ ledger, provider: fakeProvider(), audit, gift: g, now: clock })).toBe("mismatch");
    }
    expect((await ledger.currentStatus(g.reference))!.wasPaid).toBe(false);
    expect(audit.actions()).toEqual(["reconcile.amount_mismatch", "reconcile.amount_mismatch"]);
  });

  it("records a failed payment", async () => {
    const g = await gift("mz_aaaaaaaa", 5);
    answers.set(g.reference, answer(g.reference, { status: "failed" }));
    expect(await settleGift({ ledger, provider: fakeProvider(), audit, gift: g, now: clock })).toBe("failed");
    expect((await ledger.currentStatus(g.reference))!.status).toBe("failed");
  });

  it("leaves a young pending payment alone", async () => {
    const g = await gift("mz_aaaaaaaa", 5);
    answers.set(g.reference, answer(g.reference, { status: "pending" }));
    expect(await settleGift({ ledger, provider: fakeProvider(), audit, gift: g, now: clock })).toBe("still_pending");
    expect(ledger.events).toHaveLength(1);
  });

  it("closes an old gift the provider never confirms, whether pending or not found", async () => {
    const a = await gift("mz_aaaaaaaa", ABANDON_AFTER_MINUTES + 5);
    const b = await gift("mz_bbbbbbbb", ABANDON_AFTER_MINUTES + 5);
    answers.set(a.reference, answer(a.reference, { status: "pending" }));
    expect(await settleGift({ ledger, provider: fakeProvider(), audit, gift: a, now: clock })).toBe("abandoned");
    expect(await settleGift({ ledger, provider: fakeProvider(), audit, gift: b, now: clock })).toBe("abandoned");
  });

  it("a payment that arrives after a gift was closed still counts", async () => {
    const g = await gift("mz_aaaaaaaa", ABANDON_AFTER_MINUTES + 5);
    await settleGift({ ledger, provider: fakeProvider(), audit, gift: g, now: clock });
    expect((await ledger.currentStatus(g.reference))!.status).toBe("abandoned");
    answers.set(g.reference, answer(g.reference));
    await settleGift({ ledger, provider: fakeProvider(), audit, gift: g, now: clock });
    expect(await ledger.currentStatus(g.reference)).toMatchObject({ status: "succeeded", wasPaid: true });
  });

  it("reports an error and records nothing when the provider is down", async () => {
    const g = await gift("mz_aaaaaaaa", 5);
    answers.set(g.reference, "boom");
    expect(await settleGift({ ledger, provider: fakeProvider(), audit, gift: g, now: clock })).toBe("error");
    expect(ledger.events).toHaveLength(1);
  });

  it("never records one payment twice, whether the notice or the check comes first", async () => {
    const SECRET = "sk_test_abc123";
    const provider = createPaystackProvider({ secretKey: SECRET, fetchFn: mockFetch([]).fn });
    const g = await gift("mz_cccccccc", 5);
    answers.set(g.reference, answer(g.reference, { providerTransactionId: "1001" }));
    const body = JSON.stringify({
      event: "charge.success",
      data: { id: 1001, status: "success", reference: g.reference, amount: 10_150, currency: "GHS" },
    });
    await settleGift({ ledger, provider: fakeProvider(), audit, gift: g, now: clock });
    const res = await processWebhook({ provider, ledger, rawBody: body, signature: sign(body, SECRET), audit });
    expect(res.body.result).toBe("duplicate");
    expect(ledger.events.filter((e) => e.status === "succeeded")).toHaveLength(1);
  });
});

describe("daily check", () => {
  const run = () => reconcile({ ledger, provider: fakeProvider(), audit, now: () => clock });

  it("settles waiting gifts, re-checks paid ones, and writes a summary", async () => {
    const waiting = await gift("mz_aaaaaaaa", 30);
    const young = await gift("mz_bbbbbbbb", 2); // too young to look at
    const paid = await gift("mz_cccccccc", 60 * 24);
    await ledger.addEvent({ giftId: paid.id, status: "succeeded" });
    answers.set(waiting.reference, answer(waiting.reference));
    answers.set(paid.reference, answer(paid.reference));
    const s = await run();
    expect(s).toMatchObject({ checkedPending: 1, settledPaid: 1, paidChecked: 2, paidNotConfirmed: 0, mismatches: 0, errors: 0 });
    expect((await ledger.currentStatus(young.reference))!.status).toBe("pending");
    const last = audit.entries.at(-1)!;
    expect(last).toMatchObject({ action: "reconcile.run", outcome: "ok" });
  });

  it("raises an alert when a paid gift is not confirmed by the provider, and marks the run as failed", async () => {
    const paid = await gift("mz_cccccccc", 60 * 24);
    await ledger.addEvent({ giftId: paid.id, status: "succeeded" });
    answers.set(paid.reference, answer(paid.reference, { amountPesewas: 9_999 }));
    const s = await run();
    expect(s.paidNotConfirmed).toBe(1);
    expect(audit.actions()).toContain("reconcile.paid_not_confirmed");
    expect(audit.entries.at(-1)).toMatchObject({ action: "reconcile.run", outcome: "failed" });
  });

  it("alerts when a paid gift cannot be found at the provider at all", async () => {
    const paid = await gift("mz_cccccccc", 60 * 24);
    await ledger.addEvent({ giftId: paid.id, status: "succeeded" });
    const s = await run();
    expect(s.paidNotConfirmed).toBe(1);
  });

  it("counts provider trouble as errors and still writes its summary", async () => {
    const g = await gift("mz_aaaaaaaa", 30);
    answers.set(g.reference, "boom");
    const s = await run();
    expect(s.errors).toBe(1);
    expect(audit.entries.at(-1)).toMatchObject({ action: "reconcile.run", outcome: "failed" });
  });

  it("does not touch gifts older than three days", async () => {
    const old = await gift("mz_aaaaaaaa", 60 * 24 * 4);
    answers.set(old.reference, answer(old.reference));
    const s = await run();
    expect(s.checkedPending).toBe(0);
    expect((await ledger.currentStatus(old.reference))!.status).toBe("pending");
  });

  it("is safe to run twice", async () => {
    const g = await gift("mz_aaaaaaaa", 30);
    answers.set(g.reference, answer(g.reference));
    await run();
    await run();
    expect(ledger.events.filter((e) => e.status === "succeeded")).toHaveLength(1);
  });

  it("stops and says so if the audit log cannot be written", async () => {
    audit.failWrites = true;
    await expect(run()).rejects.toThrow();
  });
});

describe("refunded gifts in the daily check", () => {
  it("does not raise an alarm when the provider's status changes after a refund", async () => {
    const paid = await gift("mz_cccccccc", 60 * 24);
    await ledger.addEvent({ giftId: paid.id, status: "succeeded" });
    await ledger.addEvent({ giftId: paid.id, status: "refunded", amountPesewas: 10_150 });
    answers.set(paid.reference, answer(paid.reference, { status: "pending", rawStatus: "reversed" }));
    const s = await reconcile({ ledger, provider: fakeProvider(), audit, now: () => clock });
    expect(s.paidNotConfirmed).toBe(0);
    expect(audit.actions()).toEqual(["reconcile.run"]);
  });
});
