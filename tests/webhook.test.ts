import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPaystackProvider } from "../src/lib/payments/paystack";
import { processWebhook } from "../src/lib/payments/webhookHandler";
import { FakeAudit, FakeLedger, mockFetch, sign } from "./helpers";

const SECRET = "sk_test_abc123";
const provider = createPaystackProvider({ secretKey: SECRET, fetchFn: mockFetch([]).fn });

let ledger: FakeLedger;
let giftId = "";
const REF = "mz_test_0123456789abcdef01234567";

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  ledger = new FakeLedger();
  audit = new FakeAudit();
  const gift = await ledger.createGift({
    reference: REF,
    churchId: "church-1",
    giftType: "tithe",
    amountPesewas: 10_000,
    feePesewas: 150,
  });
  giftId = gift.id;
});

let audit: FakeAudit;

function send(payload: unknown, opts: { signature?: string | null; secret?: string } = {}) {
  const rawBody = typeof payload === "string" ? payload : JSON.stringify(payload);
  const signature = opts.signature === undefined ? sign(rawBody, opts.secret ?? SECRET) : opts.signature;
  return processWebhook({ provider, ledger, rawBody, signature, audit });
}

const success = (over: Record<string, unknown> = {}) => ({
  event: "charge.success",
  data: { id: 1001, status: "success", reference: REF, amount: 10_150, currency: "GHS", ...over },
});

describe("genuine payment notice", () => {
  it("records the gift as succeeded", async () => {
    const res = await send(success());
    expect(res.status).toBe(200);
    expect(res.body.result).toBe("added");
    expect(ledger.events).toHaveLength(1);
    expect(ledger.events[0]).toMatchObject({ giftId, status: "succeeded", providerEventId: "paystack:charge.success:1001" });
    expect(await ledger.currentStatus(REF)).toEqual({ status: "succeeded", wasPaid: true });
  });

  it("records a repeated notice only once", async () => {
    await send(success());
    const again = await send(success());
    expect(again.status).toBe(200);
    expect(again.body.result).toBe("duplicate");
    expect(ledger.events).toHaveLength(1);
  });

  it("does not record the same payment twice when the notice arrives late, after others", async () => {
    await send(success());
    await send({ event: "transfer.success", data: { id: 1 } });
    await send(success());
    expect(ledger.events.filter((e) => e.status === "succeeded")).toHaveLength(1);
  });
});

describe("notices we must not trust", () => {
  it("refuses a missing signature and records nothing", async () => {
    const res = await send(success(), { signature: null });
    expect(res.status).toBe(401);
    expect(ledger.events).toHaveLength(0);
  });

  it("refuses a notice signed with the wrong key", async () => {
    const res = await send(success(), { secret: "sk_test_attacker" });
    expect(res.status).toBe(401);
    expect(ledger.events).toHaveLength(0);
  });

  it("refuses a notice changed after signing", async () => {
    const raw = JSON.stringify(success());
    const res = await processWebhook({
      provider,
      ledger,
      rawBody: raw.replace("10150", "1"),
      signature: sign(raw, SECRET),
    });
    expect(res.status).toBe(401);
    expect(ledger.events).toHaveLength(0);
  });

  it("refuses an oversized body", async () => {
    const res = await processWebhook({ provider, ledger, rawBody: "x".repeat(200_000), signature: "a" });
    expect(res.status).toBe(413);
  });

  it("does not mark a gift paid when the amount is wrong", async () => {
    const res = await send(success({ amount: 100 }));
    expect(res.status).toBe(200);
    expect(res.body.result).toBe("amount_mismatch_not_recorded");
    expect(ledger.events).toHaveLength(0);
    expect(await ledger.currentStatus(REF)).toEqual({ status: "pending", wasPaid: false });
  });

  it("does not mark a gift paid when the amount excludes the fee", async () => {
    const res = await send(success({ amount: 10_000 }));
    expect(res.body.result).toBe("amount_mismatch_not_recorded");
    expect(ledger.events).toHaveLength(0);
  });

  it("does not mark a gift paid in the wrong currency", async () => {
    const res = await send(success({ currency: "USD" }));
    expect(res.body.result).toBe("amount_mismatch_not_recorded");
    expect(ledger.events).toHaveLength(0);
  });

  it("ignores a payment that is not a Maizz gift", async () => {
    const res = await send(success({ reference: "someone_elses_payment_1" }));
    expect(res.status).toBe(200);
    expect(res.body.result).toBe("unknown_reference");
    expect(ledger.events).toHaveLength(0);
  });

  it("answers 400 to a genuine but malformed notice", async () => {
    const res = await send({ event: "charge.success", data: { id: 1 } });
    expect(res.status).toBe(400);
    expect(ledger.events).toHaveLength(0);
  });
});

describe("other events", () => {
  it("accepts and ignores events we do not use", async () => {
    const res = await send({ event: "transfer.success", data: { id: 3 } });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe("ignored");
    expect(ledger.events).toHaveLength(0);
  });

  it("records a refund with its amount", async () => {
    await send(success());
    const res = await send({
      event: "refund.processed",
      data: { id: 55, transaction_reference: REF, amount: 4_000, currency: "GHS" },
    });
    expect(res.status).toBe(200);
    expect(ledger.events.at(-1)).toMatchObject({ status: "refunded", amountPesewas: 4_000 });
  });

  it("refuses a refund bigger than the gift", async () => {
    const res = await send({
      event: "refund.processed",
      data: { id: 56, transaction_reference: REF, amount: 999_999, currency: "GHS" },
    });
    expect(res.body.result).toBe("refund_amount_invalid_not_recorded");
    expect(ledger.events).toHaveLength(0);
  });
});

describe("database trouble", () => {
  it("answers 500 so Paystack tries again later", async () => {
    ledger.failNext = true;
    const res = await send(success());
    expect(res.status).toBe(500);
    // The retry then works.
    const retry = await send(success());
    expect(retry.status).toBe(200);
    expect(ledger.events).toHaveLength(1);
  });
});

describe("logs", () => {
  it("never write the secret key", async () => {
    const out = vi.spyOn(console, "log");
    const err = vi.spyOn(console, "error");
    await send(success());
    await send(success(), { signature: null });
    await send(success({ amount: 5 }));
    const everything = [...out.mock.calls, ...err.mock.calls].flat().join(" ");
    expect(everything).not.toContain(SECRET);
  });
});

describe("audit trail", () => {
  it("records a refused signature, without the body", async () => {
    await send(success(), { signature: "bad" });
    expect(audit.actions()).toEqual(["webhook.bad_signature"]);
    expect(audit.entries[0]).toMatchObject({ actor: "webhook", outcome: "denied" });
  });

  it("records an amount mismatch against the gift reference", async () => {
    await send(success({ amount: 5 }));
    expect(audit.entries[0]).toMatchObject({
      action: "webhook.amount_mismatch",
      target: REF,
      detail: { expected_pesewas: 10_150, received_pesewas: 5 },
    });
    expect(ledger.events).toHaveLength(0);
  });

  it("records a bad payload", async () => {
    await send("not json");
    expect(audit.actions()).toEqual(["webhook.bad_payload"]);
  });

  it("writes nothing for a normal genuine payment", async () => {
    await send(success());
    expect(audit.entries).toHaveLength(0);
  });

  it("stops writing junk after the throttle", async () => {
    for (let i = 0; i < 30; i++) await send(success(), { signature: "bad" });
    expect(audit.entries).toHaveLength(20);
  });

  it("still records the payment when the audit log is down", async () => {
    audit.failReads = true;
    audit.failWrites = true;
    const res = await send(success());
    expect(res.status).toBe(200);
    expect(ledger.events).toHaveLength(1);
    const bad = await send(success(), { signature: "bad" });
    expect(bad.status).toBe(401);
  });
});
