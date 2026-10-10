import { beforeEach, describe, expect, it, vi } from "vitest";
import { exportBooksCsv } from "../src/lib/booksExport";
import { parseCheckout, startCheckout } from "../src/lib/checkout";
import { createNotifier, receiptText } from "../src/lib/notify";
import { createPaystackProvider } from "../src/lib/payments/paystack";
import { processWebhook } from "../src/lib/payments/webhookHandler";
import { reconcile } from "../src/lib/reconcile";
import type { Mailer } from "../src/lib/staff";
import { FakeAudit, FakeLedger, makeChurch, mockFetch, sign } from "./helpers";
import type { PaymentProvider } from "../src/lib/payments/types";

const SECRET = "sk_test_abc123";
const REF = "mz_test_0123456789abcdef01234567";

let ledger: FakeLedger;
let audit: FakeAudit;
let sent: { to: string; subject: string; text: string }[];
let mailer: Mailer;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  ledger = new FakeLedger();
  ledger.churches.set("grace", makeChurch({ id: "c1", slug: "grace", name: "Grace Chapel" }));
  audit = new FakeAudit();
  sent = [];
  mailer = { send: async (m) => void sent.push(m) };
});

const notifier = (over: Partial<Parameters<typeof createNotifier>[0]> = {}) =>
  createNotifier({ ledger, audit, mailer, alertTo: "isaac@example.com", ...over });

async function giftFor(email?: string, amount = 10_000) {
  const giverId = email ? await ledger.createGiver({ fullName: "Ama", phone: "0551234987", email }) : undefined;
  return ledger.createGift({ reference: REF, churchId: "c1", giverId, giftType: "tithe", amountPesewas: amount, feePesewas: 301 });
}

describe("alerts", () => {
  it("emails the owner once an hour per kind of alert", async () => {
    const n = notifier();
    await n.alert("x", "Something odd", ["line"]);
    await n.alert("x", "Something odd", ["line"]);
    await n.alert("y", "Another thing", ["line"]);
    expect(sent.map((m) => m.subject)).toEqual(["[Maizz alert] Something odd", "[Maizz alert] Another thing"]);
    expect(sent[0]!.to).toBe("isaac@example.com");
    audit.shift(61);
    await n.alert("x", "Something odd", ["line"]);
    expect(sent).toHaveLength(3);
  });

  it("does nothing, and does not throw, when email or the address is missing or sending fails", async () => {
    await notifier({ mailer: null }).alert("x", "s", []);
    await notifier({ alertTo: null }).alert("x", "s", []);
    mailer.send = async () => {
      throw new Error("down");
    };
    await expect(notifier().alert("x", "s", [])).resolves.toBeUndefined();
    expect(sent).toHaveLength(0);
  });

  it("flags a large gift, and only a large one", async () => {
    const n = notifier({ largeGiftPesewas: 200_000 });
    await n.paid(await giftFor(undefined, 50_000));
    expect(sent).toHaveLength(0);
    await n.paid({ ...(await giftFor(undefined, 250_000)), reference: "other-ref-123" });
    expect(sent[0]!.subject).toContain("GH₵2,500.00");
    expect(sent[0]!.text).not.toMatch(/phone|name/i);
  });
});

describe("receipts", () => {
  it("emails a receipt to a giver who gave an email, with no provider name", async () => {
    const gift = await giftFor("ama@example.com");
    await notifier().paid(gift);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("ama@example.com");
    expect(sent[0]!.subject).toBe("Your receipt from Grace Chapel");
    expect(sent[0]!.text).toContain("GH₵100.00");
    expect(sent[0]!.text).toContain("GH₵3.01");
    expect(sent[0]!.text).toContain("GH₵103.01");
    expect(sent[0]!.text).toContain(REF);
    expect(sent[0]!.text.toLowerCase()).not.toContain("paystack");
    expect(audit.actions()).toContain("receipt.sent");
  });

  it("sends no receipt without an email, and a failed receipt never throws", async () => {
    await notifier().paid(await giftFor());
    expect(sent).toHaveLength(0);
    mailer.send = async () => {
      throw new Error("down");
    };
    const g = await ledger.createGift({ reference: "mz_test_aaaaaaaaaaaaaaaaaaaaaaaa", churchId: "c1", giverId: await ledger.createGiver({ fullName: "B", phone: "0551234987", email: "b@example.com" }), giftType: "tithe", amountPesewas: 100, feePesewas: 3 });
    await expect(notifier().paid(g)).resolves.toBeUndefined();
    expect(audit.actions()).toContain("receipt.failed");
  });

  it("formats a plain-text receipt", () => {
    const t = receiptText({ churchName: "Grace", giftType: "building", amountPesewas: 2000, feePesewas: 61, totalPesewas: 2061, createdAt: "2026-10-10T10:00:00Z", reference: "R1" });
    expect(t).toContain("Building fund");
    expect(t).toContain("Grace receives the full GH₵20.00");
  });
});

describe("webhook hooks", () => {
  const provider = createPaystackProvider({ secretKey: SECRET, fetchFn: mockFetch([]).fn });
  const post = (payload: unknown, signature?: string | null) => {
    const rawBody = JSON.stringify(payload);
    return processWebhook({ provider, ledger, rawBody, signature: signature === undefined ? sign(rawBody, SECRET) : signature, audit, notify: notifier() });
  };
  const success = (amount = 10_301) => ({ event: "charge.success", data: { id: 77, status: "success", reference: REF, amount, currency: "GHS" } });

  it("sends the receipt once, when the payment is first recorded", async () => {
    await giftFor("ama@example.com");
    await post(success());
    await post(success());
    expect(sent.filter((m) => m.to === "ama@example.com")).toHaveLength(1);
  });

  it("emails an alert for a wrong signature and for a wrong amount, and never records the wrong amount", async () => {
    await giftFor("ama@example.com");
    expect((await post(success(), "bad")).status).toBe(401);
    expect(sent.some((m) => m.subject.includes("wrong signature"))).toBe(true);
    await post(success(5));
    expect(sent.some((m) => m.subject.includes("did not match"))).toBe(true);
    expect(ledger.events).toHaveLength(0);
    expect(sent.some((m) => m.to === "ama@example.com")).toBe(false);
  });

  it("still records the payment when the notifier itself fails", async () => {
    await giftFor("ama@example.com");
    mailer.send = async () => {
      throw new Error("down");
    };
    const res = await post(success());
    expect(res.status).toBe(200);
    expect(ledger.events).toHaveLength(1);
  });
});

describe("daily check alert", () => {
  const provider = (status: "succeeded" | "failed"): PaymentProvider =>
    ({
      name: "paystack",
      capabilities: {} as PaymentProvider["capabilities"],
      verify: async () => ({ status, amountPesewas: 10_301, currency: "GHS", providerTransactionId: "1", rawStatus: status }),
    }) as unknown as PaymentProvider;

  it("emails when a paid gift is no longer confirmed, and not when all is well", async () => {
    const g = await giftFor();
    await ledger.addEvent({ giftId: g.id, status: "succeeded", providerEventId: "e1" });
    await reconcile({ ledger, provider: provider("succeeded"), audit, notify: notifier() });
    expect(sent.filter((m) => m.subject.includes("daily check"))).toHaveLength(0);
    await reconcile({ ledger, provider: provider("failed"), audit, notify: notifier() });
    expect(sent.some((m) => m.subject.includes("daily check"))).toBe(true);
  });
});

describe("checkout email", () => {
  const base = { church: "grace", amountPesewas: 10_000, giftType: "tithe", anonymous: false, fullName: "Ama Mensah", phone: "0551234987", network: "mtn" };

  it("takes an optional email only for a named gift", () => {
    expect(parseCheckout({ ...base, email: " Ama@Example.com " })).toMatchObject({ ok: true, input: { email: "ama@example.com" } });
    expect(parseCheckout({ ...base, email: "" })).toMatchObject({ ok: true });
    const anon = parseCheckout({ ...base, anonymous: true, email: "ama@example.com" });
    expect(anon.ok && anon.input.email).toBeUndefined();
    expect(parseCheckout({ ...base, email: "nope" })).toMatchObject({ ok: false });
  });

  it("stores the email and gives the provider the real address, or the stand-in when there is none", async () => {
    const offline = { json: { status: true, data: { status: "pay_offline", display_text: "approve" } } };
    for (const [email, expected] of [["ama@example.com", "ama@example.com"], [undefined, "giver@example.com"]] as const) {
      const m = mockFetch([offline]);
      const provider = createPaystackProvider({ secretKey: SECRET, fetchFn: m.fn });
      const parsed = parseCheckout({ ...base, email });
      if (!parsed.ok) throw new Error(parsed.error);
      await startCheckout({ ledger, provider, input: parsed.input, testMode: true });
      expect((m.calls[0]!.body as { email: string }).email).toBe(expected);
    }
    expect(ledger.givers.map((g) => g.email)).toEqual(["ama@example.com", undefined]);
  });
});

describe("books export", () => {
  it("pages through every gift and holds no names, phones or emails", async () => {
    const row = (i: number) => ({ reference: `R${i}`, church_id: "c", gift_type: "tithe", amount_pesewas: 100, fee_pesewas: 3, total_pesewas: 103, status: "succeeded", refunded_pesewas: 0, created_at: "2026-10-10T10:00:00Z" });
    const m = mockFetch([{ json: Array.from({ length: 1000 }, (_, i) => row(i)) }, { json: [row(1000)] }]);
    const csv = await exportBooksCsv({ url: "https://x.supabase.co", serviceKey: "sb_secret_a", fetchFn: m.fn });
    expect(csv.trim().split("\r\n")).toHaveLength(1002);
    expect(m.calls[1]!.url).toContain("offset=1000");
    expect(csv.split("\r\n")[0]).not.toMatch(/name|phone|email|giver/);
  });
});
