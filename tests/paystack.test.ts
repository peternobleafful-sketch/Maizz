import { describe, expect, it } from "vitest";
import { classifyPaystackKey, requirePaystackSecret, ConfigError } from "../src/lib/config";
import { createPaystackProvider } from "../src/lib/payments/paystack";
import { ProviderError, WebhookPayloadError, WebhookSignatureError } from "../src/lib/payments/types";
import { normaliseGhanaPhone } from "../src/lib/phone";
import { newGiftReference } from "../src/lib/payments/reference";
import { mockFetch, sign } from "./helpers";

const SECRET = "sk_test_abc123";
const REF = "mz_0123456789abcdef";

function provider(replies: Parameters<typeof mockFetch>[0] = []) {
  const m = mockFetch(replies);
  return { p: createPaystackProvider({ secretKey: SECRET, fetchFn: m.fn }), calls: m.calls };
}

describe("test mode guard", () => {
  it("classifies keys", () => {
    expect(classifyPaystackKey("sk_test_x")).toBe("test");
    expect(classifyPaystackKey("sk_live_x")).toBe("live");
    expect(classifyPaystackKey("pk_test_x")).toBe("public");
    expect(classifyPaystackKey("hello")).toBe("unknown");
    expect(classifyPaystackKey("  ")).toBe("missing");
    expect(classifyPaystackKey(undefined)).toBe("missing");
  });

  it("accepts a test key", () => {
    expect(requirePaystackSecret({ PAYSTACK_SECRET_KEY: "sk_test_abc" })).toBe("sk_test_abc");
  });

  it("refuses a live key unless live has been deliberately allowed", () => {
    expect(() => requirePaystackSecret({ PAYSTACK_SECRET_KEY: "sk_live_abc" })).toThrow(ConfigError);
    expect(() => requirePaystackSecret({ PAYSTACK_SECRET_KEY: "sk_live_abc", MAIZZ_ALLOW_LIVE: "true" })).toThrow(ConfigError);
    expect(requirePaystackSecret({ PAYSTACK_SECRET_KEY: "sk_live_abc", MAIZZ_ALLOW_LIVE: "yes" })).toBe("sk_live_abc");
  });

  it("refuses public, missing and odd keys", () => {
    for (const key of ["pk_test_abc", "", undefined, "banana"]) {
      expect(() => requirePaystackSecret({ PAYSTACK_SECRET_KEY: key })).toThrow(ConfigError);
    }
  });
});

describe("phone numbers and references", () => {
  it("normalises Ghana numbers", () => {
    expect(normaliseGhanaPhone("0551234987")).toBe("0551234987");
    expect(normaliseGhanaPhone("055 123 4987")).toBe("0551234987");
    expect(normaliseGhanaPhone("+233551234987")).toBe("0551234987");
    expect(normaliseGhanaPhone("233551234987")).toBe("0551234987");
  });

  it("rejects numbers that are not Ghana numbers", () => {
    for (const bad of ["", "12345", "551234987", "+44 7700 900123", "055123498", "05512349877", "abc"]) {
      expect(normaliseGhanaPhone(bad), bad).toBeNull();
    }
  });

  it("makes unguessable references that Paystack and the ledger accept", () => {
    const a = newGiftReference();
    const b = newGiftReference();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^mz_[a-f0-9]{24}$/);
    expect(a.length).toBeGreaterThanOrEqual(8);
  });
});

describe("initialize: mobile money", () => {
  it("charges directly in whole pesewas, so the giver never leaves Maizz", async () => {
    const { p, calls } = provider([
      { json: { status: true, data: { status: "pay_offline", display_text: "Approve on your phone" } } },
    ]);
    const result = await p.initialize({
      reference: REF,
      amountPesewas: 10_150,
      email: "ama@example.com",
      channel: "mobile_money",
      mobileMoney: { network: "vodafone", phone: "0201234567" },
      metadata: { church_id: "c1" },
    });
    expect(result).toEqual({ kind: "prompt", message: "Approve on your phone" });

    const call = calls[0]!;
    expect(call.url).toBe("https://api.paystack.co/charge");
    expect(call.method).toBe("POST");
    expect(call.headers.Authorization).toBe(`Bearer ${SECRET}`);
    expect(call.body).toEqual({
      email: "ama@example.com",
      amount: 10_150,
      currency: "GHS",
      reference: REF,
      metadata: { church_id: "c1" },
      mobile_money: { phone: "0201234567", provider: "vod" },
    });
  });

  it("uses Paystack's codes for each network", async () => {
    for (const [network, code] of [["mtn", "mtn"], ["vodafone", "vod"], ["airteltigo", "atl"]] as const) {
      const { p, calls } = provider([{ json: { status: true, data: { status: "pending" } } }]);
      await p.initialize({
        reference: REF,
        amountPesewas: 100,
        email: "a@b.co",
        channel: "mobile_money",
        mobileMoney: { network, phone: "0551234987" },
      });
      expect((calls[0]!.body as { mobile_money: { provider: string } }).mobile_money.provider).toBe(code);
    }
  });

  it("maps each Paystack charge status", async () => {
    const cases: [string, string][] = [
      ["success", "paid"],
      ["failed", "failed"],
      ["send_otp", "otp_required"],
      ["pay_offline", "prompt"],
      ["pending", "prompt"],
    ];
    for (const [status, kind] of cases) {
      const { p } = provider([{ json: { status: true, data: { status, message: "m" } } }]);
      const r = await p.initialize({
        reference: REF,
        amountPesewas: 100,
        email: "a@b.co",
        channel: "mobile_money",
        mobileMoney: { network: "mtn", phone: "0551234987" },
      });
      expect(r.kind).toBe(kind);
    }
  });

  it("refuses an unknown charge status instead of guessing", async () => {
    const { p } = provider([{ json: { status: true, data: { status: "teleported" } } }]);
    await expect(
      p.initialize({
        reference: REF,
        amountPesewas: 100,
        email: "a@b.co",
        channel: "mobile_money",
        mobileMoney: { network: "mtn", phone: "0551234987" },
      }),
    ).rejects.toThrow(ProviderError);
  });

  it("rejects bad input before calling Paystack at all", async () => {
    const base = { reference: REF, amountPesewas: 100, email: "a@b.co", channel: "mobile_money" as const };
    const mm = { network: "mtn" as const, phone: "0551234987" };
    const { p, calls } = provider();
    await expect(p.initialize({ ...base, amountPesewas: 0, mobileMoney: mm })).rejects.toThrow();
    await expect(p.initialize({ ...base, amountPesewas: 12.5, mobileMoney: mm })).rejects.toThrow();
    await expect(p.initialize({ ...base, amountPesewas: -5, mobileMoney: mm })).rejects.toThrow();
    await expect(p.initialize({ ...base, email: "nope", mobileMoney: mm })).rejects.toThrow();
    await expect(p.initialize({ ...base, reference: "bad ref!", mobileMoney: mm })).rejects.toThrow();
    await expect(p.initialize({ ...base })).rejects.toThrow(/Mobile money details/);
    expect(calls).toHaveLength(0);
  });

  it("turns a Paystack error into a plain ProviderError", async () => {
    const { p } = provider([{ status: 400, json: { status: false, message: "Invalid phone" } }]);
    await expect(
      p.initialize({
        reference: REF,
        amountPesewas: 100,
        email: "a@b.co",
        channel: "mobile_money",
        mobileMoney: { network: "mtn", phone: "0551234987" },
      }),
    ).rejects.toThrow("Invalid phone");
  });

  it("never leaks the secret key in an error", async () => {
    const m = mockFetch([]);
    const failing = (async () => {
      throw new Error(`boom ${SECRET}`);
    }) as unknown as typeof fetch;
    const p = createPaystackProvider({ secretKey: SECRET, fetchFn: failing });
    try {
      await p.verify(REF);
      expect.unreachable();
    } catch (err) {
      expect(String((err as Error).message)).not.toContain(SECRET);
    }
    expect(m.calls).toHaveLength(0);
  });
});

describe("initialize: cards and bank transfer", () => {
  it("sends the giver to Paystack's secure page", async () => {
    const { p, calls } = provider([
      { json: { status: true, data: { authorization_url: "https://checkout.paystack.com/abc" } } },
    ]);
    const r = await p.initialize({ reference: REF, amountPesewas: 5_000, email: "a@b.co", channel: "card" });
    expect(r).toEqual({ kind: "redirect", url: "https://checkout.paystack.com/abc" });
    expect(calls[0]!.url).toBe("https://api.paystack.co/transaction/initialize");
    expect((calls[0]!.body as { channels: string[] }).channels).toEqual(["card"]);
  });

  it("refuses a payment page that is not https", async () => {
    const { p } = provider([{ json: { status: true, data: { authorization_url: "http://evil.example/x" } } }]);
    await expect(p.initialize({ reference: REF, amountPesewas: 100, email: "a@b.co", channel: "card" })).rejects.toThrow();
  });
});

describe("submitOtp", () => {
  it("sends the code and reads the result", async () => {
    const { p, calls } = provider([{ json: { status: true, data: { status: "success" } } }]);
    expect(await p.submitOtp(REF, "123456")).toEqual({ kind: "paid" });
    expect(calls[0]!.url).toBe("https://api.paystack.co/charge/submit_otp");
    expect(calls[0]!.body).toEqual({ otp: "123456", reference: REF });
  });

  it("rejects a code that is not digits", async () => {
    const { p, calls } = provider();
    await expect(p.submitOtp(REF, "12ab")).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe("verify", () => {
  it("asks Paystack directly and maps the answer", async () => {
    const { p, calls } = provider([
      { json: { status: true, data: { id: 42, status: "success", amount: 10_150, currency: "GHS", reference: REF } } },
    ]);
    expect(await p.verify(REF)).toEqual({
      reference: REF,
      status: "succeeded",
      amountPesewas: 10_150,
      currency: "GHS",
      providerTransactionId: "42",
      rawStatus: "success",
    });
    expect(calls[0]!.url).toBe(`https://api.paystack.co/transaction/verify/${REF}`);
    expect(calls[0]!.method).toBe("GET");
  });

  it("maps failed, abandoned and in-progress states", async () => {
    for (const [s, expected] of [["failed", "failed"], ["abandoned", "abandoned"], ["ongoing", "pending"], ["pending", "pending"]] as const) {
      const { p } = provider([{ json: { status: true, data: { id: 1, status: s, amount: 100, currency: "GHS" } } }]);
      expect((await p.verify(REF)).status).toBe(expected);
    }
  });

  it("refuses an amount that is not whole pesewas", async () => {
    const { p } = provider([{ json: { status: true, data: { id: 1, status: "success", amount: 100.5, currency: "GHS" } } }]);
    await expect(p.verify(REF)).rejects.toThrow(ProviderError);
  });

  it("reports a missing transaction with its status code", async () => {
    const { p } = provider([{ status: 404, json: { status: false, message: "Transaction reference not found" } }]);
    await expect(p.verify(REF)).rejects.toMatchObject({ httpStatus: 404 });
  });
});

describe("refund", () => {
  it("refunds a stated amount in whole pesewas", async () => {
    const { p, calls } = provider([{ json: { status: true, data: { id: 9, status: "pending" } } }]);
    expect(await p.refund({ reference: REF, amountPesewas: 4_000 })).toEqual({ status: "pending", providerRefundId: "9" });
    expect(calls[0]!.body).toEqual({ transaction: REF, amount: 4_000 });
  });

  it("refunds the whole payment when no amount is given", async () => {
    const { p, calls } = provider([{ json: { status: true, data: { id: 9, status: "processed" } } }]);
    expect((await p.refund({ reference: REF })).status).toBe("processed");
    expect(calls[0]!.body).toEqual({ transaction: REF });
  });

  it("rejects a decimal or zero refund", async () => {
    const { p, calls } = provider();
    await expect(p.refund({ reference: REF, amountPesewas: 10.5 })).rejects.toThrow();
    await expect(p.refund({ reference: REF, amountPesewas: 0 })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe("parseWebhook: signature", () => {
  const body = JSON.stringify({
    event: "charge.success",
    data: { id: 77, status: "success", reference: REF, amount: 10_150, currency: "GHS" },
  });
  const p = createPaystackProvider({ secretKey: SECRET, fetchFn: mockFetch([]).fn });

  it("accepts a genuine notice", () => {
    expect(p.parseWebhook(body, sign(body, SECRET))).toEqual({
      kind: "payment_succeeded",
      providerEventId: "paystack:charge.success:77",
      reference: REF,
      amountPesewas: 10_150,
      currency: "GHS",
    });
  });

  it("refuses a missing signature", () => {
    expect(() => p.parseWebhook(body, null)).toThrow(WebhookSignatureError);
    expect(() => p.parseWebhook(body, "")).toThrow(WebhookSignatureError);
  });

  it("refuses a wrong signature", () => {
    expect(() => p.parseWebhook(body, "deadbeef")).toThrow(WebhookSignatureError);
    expect(() => p.parseWebhook(body, sign(body, "sk_test_someone_else"))).toThrow(WebhookSignatureError);
  });

  it("refuses a notice whose body was changed after signing", () => {
    const signature = sign(body, SECRET);
    const tampered = body.replace("10150", "99999");
    expect(() => p.parseWebhook(tampered, signature)).toThrow(WebhookSignatureError);
  });
});

describe("parseWebhook: events", () => {
  const p = createPaystackProvider({ secretKey: SECRET, fetchFn: mockFetch([]).fn });
  const parse = (payload: unknown) => {
    const body = JSON.stringify(payload);
    return p.parseWebhook(body, sign(body, SECRET));
  };

  it("reads a refund", () => {
    expect(
      parse({ event: "refund.processed", data: { id: 5, transaction_reference: REF, amount: 4_000, currency: "GHS" } }),
    ).toEqual({
      kind: "refund_processed",
      providerEventId: "paystack:refund.processed:5",
      reference: REF,
      amountPesewas: 4_000,
      currency: "GHS",
    });
  });

  it("ignores events we do not act on", () => {
    expect(parse({ event: "transfer.success", data: { id: 1 } }).kind).toBe("ignored");
  });

  it("rejects a genuine but incomplete notice", () => {
    expect(() => parse({ event: "charge.success", data: { id: 1 } })).toThrow(WebhookPayloadError);
    expect(() => parse({ event: "charge.success", data: { id: 1, reference: REF, status: "failed", amount: 1 } })).toThrow(WebhookPayloadError);
    expect(() => parse({ event: "charge.success", data: { id: 1, reference: REF, status: "success", amount: 1.5 } })).toThrow();
    expect(() => parse({ nothing: true })).toThrow(WebhookPayloadError);
  });

  it("rejects a signed body that is not JSON", () => {
    const body = "not json";
    expect(() => p.parseWebhook(body, sign(body, SECRET))).toThrow(WebhookPayloadError);
  });
});

describe("capabilities", () => {
  it("states what Paystack can do, so a router can choose later", () => {
    const { p } = provider();
    expect(p.name).toBe("paystack");
    expect(p.capabilities.channels).toContain("mobile_money");
    expect(p.capabilities.mobileMoneyNetworks).toEqual(["mtn", "vodafone", "airteltigo"]);
    expect(p.capabilities.currencies).toEqual(["GHS"]);
  });
});

describe("church payout accounts", () => {
  const base = { reference: REF, amountPesewas: 10_301, email: "a@example.com", channel: "mobile_money" as const, mobileMoney: { network: "mtn" as const, phone: "0551234987" } };
  const prompt = { json: { status: true, data: { status: "pay_offline" } } };

  it("splits a payment: church account named, Maizz's flat share set, Maizz bears the provider's cut", async () => {
    const { p, calls } = provider([prompt]);
    await p.initialize({ ...base, split: { subaccountCode: "ACCT_abc123xyz", maizzKeepsPesewas: 301 } });
    expect(calls[0]!.body).toMatchObject({ subaccount: "ACCT_abc123xyz", transaction_charge: 301, bearer: "account", amount: 10_301 });
  });

  it("sends no split fields when there is no split", async () => {
    const { p, calls } = provider([prompt]);
    await p.initialize(base);
    expect(calls[0]!.body).not.toHaveProperty("subaccount");
    expect(calls[0]!.body).not.toHaveProperty("bearer");
  });

  it("refuses a bad payout code or a split as big as the whole payment", async () => {
    const { p, calls } = provider([]);
    for (const split of [
      { subaccountCode: "nope", maizzKeepsPesewas: 301 },
      { subaccountCode: "ACCT_abc123xyz", maizzKeepsPesewas: 10_301 },
      { subaccountCode: "ACCT_abc123xyz", maizzKeepsPesewas: -1 },
      { subaccountCode: "ACCT_abc123xyz", maizzKeepsPesewas: 1.5 },
    ]) {
      await expect(p.initialize({ ...base, split })).rejects.toBeInstanceOf(ProviderError);
    }
    expect(calls).toHaveLength(0);
  });

  it("creates a payout account and returns the holder's name for you to check", async () => {
    const { p, calls } = provider([{ status: 201, json: { status: true, data: { subaccount_code: "ACCT_abc123xyz", account_name: "GRACE CHAPEL" } } }]);
    const out = await p.createPayoutAccount({ businessName: " Grace Chapel ", bankCode: "MTN", accountNumber: "0551234987" });
    expect(out).toEqual({ code: "ACCT_abc123xyz", accountName: "GRACE CHAPEL" });
    expect(calls[0]!.url).toBe("https://api.paystack.co/subaccount");
    expect(calls[0]!.body).toMatchObject({ business_name: "Grace Chapel", settlement_bank: "MTN", account_number: "0551234987", percentage_charge: 0 });
  });

  it("refuses bad payout details before calling Paystack, and a reply with no code", async () => {
    const { p, calls } = provider([{ json: { status: true, data: {} } }]);
    for (const input of [
      { businessName: "G", bankCode: "MTN", accountNumber: "0551234987" },
      { businessName: "Grace", bankCode: "M T N", accountNumber: "0551234987" },
      { businessName: "Grace", bankCode: "MTN", accountNumber: "12" },
    ]) {
      await expect(p.createPayoutAccount(input)).rejects.toBeInstanceOf(ProviderError);
    }
    expect(calls).toHaveLength(0);
    await expect(p.createPayoutAccount({ businessName: "Grace", bankCode: "MTN", accountNumber: "0551234987" })).rejects.toBeInstanceOf(ProviderError);
  });

  it("lists Ghana mobile money networks and banks", async () => {
    const { p, calls } = provider([
      { json: { status: true, data: [{ name: "MTN", code: "MTN", active: true }, { name: "Old", code: "OLD", active: false }] } },
      { json: { status: true, data: [{ name: "GCB Bank", code: "040", active: true }] } },
    ]);
    expect(await p.listPayoutBanks()).toEqual([
      { name: "MTN", code: "MTN", kind: "mobile_money" },
      { name: "GCB Bank", code: "040", kind: "bank" },
    ]);
    expect(calls[0]!.url).toContain("type=mobile_money");
    expect(calls[1]!.url).toContain("type=ghipss");
  });
});
