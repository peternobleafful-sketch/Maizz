import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleOwnerChurches, type OwnerChurchDeps } from "../src/lib/ownerChurches";
import type { PaymentProvider } from "../src/lib/payments/types";
import { createStaffService, type Mailer } from "../src/lib/staff";
import { FakeAudit, FakeLedger, FakeStaffStore } from "./helpers";

const PEPPER = "p".repeat(40);
const PASSWORD = "correct horse battery";
let clock: number;
let audit: FakeAudit;
let ledger: FakeLedger;
let ownerStore: FakeStaffStore;
let churchStore: FakeStaffStore;
let mails: { to: string; subject: string; text: string }[];
let created: unknown[];
let ownerSvc: ReturnType<typeof createStaffService>;
let churchSvc: ReturnType<typeof createStaffService>;

const provider = {
  name: "paystack",
  listPayoutBanks: async () => [{ name: "MTN", code: "MTN", kind: "mobile_money" }],
  createPayoutAccount: async (input: unknown) => {
    created.push(input);
    return { code: "ACCT_abc123xyz", accountName: "GRACE CHAPEL" };
  },
} as unknown as PaymentProvider;

const lastMail = () => mails.at(-1)!;
const tokenFromMail = () => /token=([\w-]+)/.exec(lastMail().text)![1]!;

async function signInOwner(email: string): Promise<string> {
  await ownerSvc.invite({ churchId: "platform", churchName: "Maizz", email, fullName: "Kobina", role: "owner", baseUrl: "https://x.test" });
  await ownerSvc.acceptInvite(tokenFromMail(), PASSWORD);
  const s = await ownerSvc.signIn(email, PASSWORD, "src");
  if (!s.ok) throw new Error("sign in");
  const code = /sign-in code is (\d{6})/.exec(lastMail().text)![1]!;
  const c = await ownerSvc.verifyCode(s.challenge, code, "src");
  if (!c.ok) throw new Error("code");
  return c.sessionToken;
}

function call(cookie: string | undefined, body: Record<string, unknown>, headers: Record<string, string> = { origin: "https://x.test" }) {
  const req = new Request("https://x.test/api/owner/churches", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const deps: OwnerChurchDeps = {
    req,
    ownerService: ownerSvc,
    churchService: churchSvc,
    listChurchPeople: (id) => churchStore.listUsers(id),
    audit,
    ledger,
    provider,
    cookie,
    source: "src",
    baseUrl: "https://x.test",
  };
  return handleOwnerChurches(deps);
}

async function askCode(cookie: string): Promise<{ challenge: string; code: string }> {
  const res = await call(cookie, { action: "payout_code", slug: "grace" });
  expect(res.status).toBe(200);
  const { challenge } = (await res.json()) as { challenge: string };
  return { challenge, code: /confirmation code is (\d{6})/.exec(lastMail().text)![1]! };
}

const PAYOUT = { action: "payout", slug: "grace", bankCode: "MTN", accountNumber: "0551234987" };

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  clock = 1_000_000_000_000;
  audit = new FakeAudit();
  ledger = new FakeLedger();
  ownerStore = new FakeStaffStore();
  churchStore = new FakeStaffStore();
  mails = [];
  created = [];
  const mailer: Mailer = { send: async (m) => void mails.push(m) };
  ownerSvc = createStaffService({ store: ownerStore, audit, mailer, pepper: PEPPER, now: () => clock, area: "owner" });
  churchSvc = createStaffService({ store: churchStore, audit, mailer, pepper: PEPPER, now: () => clock, area: "church" });
  await ledger.createChurch({ slug: "grace", name: "Grace Chapel" });
});

describe("owner church tools: who can use them", () => {
  it("refuses a request with no sign-in, a made-up cookie, or from another website", async () => {
    expect((await call(undefined, { action: "list" })).status).toBe(401);
    expect((await call("x".repeat(43), { action: "list" })).status).toBe(401);
    const owner = await signInOwner("kobina@maizz.test");
    expect((await call(owner, { action: "list" }, { origin: "https://evil.test" })).status).toBe(403);
    expect((await call(owner, { action: "list" }, {})).status).toBe(403);
    expect((await call(owner, { action: "list" })).status).toBe(200);
  });

  it("does not accept a church person's session", async () => {
    await churchSvc.invite({ churchId: "c1", churchName: "Grace", email: "ama@church.org", fullName: "Ama", role: "owner", baseUrl: "https://x.test" });
    await churchSvc.acceptInvite(tokenFromMail(), PASSWORD);
    const s = await churchSvc.signIn("ama@church.org", PASSWORD, "src2");
    if (!s.ok) throw new Error("sign in");
    const code = /sign-in code is (\d{6})/.exec(lastMail().text)![1]!;
    const c = await churchSvc.verifyCode(s.challenge, code, "src2");
    if (!c.ok) throw new Error("code");
    expect((await call(c.sessionToken, { action: "list" })).status).toBe(401);
    expect((await call(c.sessionToken, PAYOUT)).status).toBe(401);
    expect(created).toHaveLength(0);
  });
});

describe("owner church tools: changing a payout account", () => {
  it("refuses without a fresh code, and never reaches the payment provider", async () => {
    const owner = await signInOwner("kobina@maizz.test");
    const noCode = await call(owner, PAYOUT);
    expect(noCode.status).toBe(403);
    const { challenge } = await askCode(owner);
    expect((await call(owner, { ...PAYOUT, challenge, code: "000000" })).status).toBe(403);
    expect((await call(owner, { ...PAYOUT, challenge, code: "abc" })).status).toBe(403);
    expect(created).toHaveLength(0);
    expect(audit.actions()).not.toContain("owner.church_payout");
  });

  it("accepts the right code once, records it first, and emails the church's owners", async () => {
    await churchSvc.invite({ churchId: "church-1", churchName: "Grace Chapel", email: "ama@church.org", fullName: "Ama", role: "owner", baseUrl: "https://x.test" });
    await churchSvc.invite({ churchId: "church-1", churchName: "Grace Chapel", email: "kofi@church.org", fullName: "Kofi", role: "viewer", baseUrl: "https://x.test" });
    const owner = await signInOwner("kobina@maizz.test");
    const { challenge, code } = await askCode(owner);
    const ok = await call(owner, { ...PAYOUT, challenge, code });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { emailed: number; church: { payoutAccountLast4: string } };
    expect(body.church.payoutAccountLast4).toBe("4987");
    expect(body.emailed).toBe(1);
    expect(created).toHaveLength(1);
    const notice = mails.filter((m) => m.to === "ama@church.org").at(-1)!;
    expect(notice.text).toContain("•••• 4987");
    expect(notice.text).toContain("by Maizz");
    expect(mails.some((m) => m.to === "kofi@church.org" && /payout/.test(m.subject))).toBe(false);
    expect(audit.actions()).toContain("owner.church_payout");
    // The same code cannot be used again.
    expect((await call(owner, { ...PAYOUT, challenge, code })).status).toBe(403);
    expect(created).toHaveLength(1);
  });

  it("never writes the full account number to the audit log or the emails", async () => {
    const owner = await signInOwner("kobina@maizz.test");
    const { challenge, code } = await askCode(owner);
    await call(owner, { ...PAYOUT, challenge, code });
    expect(JSON.stringify(audit.entries)).not.toContain("0551234987");
    expect(JSON.stringify(mails)).not.toContain("0551234987");
  });

  it("does not let one owner use a code that was sent to another owner", async () => {
    const a = await signInOwner("a@maizz.test");
    const b = await signInOwner("b@maizz.test");
    const { challenge, code } = await askCode(a);
    expect((await call(b, { ...PAYOUT, challenge, code })).status).toBe(403);
    expect(created).toHaveLength(0);
    // The sign-in code of an owner is not a payout code either.
    expect((await call(a, { ...PAYOUT, challenge: "00000000-0000-0000-0000-000000000000", code })).status).toBe(403);
  });

  it("lets an old code expire after ten minutes, and gives up after five wrong tries", async () => {
    const owner = await signInOwner("kobina@maizz.test");
    const first = await askCode(owner);
    clock += 11 * 60_000;
    expect((await call(owner, { ...PAYOUT, ...first })).status).toBe(403);
    const second = await askCode(owner);
    for (let i = 0; i < 5; i++) await call(owner, { ...PAYOUT, challenge: second.challenge, code: "111111" });
    expect((await call(owner, { ...PAYOUT, ...second })).status).toBeGreaterThanOrEqual(403);
    expect(created).toHaveLength(0);
  });

  it("limits how many codes can be asked for", async () => {
    const owner = await signInOwner("kobina@maizz.test");
    for (let i = 0; i < 5; i++) expect((await call(owner, { action: "payout_code", slug: "grace" })).status).toBe(200);
    expect((await call(owner, { action: "payout_code", slug: "grace" })).status).toBe(429);
  });

  it("refuses to change anything when the audit log cannot be written", async () => {
    const owner = await signInOwner("kobina@maizz.test");
    const { challenge, code } = await askCode(owner);
    audit.failWrites = true;
    expect((await call(owner, { ...PAYOUT, challenge, code })).status).toBe(503);
    expect(created).toHaveLength(0);
  });
});

describe("owner church tools: other actions", () => {
  it("adds, activates and suspends a church, recording each first", async () => {
    const owner = await signInOwner("kobina@maizz.test");
    const add = await call(owner, { action: "create", name: "Hope Church" });
    expect(add.status).toBe(200);
    ledger.churches.get("grace")!.subaccountCode = "ACCT_x";
    expect((await call(owner, { action: "activate", slug: "grace" })).status).toBe(400);
    expect((await call(owner, { action: "activate", slug: "grace", confirmed: true })).status).toBe(200);
    expect(ledger.churches.get("grace")!.status).toBe("active");
    expect((await call(owner, { action: "suspend", slug: "grace" })).status).toBe(200);
    expect(ledger.churches.get("grace")!.status).toBe("suspended");
    expect(audit.actions()).toEqual(expect.arrayContaining(["owner.church_create", "owner.church_activate", "owner.church_suspend"]));
    audit.failWrites = true;
    expect((await call(owner, { action: "activate", slug: "grace", confirmed: true })).status).toBe(503);
    expect(ledger.churches.get("grace")!.status).toBe("suspended");
  });

  it("shows a church's team and resends an invite only to someone in that church", async () => {
    const person = await churchSvc.invite({ churchId: "church-1", churchName: "Grace Chapel", email: "ama@church.org", fullName: "Ama", role: "owner", baseUrl: "https://x.test" });
    const stranger = await churchSvc.invite({ churchId: "other", churchName: "Other", email: "z@other.org", fullName: "Zed", role: "owner", baseUrl: "https://x.test" });
    const owner = await signInOwner("kobina@maizz.test");
    const team = (await (await call(owner, { action: "team", slug: "grace" })).json()) as { people: { email: string }[] };
    expect(team.people.map((p) => p.email)).toEqual(["ama@church.org"]);
    const before = mails.length;
    expect((await call(owner, { action: "resend", slug: "grace", userId: person.id })).status).toBe(200);
    expect(mails.length).toBe(before + 1);
    expect((await call(owner, { action: "resend", slug: "grace", userId: stranger.id })).status).toBe(404);
  });
});
