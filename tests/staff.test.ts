import { beforeEach, describe, expect, it } from "vitest";
import {
  createStaffService,
  hashPassword,
  passwordProblem,
  verifyPassword,
  StaffError,
  type Mailer,
  type StaffStore,
  type StaffToken,
  type StaffUser,
  type TokenKind,
} from "../src/lib/staff";
import { FakeAudit } from "./helpers";

class FakeStaffStore implements StaffStore {
  users: StaffUser[] = [];
  tokens: StaffToken[] = [];
  n = 0;
  async findUserByEmail(email: string) {
    return this.users.find((u) => u.email === email) ?? null;
  }
  async getUser(id: string) {
    return this.users.find((u) => u.id === id) ?? null;
  }
  async listUsers(churchId: string) {
    return this.users.filter((u) => u.churchId === churchId);
  }
  async createUser(u: { churchId: string; email: string; fullName: string; role: StaffUser["role"] }) {
    if (this.users.some((x) => x.email === u.email)) throw new StaffError("exists", "exists");
    const user: StaffUser = { id: `00000000-0000-0000-0000-${String(++this.n).padStart(12, "0")}`, ...u, status: "invited", passwordHash: null, failedAttempts: 0, lockedUntil: null };
    this.users.push(user);
    return user;
  }
  async updateUser(id: string, patch: Parameters<StaffStore["updateUser"]>[1]) {
    Object.assign(this.users.find((u) => u.id === id)!, patch);
  }
  async createToken(t: { userId: string; kind: TokenKind; tokenHash: string; expiresAt: number }) {
    const token: StaffToken = { id: `10000000-0000-0000-0000-${String(++this.n).padStart(12, "0")}`, ...t, attempts: 0, usedAt: null };
    this.tokens.push(token);
    return token.id;
  }
  async findTokenByHash(kind: TokenKind, tokenHash: string) {
    return this.tokens.find((t) => t.kind === kind && t.tokenHash === tokenHash) ?? null;
  }
  async getToken(id: string) {
    return this.tokens.find((t) => t.id === id) ?? null;
  }
  async consumeToken(id: string) {
    const t = this.tokens.find((x) => x.id === id)!;
    if (t.usedAt !== null) return false;
    t.usedAt = 1;
    return true;
  }
  async setTokenAttempts(id: string, attempts: number) {
    this.tokens.find((x) => x.id === id)!.attempts = attempts;
  }
  async revokeTokens(userId: string, kind: TokenKind) {
    for (const t of this.tokens) if (t.userId === userId && t.kind === kind && t.usedAt === null) t.usedAt = 1;
  }
}

const PEPPER = "p".repeat(40);
const PASSWORD = "correct horse battery";

let store: FakeStaffStore;
let audit: FakeAudit;
let sent: { to: string; subject: string; text: string }[];
let clock: number;
let mailer: Mailer;
let svc: ReturnType<typeof createStaffService>;

beforeEach(() => {
  store = new FakeStaffStore();
  audit = new FakeAudit();
  sent = [];
  clock = 1_000_000_000_000;
  mailer = { send: async (m) => void sent.push(m) };
  svc = createStaffService({ store, audit, mailer, pepper: PEPPER, now: () => clock });
});

const codeFromMail = () => /sign-in code is (\d{6})/.exec(sent.at(-1)!.text)![1]!;
const tokenFromMail = () => /token=([\w-]+)/.exec(sent.at(-1)!.text)![1]!;

async function activeUser(email = "ama@church.org") {
  const user = await svc.invite({ churchId: "c1", churchName: "Grace", email, fullName: "Ama Boateng", role: "owner", baseUrl: "https://x.test" });
  expect(await svc.acceptInvite(tokenFromMail(), PASSWORD)).toEqual({ ok: true });
  return user;
}

describe("passwords", () => {
  it("hashes with a salt and checks them", async () => {
    const a = await hashPassword(PASSWORD);
    const b = await hashPassword(PASSWORD);
    expect(a).not.toBe(b);
    expect(a).not.toContain(PASSWORD);
    expect(await verifyPassword(PASSWORD, a)).toBe(true);
    expect(await verifyPassword("wrong password here", a)).toBe(false);
    expect(await verifyPassword(PASSWORD, null)).toBe(false);
    expect(await verifyPassword(PASSWORD, "garbage")).toBe(false);
  });
  it("asks for at least 12 characters", () => {
    expect(passwordProblem("short")).toMatch(/12/);
    expect(passwordProblem("aaaaaaaaaaaaaa")).not.toBeNull();
    expect(passwordProblem(PASSWORD)).toBeNull();
  });
});

describe("invite", () => {
  it("emails a one-use link and stores only a hash", async () => {
    await svc.invite({ churchId: "c1", churchName: "Grace", email: " Ama@Church.org ", fullName: "Ama", role: "finance", baseUrl: "https://x.test/" });
    const link = tokenFromMail();
    expect(sent[0]!.to).toBe("ama@church.org");
    expect(sent[0]!.text).toContain("https://x.test/church/invite?token=");
    expect(store.tokens.every((t) => !t.tokenHash.includes(link))).toBe(true);
    expect(await svc.acceptInvite(link, "short")).toMatchObject({ ok: false, reason: "weak" });
    expect(await svc.acceptInvite(link, PASSWORD)).toEqual({ ok: true });
    expect(await svc.acceptInvite(link, PASSWORD)).toMatchObject({ ok: false, reason: "invalid" });
    expect(store.users[0]!.status).toBe("active");
  });
  it("refuses a bad email, a bad role and a repeated email", async () => {
    const base = { churchId: "c1", churchName: "G", fullName: "A", baseUrl: "https://x.test" };
    await expect(svc.invite({ ...base, email: "nope", role: "owner" })).rejects.toMatchObject({ code: "bad_input" });
    await expect(svc.invite({ ...base, email: "a@b.co", role: "boss" as never })).rejects.toMatchObject({ code: "bad_input" });
    await svc.invite({ ...base, email: "a@b.co", role: "viewer" });
    await expect(svc.invite({ ...base, email: "A@b.co", role: "viewer" })).rejects.toMatchObject({ code: "exists" });
  });
  it("an old link stops working after two days", async () => {
    await svc.invite({ churchId: "c1", churchName: "G", email: "a@b.co", fullName: "A", role: "viewer", baseUrl: "https://x.test" });
    clock += 49 * 3_600_000;
    expect(await svc.acceptInvite(tokenFromMail(), PASSWORD)).toMatchObject({ ok: false, reason: "invalid" });
  });
  it("a resent invite replaces the old one", async () => {
    const u = await svc.invite({ churchId: "c1", churchName: "G", email: "a@b.co", fullName: "A", role: "viewer", baseUrl: "https://x.test" });
    const first = tokenFromMail();
    await svc.resendInvite({ userId: u.id, churchName: "G", baseUrl: "https://x.test" });
    expect(await svc.acceptInvite(first, PASSWORD)).toMatchObject({ ok: false });
    expect(await svc.acceptInvite(tokenFromMail(), PASSWORD)).toEqual({ ok: true });
  });
});

describe("two-step sign-in", () => {
  it("password, then the emailed code, then a session", async () => {
    await activeUser();
    const one = await svc.signIn("ama@church.org", PASSWORD, "src");
    expect(one.ok).toBe(true);
    if (!one.ok) return;
    expect(sent.at(-1)!.subject).toContain(codeFromMail());
    const two = await svc.verifyCode(one.challenge, codeFromMail(), "src");
    expect(two.ok).toBe(true);
    if (!two.ok) return;
    expect((await svc.getSession(two.sessionToken))?.user.email).toBe("ama@church.org");
    expect(store.tokens.every((t) => !t.tokenHash.includes(two.sessionToken))).toBe(true);
    await svc.signOut(two.sessionToken);
    expect(await svc.getSession(two.sessionToken)).toBeNull();
    expect(audit.actions()).toEqual(expect.arrayContaining(["staff.code_sent", "staff.signin", "staff.signout"]));
  });

  it("wrong password, unknown email and a not-yet-active person all look the same and send no email", async () => {
    await activeUser();
    await svc.invite({ churchId: "c1", churchName: "G", email: "new@church.org", fullName: "N", role: "viewer", baseUrl: "https://x.test" });
    const before = sent.length;
    for (const [e, p] of [["ama@church.org", "wrong wrong wrong"], ["ghost@church.org", PASSWORD], ["new@church.org", PASSWORD]] as const) {
      expect(await svc.signIn(e, p, "src")).toEqual({ ok: false, reason: "wrong" });
    }
    expect(sent.length).toBe(before);
  });

  it("a wrong code is refused, and five wrong codes lock the person", async () => {
    await activeUser();
    const one = await svc.signIn("ama@church.org", PASSWORD, "src");
    if (!one.ok) throw new Error("expected ok");
    const right = codeFromMail();
    const wrong = right === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect(await svc.verifyCode(one.challenge, wrong, `s${i}`)).toMatchObject({ ok: false });
    expect(await svc.verifyCode(one.challenge, right, "s9")).toMatchObject({ ok: false });
    expect(await svc.signIn("ama@church.org", PASSWORD, "s10")).toEqual({ ok: false, reason: "locked" });
    clock += 16 * 60_000;
    expect((await svc.signIn("ama@church.org", PASSWORD, "s11")).ok).toBe(true);
  });

  it("five wrong passwords lock the person, even for the right password", async () => {
    await activeUser();
    for (let i = 0; i < 5; i++) await svc.signIn("ama@church.org", "wrong wrong wrong", `s${i}`);
    expect(await svc.signIn("ama@church.org", PASSWORD, "s9")).toEqual({ ok: false, reason: "locked" });
    expect(audit.actions()).toContain("staff.locked");
  });

  it("many wrong tries from one place lock that place, whoever they try", async () => {
    await activeUser();
    for (let i = 0; i < 10; i++) await svc.signIn(`ghost${i}@church.org`, "wrong wrong wrong", "same");
    expect(await svc.signIn("ama@church.org", PASSWORD, "same")).toEqual({ ok: false, reason: "locked" });
    expect((await svc.signIn("ama@church.org", PASSWORD, "elsewhere")).ok).toBe(true);
  });

  it("a code works once and expires after 10 minutes", async () => {
    await activeUser();
    const a = await svc.signIn("ama@church.org", PASSWORD, "src");
    if (!a.ok) throw new Error("expected ok");
    const code = codeFromMail();
    expect((await svc.verifyCode(a.challenge, code, "src")).ok).toBe(true);
    expect(await svc.verifyCode(a.challenge, code, "src")).toEqual({ ok: false, reason: "expired" });
    const b = await svc.signIn("ama@church.org", PASSWORD, "src");
    if (!b.ok) throw new Error("expected ok");
    clock += 11 * 60_000;
    expect(await svc.verifyCode(b.challenge, codeFromMail(), "src")).toEqual({ ok: false, reason: "expired" });
  });

  it("asking for a new code cancels the old one", async () => {
    await activeUser();
    const a = await svc.signIn("ama@church.org", PASSWORD, "src");
    if (!a.ok) throw new Error("expected ok");
    const oldCode = codeFromMail();
    await svc.signIn("ama@church.org", PASSWORD, "src");
    expect(await svc.verifyCode(a.challenge, oldCode, "src")).toEqual({ ok: false, reason: "expired" });
  });

  it("a session ends after 12 hours and when the person is disabled", async () => {
    const user = await activeUser();
    const a = await svc.signIn("ama@church.org", PASSWORD, "src");
    if (!a.ok) throw new Error("expected ok");
    const s = await svc.verifyCode(a.challenge, codeFromMail(), "src");
    if (!s.ok) throw new Error("expected ok");
    expect(await svc.getSession(s.sessionToken)).not.toBeNull();
    await store.updateUser(user.id, { status: "disabled" });
    expect(await svc.getSession(s.sessionToken)).toBeNull();
    await store.updateUser(user.id, { status: "active" });
    clock += 13 * 3_600_000;
    expect(await svc.getSession(s.sessionToken)).toBeNull();
  });

  it("junk input never signs anyone in", async () => {
    await activeUser();
    expect(await svc.signIn(undefined, undefined, "s")).toEqual({ ok: false, reason: "wrong" });
    expect(await svc.verifyCode("not-a-uuid", "123456", "s")).toMatchObject({ ok: false });
    expect(await svc.getSession("x")).toBeNull();
    expect(await svc.getSession(undefined)).toBeNull();
  });

  it("the audit log never holds the code, password or email", async () => {
    await activeUser();
    const a = await svc.signIn("ama@church.org", PASSWORD, "src");
    if (!a.ok) throw new Error("expected ok");
    const code = codeFromMail();
    await svc.verifyCode(a.challenge, code, "src");
    const dump = JSON.stringify(audit.entries);
    expect(dump).not.toContain(code);
    expect(dump).not.toContain(PASSWORD);
    expect(dump).not.toContain("ama@church.org");
  });

  it("a mail failure gives 'unavailable', not a session", async () => {
    await activeUser();
    mailer.send = async () => {
      throw new Error("down");
    };
    expect(await svc.signIn("ama@church.org", PASSWORD, "src")).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("setup", () => {
  it("refuses a short secret", () => {
    expect(() => createStaffService({ store, audit, mailer, pepper: "short" })).toThrow();
  });
});

describe("password reset", () => {
  it("emails a one-use link and signs the person out everywhere", async () => {
    await activeUser();
    const a = await svc.signIn("ama@church.org", PASSWORD, "src");
    if (!a.ok) throw new Error("expected ok");
    const s = await svc.verifyCode(a.challenge, codeFromMail(), "src");
    if (!s.ok) throw new Error("expected ok");

    await svc.requestReset("Ama@Church.org", "https://x.test", "src");
    expect(sent.at(-1)!.subject).toMatch(/Reset/);
    const link = /reset\?token=([\w-]+)/.exec(sent.at(-1)!.text)![1]!;
    expect(store.tokens.every((t) => !t.tokenHash.includes(link))).toBe(true);

    expect(await svc.resetPassword(link, "short")).toMatchObject({ ok: false, reason: "weak" });
    expect(await svc.resetPassword(link, "a brand new password")).toEqual({ ok: true });
    expect(await svc.resetPassword(link, "another password again")).toMatchObject({ ok: false, reason: "invalid" });

    expect(await svc.getSession(s.sessionToken)).toBeNull();
    expect(await svc.signIn("ama@church.org", PASSWORD, "src")).toEqual({ ok: false, reason: "wrong" });
    expect((await svc.signIn("ama@church.org", "a brand new password", "src")).ok).toBe(true);
  });

  it("looks the same for unknown, invited and active emails, and sends only to people who can sign in", async () => {
    await activeUser();
    await svc.invite({ churchId: "c1", churchName: "G", email: "new@church.org", fullName: "N", role: "viewer", baseUrl: "https://x.test" });
    const before = sent.length;
    await svc.requestReset("ghost@church.org", "https://x.test", "src");
    await svc.requestReset("new@church.org", "https://x.test", "src");
    await svc.requestReset("not-an-email", "https://x.test", "src");
    expect(sent.length).toBe(before);
    await svc.requestReset("ama@church.org", "https://x.test", "src");
    expect(sent.length).toBe(before + 1);
  });

  it("limits reset emails from one place, and links expire after an hour", async () => {
    await activeUser();
    const before = sent.length;
    for (let i = 0; i < 8; i++) await svc.requestReset("ama@church.org", "https://x.test", "same");
    expect(sent.length - before).toBe(5);
    const link = /reset\?token=([\w-]+)/.exec(sent.at(-1)!.text)![1]!;
    clock += 61 * 60_000;
    expect(await svc.resetPassword(link, "a brand new password")).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("tells the owner when a person is locked out", async () => {
    const alerts: string[] = [];
    svc = createStaffService({ store, audit, mailer, pepper: PEPPER, now: () => clock, alert: async (k) => void alerts.push(k) });
    await activeUser();
    for (let i = 0; i < 5; i++) await svc.signIn("ama@church.org", "wrong wrong wrong", `s${i}`);
    expect(alerts).toEqual(["staff_locked"]);
  });
});
