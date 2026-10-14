import { describe, expect, it } from "vitest";
import { createStaffService, type Mailer } from "../src/lib/staff";
import { decryptSecret, totpCode, totpStep } from "../src/lib/totp";
import { ownerNeedsApp } from "../src/lib/ownerRules";
import { FakeAudit, FakeStaffStore } from "./helpers";

const OLD_PEPPER = "p".repeat(40);
const NEW_PEPPER = "n".repeat(40);
const TOTP_KEY = "t".repeat(40);
const EMAIL = "isaac@maizz.test";
const PW = "correct horse battery";

async function world(opts: { pepper?: string; totpKey?: string; live?: boolean; store?: FakeStaffStore; time?: number } = {}) {
  const store = opts.store ?? new FakeStaffStore();
  const audit = new FakeAudit();
  const sent: { to: string; subject: string; text: string }[] = [];
  let t = opts.time ?? Date.UTC(2026, 9, 14, 12, 0, 0);
  const mailer: Mailer = { send: async (m) => void sent.push(m) };
  const svc = createStaffService({
    store, audit, mailer, area: "owner", now: () => t,
    pepper: opts.pepper ?? OLD_PEPPER, totpKey: opts.totpKey, appRequired: () => opts.live === true,
  });
  if (!opts.store) {
    await svc.invite({ churchId: "platform", churchName: "Maizz", email: EMAIL, fullName: "Isaac", role: "owner", baseUrl: "https://m.test" });
    await svc.acceptInvite(/token=([\w-]+)/.exec(sent[0]!.text)![1]!, PW);
  }
  const user = store.users[0]!;
  return { store, svc, user, tick: (s: number) => void (t += s * 1000), now: () => t };
}

const seal = (stored: string, key: string) => decryptSecret(stored.replace(/^k2:/, ""), key);

describe("TOTP_KEY: the authenticator secret has its own key (review 3, finding 6)", () => {
  it("with TOTP_KEY the secret and recovery codes do not depend on STAFF_SECRET, so changing STAFF_SECRET keeps the owner in", async () => {
    const a = await world({ totpKey: TOTP_KEY });
    await a.svc.beginAuthenticator(a.user.id);
    expect(a.user.totp!.secretEnc!.startsWith("k2:")).toBe(true);
    const secret = seal(a.user.totp!.secretEnc!, TOTP_KEY)!;
    expect(secret).toBeTruthy();
    const done = await a.svc.finishAuthenticator(a.user.id, totpCode(secret, totpStep(a.now())), "src");
    if (!done.ok) throw new Error("enrol failed");
    a.tick(30);

    // STAFF_SECRET is changed. Same TOTP_KEY, same database.
    const b = await world({ store: a.store, pepper: NEW_PEPPER, totpKey: TOTP_KEY, time: a.now() });
    // Sign-in sessions and the old challenge are gone with the old secret, but the password is a scrypt hash, so sign-in works again.
    const first = await b.svc.signIn(EMAIL, PW, "src");
    expect(first).toMatchObject({ ok: true, method: "app" });
    if (!first.ok) return;
    const ok = await b.svc.verifyCode(first.challenge, totpCode(secret, totpStep(b.now())), "src");
    expect(ok.ok).toBe(true);
    // A recovery code made before the change also still works.
    b.tick(30);
    const second = await b.svc.signIn(EMAIL, PW, "src2");
    if (!second.ok) throw new Error("expected ok");
    const viaRecovery = await b.svc.verifyCode(second.challenge, done.recoveryCodes[0]!, "src2");
    expect(viaRecovery.ok).toBe(true);
  });

  it("without TOTP_KEY, changing STAFF_SECRET really does lock the app out (the reason to set it)", async () => {
    const a = await world();
    await a.svc.beginAuthenticator(a.user.id);
    const secret = decryptSecret(a.user.totp!.secretEnc!, OLD_PEPPER)!;
    await a.svc.finishAuthenticator(a.user.id, totpCode(secret, totpStep(a.now())), "src");
    a.tick(30);
    const b = await world({ store: a.store, pepper: NEW_PEPPER, time: a.now() });
    const first = await b.svc.signIn(EMAIL, PW, "src");
    if (!first.ok) throw new Error("expected ok");
    expect((await b.svc.verifyCode(first.challenge, totpCode(secret, totpStep(b.now())), "src")).ok).toBe(false);
  });

  it("moves an older secret under TOTP_KEY the first time it is used after TOTP_KEY is set", async () => {
    const a = await world();
    await a.svc.beginAuthenticator(a.user.id);
    const secret = decryptSecret(a.user.totp!.secretEnc!, OLD_PEPPER)!;
    const done = await a.svc.finishAuthenticator(a.user.id, totpCode(secret, totpStep(a.now())), "src");
    if (!done.ok) throw new Error("enrol failed");
    a.tick(30);
    const b = await world({ store: a.store, totpKey: TOTP_KEY, time: a.now() });
    const first = await b.svc.signIn(EMAIL, PW, "src");
    if (!first.ok) throw new Error("expected ok");
    expect((await b.svc.verifyCode(first.challenge, totpCode(secret, totpStep(b.now())), "src")).ok).toBe(true);
    expect(b.user.totp!.secretEnc!.startsWith("k2:")).toBe(true);
    expect(seal(b.user.totp!.secretEnc!, TOTP_KEY)).toBe(secret);
  });

  it("if TOTP_KEY is removed later, a secret kept under it is not readable, so the app code fails closed", async () => {
    const a = await world({ totpKey: TOTP_KEY });
    await a.svc.beginAuthenticator(a.user.id);
    const secret = seal(a.user.totp!.secretEnc!, TOTP_KEY)!;
    await a.svc.finishAuthenticator(a.user.id, totpCode(secret, totpStep(a.now())), "src");
    a.tick(30);
    const b = await world({ store: a.store, time: a.now() });
    const first = await b.svc.signIn(EMAIL, PW, "src");
    if (!first.ok) throw new Error("expected ok");
    expect((await b.svc.verifyCode(first.challenge, totpCode(secret, totpStep(b.now())), "src")).ok).toBe(false);
  });

  it("refuses a TOTP_KEY that is too short", async () => {
    await expect(world({ totpKey: "short" })).rejects.toThrow(/TOTP_KEY/);
  });
});

describe("live key: the owner needs the authenticator app (review 3, finding 5)", () => {
  /** Signs in the owner with the emailed code (no app yet) and returns the session token. */
  async function signedIn(w: Awaited<ReturnType<typeof world>>, sent: { text: string }[]) {
    const first = await w.svc.signIn(EMAIL, PW, "k");
    if (!first.ok) throw new Error("expected sign-in to start");
    const code = /is (\d{6})/.exec(sent.at(-1)!.text)![1]!;
    const done = await w.svc.verifyCode(first.challenge, code, "k");
    if (!done.ok) throw new Error("expected sign-in to finish");
    return done.sessionToken;
  }

  async function ownerWorld(live: boolean) {
    const store = new FakeStaffStore();
    const sent: { to: string; subject: string; text: string }[] = [];
    const mailer: Mailer = { send: async (m) => void sent.push(m) };
    const svc = createStaffService({ store, audit: new FakeAudit(), mailer, area: "owner", pepper: OLD_PEPPER, appRequired: () => live });
    await svc.invite({ churchId: "platform", churchName: "Maizz", email: EMAIL, fullName: "Isaac", role: "owner", baseUrl: "https://m.test" });
    await svc.acceptInvite(/token=([\w-]+)/.exec(sent[0]!.text)![1]!, PW);
    return { store, svc, sent, user: store.users[0]!, now: () => Date.now(), tick: () => undefined };
  }

  it("test mode: an owner without the app gets a normal session", async () => {
    const w = await ownerWorld(false);
    const token = await signedIn(w as never, w.sent);
    expect((await w.svc.getSession(token))?.user.email).toBe(EMAIL);
  });

  it("live key: an owner without the app gets no normal session, only the set-up session", async () => {
    const w = await ownerWorld(true);
    const token = await signedIn(w as never, w.sent);
    expect(await w.svc.getSession(token)).toBeNull();
    expect((await w.svc.getSession(token, { setup: true }))?.user.email).toBe(EMAIL);
    // Starting a payout confirmation (step-up) is also shut.
    expect(await w.svc.startStepUp(token, "src")).toEqual({ ok: false, reason: "signed_out" });
  });

  it("live key: once the app is on, the same owner gets a normal session", async () => {
    const w = await ownerWorld(true);
    await w.svc.beginAuthenticator(w.user.id);
    const secret = decryptSecret(w.user.totp!.secretEnc!, OLD_PEPPER)!;
    const done = await w.svc.finishAuthenticator(w.user.id, totpCode(secret, totpStep(Date.now())), "src");
    expect(done.ok).toBe(true);
    const first = await w.svc.signIn(EMAIL, PW, "again");
    if (!first.ok) throw new Error("expected ok");
    // The next 30-second code (the first was used up while switching the app on).
    const next = await w.svc.verifyCode(first.challenge, totpCode(secret, totpStep(Date.now()) + 1), "again");
    expect(next.ok).toBe(true);
    if (next.ok) expect((await w.svc.getSession(next.sessionToken))?.user.email).toBe(EMAIL);
  });

  it("ownerNeedsApp is true only for a live key without the app", () => {
    const off = { totp: undefined };
    const on = { totp: { secretEnc: "x", enabled: true, lastStep: 1 } };
    expect(ownerNeedsApp({ PAYSTACK_SECRET_KEY: "sk_live_abc123" }, off)).toBe(true);
    expect(ownerNeedsApp({ PAYSTACK_SECRET_KEY: "sk_live_abc123" }, on)).toBe(false);
    expect(ownerNeedsApp({ PAYSTACK_SECRET_KEY: "sk_test_abc123" }, off)).toBe(false);
    expect(ownerNeedsApp({}, off)).toBe(false);
  });
});
