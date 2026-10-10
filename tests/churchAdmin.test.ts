import { beforeEach, describe, expect, it, vi } from "vitest";
import { runChurchAction, showChurch, slugFromName, type ChurchAction } from "../src/lib/churchAdmin";
import { ProviderError, type PaymentProvider } from "../src/lib/payments/types";
import { FakeLedger, makeChurch } from "./helpers";

let ledger: FakeLedger;
let created: unknown[];
let providerFails: boolean;

const provider = (): PaymentProvider =>
  ({
    name: "paystack",
    listPayoutBanks: async () => [
      { name: "MTN", code: "MTN", kind: "mobile_money" },
      { name: "GCB Bank", code: "040", kind: "bank" },
    ],
    createPayoutAccount: async (input: unknown) => {
      if (providerFails) throw new ProviderError("Paystack: invalid account 0551234987", 400);
      created.push(input);
      return { code: "ACCT_abc123xyz", accountName: "GRACE CHAPEL" };
    },
  }) as unknown as PaymentProvider;

const run = (action: ChurchAction, body: Record<string, unknown> = {}) =>
  runChurchAction({ ledger, provider: provider(), action, body });

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  ledger = new FakeLedger();
  created = [];
  providerFails = false;
});

describe("slugFromName", () => {
  it("makes safe web addresses", () => {
    expect(slugFromName("Grace Chapel, Accra!")).toBe("grace-chapel-accra");
    expect(slugFromName("  Église  de Dieu ")).toBe("eglise-de-dieu");
    expect(slugFromName("A".repeat(100)).length).toBeLessThanOrEqual(60);
    expect(slugFromName("!!!")).toBe("");
    expect(slugFromName("../etc")).toBe("etc");
  });
});

describe("adding a church", () => {
  it("starts it as pending, with a web address made from its name", async () => {
    const r = await run("create", { name: "Grace  Chapel" });
    expect(r.status).toBe(200);
    expect(r.body.church).toMatchObject({ slug: "grace-chapel", name: "Grace Chapel", status: "pending", payoutSet: false });
  });

  it("makes a different address when the name is already taken", async () => {
    await run("create", { name: "Grace Chapel" });
    const r = await run("create", { name: "Grace Chapel" });
    expect((r.body.church as { slug: string }).slug).toBe("grace-chapel-2");
  });

  it("refuses an empty or symbol-only name", async () => {
    expect((await run("create", { name: "" })).status).toBe(400);
    expect((await run("create", { name: "!!" })).status).toBe(400);
    expect((await run("create", { name: "x".repeat(101) })).status).toBe(400);
  });
});

describe("payout account", () => {
  beforeEach(async () => {
    await run("create", { name: "Grace Chapel" });
  });
  const payout = (over: Record<string, unknown> = {}) =>
    run("payout", { slug: "grace-chapel", bankCode: "MTN", accountNumber: "055 123 4987", ...over });

  it("sets it up, keeps only the last four digits, and shows the holder's name to check", async () => {
    const r = await payout();
    expect(r.status).toBe(200);
    expect(r.body.church).toMatchObject({ payoutSet: true, payoutBank: "MTN", payoutAccountLast4: "4987", payoutAccountName: "GRACE CHAPEL", status: "pending" });
    expect(JSON.stringify(r.body)).not.toContain("0551234987");
    expect(JSON.stringify(await ledger.listChurches())).not.toContain("0551234987");
    expect(created[0]).toMatchObject({ businessName: "Grace Chapel", bankCode: "MTN", accountNumber: "0551234987" });
  });

  it("takes the bank's name from the provider's list, not from the browser", async () => {
    const r = await payout({ bankName: "Fake Bank" });
    expect((r.body.church as { payoutBank: string }).payoutBank).toBe("MTN");
  });

  it("refuses unknown banks, bad numbers and unknown churches", async () => {
    expect((await payout({ bankCode: "ZZZ" })).status).toBe(400);
    expect((await payout({ accountNumber: "12" })).status).toBe(400);
    expect((await payout({ accountNumber: "abc123456" })).status).toBe(400);
    expect((await payout({ slug: "nope" })).status).toBe(404);
    expect(created).toHaveLength(0);
  });

  it("refuses to change the payout account of an active church", async () => {
    await payout();
    await run("activate", { slug: "grace-chapel", confirmed: true });
    expect((await payout()).status).toBe(400);
  });

  it("does not echo the provider's message, which could contain the number", async () => {
    providerFails = true;
    const r = await payout();
    expect(r.status).toBe(502);
    expect(JSON.stringify(r.body)).not.toContain("0551234987");
    expect(JSON.stringify(r.body)).not.toMatch(/paystack/i);
  });
});

describe("activating and suspending", () => {
  beforeEach(async () => {
    await run("create", { name: "Grace Chapel" });
  });

  it("will not activate without a payout account", async () => {
    const r = await run("activate", { slug: "grace-chapel", confirmed: true });
    expect(r.status).toBe(400);
    expect((await ledger.findChurch("grace-chapel"))!.status).toBe("pending");
  });

  it("will not activate without the owner's confirmation", async () => {
    await run("payout", { slug: "grace-chapel", bankCode: "MTN", accountNumber: "0551234987" });
    for (const confirmed of [undefined, false, "true", 1]) {
      expect((await run("activate", { slug: "grace-chapel", confirmed })).status).toBe(400);
    }
    expect((await ledger.findChurch("grace-chapel"))!.status).toBe("pending");
  });

  it("activates, then suspends, and refuses repeats", async () => {
    await run("payout", { slug: "grace-chapel", bankCode: "MTN", accountNumber: "0551234987" });
    expect((await run("activate", { slug: "grace-chapel", confirmed: true })).body.church).toMatchObject({ status: "active" });
    expect((await run("activate", { slug: "grace-chapel", confirmed: true })).status).toBe(400);
    expect((await run("suspend", { slug: "grace-chapel" })).body.church).toMatchObject({ status: "suspended" });
    expect((await run("suspend", { slug: "grace-chapel" })).status).toBe(400);
  });

  it("can bring a suspended church back, but still only with confirmation", async () => {
    await run("payout", { slug: "grace-chapel", bankCode: "MTN", accountNumber: "0551234987" });
    await run("activate", { slug: "grace-chapel", confirmed: true });
    await run("suspend", { slug: "grace-chapel" });
    expect((await run("activate", { slug: "grace-chapel" })).status).toBe(400);
    expect((await run("activate", { slug: "grace-chapel", confirmed: true })).status).toBe(200);
  });
});

describe("lists", () => {
  it("lists churches without any account number, and the banks", async () => {
    ledger.churches.set("t", makeChurch({ id: "c1", slug: "t", name: "T", subaccountCode: "ACCT_abc123xyz", payoutAccountLast4: "4987" }));
    const r = await run("list");
    expect(JSON.stringify(r.body)).not.toContain("ACCT_");
    expect(r.body.churches).toEqual([showChurch((await ledger.findChurch("t"))!)]);
    expect(((await run("banks")).body.banks as unknown[]).length).toBe(2);
  });
});
