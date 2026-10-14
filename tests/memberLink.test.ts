import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseCheckout, startCheckout } from "../src/lib/checkout";
import { handleMemberHistory, HISTORY_LIMITS } from "../src/lib/memberHistory";
import { churchMemberKey, LINK_MAX_SECONDS, memberMasterKey, signHistoryRequest, signMemberLink, verifyHistoryRequest, verifyMemberLink } from "../src/lib/memberLink";
import { handleOwnerChurches, type OwnerChurchDeps } from "../src/lib/ownerChurches";
import { createPaystackProvider } from "../src/lib/payments/paystack";
import { createStaffService, type Mailer } from "../src/lib/staff";
import { FakeAudit, FakeLedger, FakeStaffStore, makeChurch, mockFetch } from "./helpers";

const MASTER = "m".repeat(40);
const NOW = 1_800_000_000_000;
const nowS = Math.floor(NOW / 1000);
const keyV1 = churchMemberKey(MASTER, "c1", 1);

describe("memberLink keys and signatures", () => {
  it("needs a master key of 32+ characters", () => {
    expect(memberMasterKey({})).toBeNull();
    expect(memberMasterKey({ MEMBER_LINK_MASTER_KEY: "short" })).toBeNull();
    expect(memberMasterKey({ MEMBER_LINK_MASTER_KEY: MASTER })).toBe(MASTER);
  });

  it("makes a different key for each church and each version, and the same one every time", () => {
    expect(keyV1).toMatch(/^[0-9a-f]{64}$/);
    expect(churchMemberKey(MASTER, "c1", 1)).toBe(keyV1);
    expect(churchMemberKey(MASTER, "c2", 1)).not.toBe(keyV1);
    expect(churchMemberKey(MASTER, "c1", 2)).not.toBe(keyV1);
    expect(churchMemberKey("n".repeat(40), "c1", 1)).not.toBe(keyV1);
  });

  it("accepts a genuine link and returns the member", () => {
    const exp = nowS + 600;
    const s = signMemberLink(keyV1, "grace", "m_42", exp);
    expect(verifyMemberLink(keyV1, "grace", { member: "m_42", expires: String(exp), signature: s }, NOW)).toBe("m_42");
  });

  it("refuses a changed member, church, expiry or key", () => {
    const exp = nowS + 600;
    const s = signMemberLink(keyV1, "grace", "m_42", exp);
    const ok = { member: "m_42", expires: String(exp), signature: s };
    expect(verifyMemberLink(keyV1, "grace", { ...ok, member: "m_43" }, NOW)).toBeNull();
    expect(verifyMemberLink(keyV1, "other", ok, NOW)).toBeNull();
    expect(verifyMemberLink(keyV1, "grace", { ...ok, expires: String(exp + 1) }, NOW)).toBeNull();
    expect(verifyMemberLink(churchMemberKey(MASTER, "c1", 2), "grace", ok, NOW)).toBeNull();
  });

  it("refuses an expired link, and one that lasts longer than six hours", () => {
    const old = nowS - 1;
    expect(verifyMemberLink(keyV1, "grace", { member: "m", expires: String(old), signature: signMemberLink(keyV1, "grace", "m", old) }, NOW)).toBeNull();
    const far = nowS + LINK_MAX_SECONDS + 5;
    expect(verifyMemberLink(keyV1, "grace", { member: "m", expires: String(far), signature: signMemberLink(keyV1, "grace", "m", far) }, NOW)).toBeNull();
  });

  it("refuses odd member references and odd signatures", () => {
    const exp = nowS + 60;
    for (const member of ["", "a b", "x".repeat(65), "../x", "a.b", 5, null]) {
      const sig = typeof member === "string" ? signMemberLink(keyV1, "grace", member, exp) : "0".repeat(64);
      expect(verifyMemberLink(keyV1, "grace", { member, expires: exp, signature: sig }, NOW), String(member)).toBeNull();
    }
    for (const signature of ["", "xyz", "A".repeat(64), undefined, 7]) {
      expect(verifyMemberLink(keyV1, "grace", { member: "m", expires: exp, signature }, NOW)).toBeNull();
    }
  });

  it("a link signature is not a history signature, and the other way round", () => {
    const t = nowS;
    expect(signMemberLink(keyV1, "grace", "m", t)).not.toBe(signHistoryRequest(keyV1, "grace", "m", t));
  });

  it("history requests must be fresh (five minutes either way)", () => {
    const ok = (ts: number) => verifyHistoryRequest(keyV1, "grace", { member: "m", timestamp: ts, signature: signHistoryRequest(keyV1, "grace", "m", ts) }, NOW);
    expect(ok(nowS)).toBe("m");
    expect(ok(nowS - 299)).toBe("m");
    expect(ok(nowS + 299)).toBe("m");
    expect(ok(nowS - 301)).toBeNull();
    expect(ok(nowS + 301)).toBeNull();
  });
});

describe("checkout with a Church Manager link", () => {
  let ledger: FakeLedger;
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    ledger = new FakeLedger();
    ledger.churches.set("grace", makeChurch({ id: "c1", slug: "grace", name: "Grace", memberLinkEnabled: true }));
  });
  const base = { church: "grace", amountPesewas: 10_000, giftType: "tithe", fullName: "Ama Mensah", phone: "0551234987", network: "mtn", anonymous: false };
  const offline = { json: { status: true, data: { status: "pay_offline", display_text: "approve" } } };

  async function run(over: Record<string, unknown>, master: string | null = MASTER) {
    const m = mockFetch([offline]);
    const provider = createPaystackProvider({ secretKey: "sk_test_abc", fetchFn: m.fn });
    const parsed = parseCheckout({ ...base, ...over });
    if (!parsed.ok) throw new Error(parsed.error);
    await startCheckout({ ledger, provider, input: parsed.input, testMode: true, memberLinkMaster: master });
    return ledger.memberRefs.get(ledger.gifts[0]!.reference);
  }
  const link = (member = "m_7", exp = Math.floor(Date.now() / 1000) + 600, key = keyV1) => ({ ref: member, expires: exp, signature: signMemberLink(key, "grace", member, exp) });

  it("tags the gift with a genuine link", async () => {
    expect(await run({ member: link() })).toBe("m_7");
  });
  it("never tags an anonymous gift", async () => {
    expect(await run({ anonymous: true, member: link() })).toBeUndefined();
  });
  it("ignores a forged link, an old key, a switched-off church and a missing master key", async () => {
    expect(await run({ member: { ...link(), signature: "0".repeat(64) } })).toBeUndefined();
    ledger.gifts.length = 0;
    expect(await run({ member: link("m_7", undefined, churchMemberKey(MASTER, "c1", 2)) })).toBeUndefined();
    ledger.gifts.length = 0;
    expect(await run({ member: link() }, null)).toBeUndefined();
    ledger.gifts.length = 0;
    ledger.churches.get("grace")!.memberLinkEnabled = false;
    expect(await run({ member: link() })).toBeUndefined();
  });
  it("still takes the gift when the link is bad", async () => {
    await run({ member: { ref: "m", expires: 1, signature: "no" } });
    expect(ledger.gifts).toHaveLength(1);
  });
  it("stops working once the church's key is replaced", async () => {
    const l = link();
    await ledger.setMemberLink("c1", { replaceKey: true });
    expect(await run({ member: l })).toBeUndefined();
  });
});

describe("history", () => {
  let ledger: FakeLedger;
  let audit: FakeAudit;
  let alerts: number;
  beforeEach(async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    ledger = new FakeLedger();
    audit = new FakeAudit();
    alerts = 0;
    ledger.churches.set("grace", makeChurch({ id: "c1", slug: "grace", name: "Grace", memberLinkEnabled: true }));
    ledger.churches.set("other", makeChurch({ id: "c2", slug: "other", name: "Other", memberLinkEnabled: true }));
    const add = async (ref: string, churchId: string, member: string | undefined, paid: boolean, amount = 10_000) => {
      const g = await ledger.createGift({ reference: ref, churchId, amountPesewas: amount, feePesewas: 301, giftType: "tithe", memberRef: member });
      await ledger.addEvent({ giftId: g.id, status: paid ? "succeeded" : "pending" });
    };
    await add("mz_test_aaaaaaaa", "c1", "m_1", true);
    await add("mz_test_bbbbbbbb", "c1", "m_1", false);
    await add("mz_test_cccccccc", "c1", "m_2", true);
    await add("mz_test_dddddddd", "c1", undefined, true);
    await add("mz_test_eeeeeeee", "c2", "m_1", true);
  });

  const ask = (over: Record<string, unknown> = {}, d: Partial<Parameters<typeof handleMemberHistory>[0]> = {}) => {
    const ts = nowS;
    const body = { church: "grace", member: "m_1", timestamp: ts, signature: signHistoryRequest(keyV1, "grace", "m_1", ts), ...over };
    return handleMemberHistory({ body, ledger, audit, master: MASTER, source: "s1", nowMs: NOW, onBadSpike: async () => void (alerts += 1), ...d });
  };

  it("lists only that member's paid gifts at that church, with no reference or personal detail", async () => {
    const res = await ask();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const data = (await res.json()) as { gifts: Record<string, unknown>[] };
    expect(data.gifts).toHaveLength(1);
    expect(data.gifts[0]).toMatchObject({ type: "tithe", giftPesewas: 10_000, paidPesewas: 10_301, refundedPesewas: 0 });
    expect(JSON.stringify(data)).not.toMatch(/mz_test|Ama|055/);
  });
  it("shows a refund", async () => {
    const g = ledger.gifts.find((x) => x.reference === "mz_test_aaaaaaaa")!;
    await ledger.addEvent({ giftId: g.id, status: "refunded", amountPesewas: 10_000 });
    const data = (await (await ask()).json()) as { gifts: { refundedPesewas: number }[] };
    expect(data.gifts[0]!.refundedPesewas).toBe(10_000);
  });
  it("answers every refusal the same way", async () => {
    const stale = nowS - 4000;
    const cases = [
      { signature: "0".repeat(64) },
      { church: "nope" },
      { church: "other" },
      { member: "m_2" },
      { timestamp: stale, signature: signHistoryRequest(keyV1, "grace", "m_1", stale) },
    ];
    for (const c of cases) {
      const res = await ask(c);
      expect(res.status, JSON.stringify(c)).toBe(401);
      expect(await res.json()).toEqual({ error: "Not allowed" });
    }
    ledger.churches.get("grace")!.memberLinkEnabled = false;
    expect((await ask()).status).toBe(401);
  });
  it("is off without the master key, and a replaced key stops working", async () => {
    expect((await ask({}, { master: null })).status).toBe(401);
    await ledger.setMemberLink("c1", { replaceKey: true });
    expect((await ask()).status).toBe(401);
  });
  it("blocks a source after too many bad signatures, then even good ones wait", async () => {
    for (let i = 0; i < HISTORY_LIMITS.badPerSource; i += 1) await ask({ signature: "0".repeat(64) });
    expect((await ask()).status).toBe(429);
    expect((await ask({}, { source: "s2" })).status).toBe(200);
  });
  it("raises one alert when bad signatures pile up across the site", async () => {
    for (let i = 0; i < HISTORY_LIMITS.badSiteAlert + 5; i += 1) await ask({ signature: "0".repeat(64) }, { source: `s${i}` });
    expect(alerts).toBe(1);
  });
  it("rejects a body that is not an object", async () => {
    expect((await ask({}, { body: "x" })).status).toBe(400);
  });
  it("keeps counters out of the permanent log", async () => {
    await ask();
    await ask({ signature: "0".repeat(64) });
    expect(audit.entries).toHaveLength(0);
  });
});

describe("owner switch for the Church Manager link", () => {
  const PEPPER = "p".repeat(40);
  const PASSWORD = "correct horse battery";
  let audit: FakeAudit;
  let ledger: FakeLedger;
  let mails: { to: string; subject: string; text: string }[];
  let ownerSvc: ReturnType<typeof createStaffService>;
  let cookie: string;

  async function signIn(): Promise<string> {
    await ownerSvc.invite({ churchId: "platform", churchName: "Maizz", email: "o@x.test", fullName: "Kobina", role: "owner", baseUrl: "https://x.test" });
    await ownerSvc.acceptInvite(/token=([\w-]+)/.exec(mails.at(-1)!.text)![1]!, PASSWORD);
    const s = await ownerSvc.signIn("o@x.test", PASSWORD, "src");
    if (!s.ok) throw new Error("sign in");
    const c = await ownerSvc.verifyCode(s.challenge, /sign-in code is (\d{6})/.exec(mails.at(-1)!.text)![1]!, "src");
    if (!c.ok) throw new Error("code");
    return c.sessionToken;
  }
  const call = (body: Record<string, unknown>, master: string | null = MASTER) =>
    handleOwnerChurches({
      req: new Request("https://x.test/api/owner/churches", { method: "POST", headers: { "content-type": "application/json", origin: "https://x.test" }, body: JSON.stringify(body) }),
      ownerService: ownerSvc,
      churchService: createStaffService({ store: new FakeStaffStore(), audit, mailer: { send: async () => {} }, pepper: PEPPER, area: "church" }),
      listChurchPeople: async () => [],
      audit,
      ledger,
      provider: {} as never,
      cookie,
      source: "src",
      baseUrl: "https://x.test",
      memberMaster: master,
    } satisfies OwnerChurchDeps);

  beforeEach(async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    audit = new FakeAudit();
    ledger = new FakeLedger();
    mails = [];
    const mailer: Mailer = { send: async (m) => void mails.push(m) };
    ownerSvc = createStaffService({ store: new FakeStaffStore(), audit, mailer, pepper: PEPPER, area: "owner" });
    ledger.churches.set("grace", makeChurch({ id: "c1", slug: "grace", name: "Grace" }));
    cookie = await signIn();
  });

  it("starts off, turns on and off, and records each change first", async () => {
    expect(((await (await call({ action: "member_link", slug: "grace" })).json()) as { memberLink: { enabled: boolean } }).memberLink.enabled).toBe(false);
    expect((await call({ action: "member_link_on", slug: "grace" })).status).toBe(200);
    expect(ledger.churches.get("grace")!.memberLinkEnabled).toBe(true);
    expect((await call({ action: "member_link_off", slug: "grace" })).status).toBe(200);
    expect(ledger.churches.get("grace")!.memberLinkEnabled).toBe(false);
    expect(audit.entries.map((e) => e.action)).toEqual(expect.arrayContaining(["owner.church_member_link_on", "owner.church_member_link_off"]));
  });
  it("changes nothing if the audit log is down", async () => {
    audit.failWrites = true;
    expect((await call({ action: "member_link_on", slug: "grace" })).status).toBe(503);
    expect(ledger.churches.get("grace")!.memberLinkEnabled).toBe(false);
  });
  it("cannot be turned on without the master key", async () => {
    expect((await call({ action: "member_link_on", slug: "grace" }, null)).status).toBe(503);
    expect((await call({ action: "member_link_key", slug: "grace" }, null)).status).toBe(503);
  });
  it("needs a signed-in owner", async () => {
    cookie = "nope";
    expect((await call({ action: "member_link_on", slug: "grace" })).status).toBe(401);
  });
  it("shows the key only after a fresh code, and a new key replaces the old one", async () => {
    expect((await call({ action: "member_link_key", slug: "grace", challenge: "x", code: "123456" })).status).toBe(403);
    const ask = await call({ action: "payout_code", slug: "grace" });
    const { challenge } = (await ask.json()) as { challenge: string };
    const code = /confirmation code is (\d{6})/.exec(mails.at(-1)!.text)![1]!;
    const shown = await call({ action: "member_link_key", slug: "grace", challenge, code });
    expect(shown.status).toBe(200);
    expect(shown.headers.get("cache-control")).toBe("no-store");
    expect(((await shown.json()) as { key: string }).key).toBe(keyV1);
    expect(audit.entries.some((e) => e.action === "owner.church_member_link_key_shown")).toBe(true);
    // The same code cannot be used twice.
    expect((await call({ action: "member_link_key", slug: "grace", challenge, code })).status).toBe(403);
    expect((await call({ action: "member_link_new_key", slug: "grace" })).status).toBe(200);
    expect(ledger.churches.get("grace")!.memberLinkVersion).toBe(2);
  });
});
