import { describe, expect, it } from "vitest";
import { handleAuthenticator } from "../src/lib/ownerAuthenticator";
import { createStaffService, type Mailer } from "../src/lib/staff";
import { decryptSecret, totpCode, totpStep } from "../src/lib/totp";
import { FakeAudit, FakeStaffStore } from "./helpers";

const PEPPER = "p".repeat(40);
const EMAIL = "isaac@maizz.test";
const PW = "correct horse battery";

async function setup() {
  const store = new FakeStaffStore();
  const audit = new FakeAudit();
  const sent: { to: string; subject: string; text: string }[] = [];
  const alerts: string[] = [];
  let t = Date.UTC(2026, 9, 14, 12, 0, 0);
  const mailer: Mailer = { send: async (m) => void sent.push(m) };
  const svc = createStaffService({ store, audit, mailer, pepper: PEPPER, area: "owner", now: () => t, alert: async (k) => void alerts.push(k) });
  await svc.invite({ churchId: "platform", churchName: "Maizz", email: EMAIL, fullName: "Isaac", role: "owner", baseUrl: "https://m.test" });
  await svc.acceptInvite(/token=([\w-]+)/.exec(sent[0]!.text)![1]!, PW);
  const user = store.users[0]!;
  const secretOf = () => decryptSecret(store.users[0]!.totp!.secretEnc!, PEPPER)!;
  const codeNow = (offset = 0) => totpCode(secretOf(), totpStep(t) + offset);
  const tick = (seconds: number) => void (t += seconds * 1000);
  /** Switches the app on and returns the recovery codes. */
  const enrol = async () => {
    await svc.beginAuthenticator(user.id);
    const r = await svc.finishAuthenticator(user.id, codeNow(), "src");
    if (!r.ok) throw new Error("enrol failed");
    tick(30); // the next code, as a person would wait
    return r.recoveryCodes;
  };
  return { store, audit, sent, alerts, svc, user, secretOf, codeNow, tick, enrol };
}

describe("setting up the authenticator app", () => {
  it("switches on only when the person proves they can read a code, then gives eight recovery codes once", async () => {
    const s = await setup();
    expect(await s.svc.authenticatorStatus(s.user.id)).toEqual({ enabled: false, pending: false, recoveryLeft: 0 });
    const begun = await s.svc.beginAuthenticator(s.user.id);
    expect(begun).toMatchObject({ ok: true });
    if (!begun.ok) return;
    expect(begun.uri).toContain(`secret=${begun.secret}`);
    expect(JSON.stringify(s.store.users[0]!.totp)).not.toContain(begun.secret); // stored encrypted
    expect(await s.svc.authenticatorStatus(s.user.id)).toMatchObject({ enabled: false, pending: true });

    expect(await s.svc.finishAuthenticator(s.user.id, "000000", "src")).toEqual({ ok: false, reason: "wrong" });
    expect((await s.svc.authenticatorStatus(s.user.id)).enabled).toBe(false);

    const done = await s.svc.finishAuthenticator(s.user.id, s.codeNow(), "src");
    expect(done.ok && done.recoveryCodes).toHaveLength(8);
    expect(await s.svc.authenticatorStatus(s.user.id)).toEqual({ enabled: true, pending: false, recoveryLeft: 8 });
    expect(s.audit.actions()).toContain("owner.authenticator_on");
    expect(JSON.stringify(s.audit.entries)).not.toContain(begun.secret);
  });

  it("will not start again once it is on, and the first code cannot be reused", async () => {
    const s = await setup();
    await s.svc.beginAuthenticator(s.user.id);
    const code = s.codeNow();
    expect((await s.svc.finishAuthenticator(s.user.id, code, "src")).ok).toBe(true);
    expect(await s.svc.beginAuthenticator(s.user.id)).toEqual({ ok: false, reason: "already" });
    expect(await s.svc.finishAuthenticator(s.user.id, code, "src")).toMatchObject({ ok: false });
  });
});

describe("signing in with the app on", () => {
  it("sends no email, and an emailed-style code or the wrong code never works", async () => {
    const s = await setup();
    await s.enrol();
    const mails = s.sent.length;
    const r = await s.svc.signIn(EMAIL, PW, "src");
    expect(r).toMatchObject({ ok: true, method: "app" });
    expect(s.sent).toHaveLength(mails); // nothing was emailed
    if (!r.ok) return;
    expect(await s.svc.verifyCode(r.challenge, "123456", "src")).toEqual({ ok: false, reason: "wrong" });
    const good = await s.svc.verifyCode(r.challenge, s.codeNow(), "src");
    expect(good.ok).toBe(true);
  });

  it("works once: the same code cannot start a second sign-in, the next one can", async () => {
    const s = await setup();
    await s.enrol();
    const first = await s.svc.signIn(EMAIL, PW, "src");
    const code = s.codeNow();
    expect((await s.svc.verifyCode((first as { challenge: string }).challenge, code, "src")).ok).toBe(true);
    const second = await s.svc.signIn(EMAIL, PW, "src");
    expect(await s.svc.verifyCode((second as { challenge: string }).challenge, code, "src")).toEqual({ ok: false, reason: "wrong" });
    s.tick(30);
    expect((await s.svc.verifyCode((second as { challenge: string }).challenge, s.codeNow(), "src")).ok).toBe(true);
  });

  it("has no way in through the inbox: a password reset by email still needs the app", async () => {
    const s = await setup();
    await s.enrol();
    await s.svc.requestReset(EMAIL, "https://m.test", "src");
    const token = /token=([\w-]+)/.exec(s.sent.at(-1)!.text)![1]!;
    expect(await s.svc.resetPassword(token, "a brand new password!")).toEqual({ ok: true });
    const r = await s.svc.signIn(EMAIL, "a brand new password!", "src2");
    expect(r).toMatchObject({ ok: true, method: "app" });
    const mails = s.sent.length;
    expect(s.sent).toHaveLength(mails);
    if (r.ok) expect(await s.svc.verifyCode(r.challenge, "654321", "src2")).toMatchObject({ ok: false });
  });

  it("accepts a recovery code once, tells the owner, and refuses it the second time", async () => {
    const s = await setup();
    const codes = await s.enrol();
    const a = await s.svc.signIn(EMAIL, PW, "src");
    const typed = codes[0]!.toLowerCase().replace("-", " ");
    expect((await s.svc.verifyCode((a as { challenge: string }).challenge, typed, "src")).ok).toBe(true);
    expect(s.alerts).toContain("owner_recovery_code");
    expect(s.audit.actions()).toContain("staff.recovery_code_used");
    expect((await s.svc.authenticatorStatus(s.user.id)).recoveryLeft).toBe(7);
    const b = await s.svc.signIn(EMAIL, PW, "src");
    expect(await s.svc.verifyCode((b as { challenge: string }).challenge, codes[0]!, "src")).toEqual({ ok: false, reason: "wrong" });
  });

  it("counts wrong app codes toward the guessing alert like wrong passwords, and never locks", async () => {
    const s = await setup();
    await s.enrol();
    for (let i = 0; i < 4; i += 1) {
      const r = await s.svc.signIn(EMAIL, PW, `s${i}`);
      for (let j = 0; j < 5; j += 1) await s.svc.verifyCode((r as { challenge: string }).challenge, "111111", `s${i}`);
    }
    expect(s.alerts).toContain("owner_guessing");
    expect((await s.svc.signIn(EMAIL, PW, "home")).ok).toBe(true);
  });

  it("leaves people without the app on the emailed code", async () => {
    const s = await setup();
    const mails = s.sent.length;
    const r = await s.svc.signIn(EMAIL, PW, "src");
    expect(r).toMatchObject({ ok: true, method: "email" });
    expect(s.sent).toHaveLength(mails + 1);
  });
});

describe("changing a payout account with the app on", () => {
  const session = async (s: Awaited<ReturnType<typeof setup>>) => {
    const r = await s.svc.signIn(EMAIL, PW, "src");
    const v = await s.svc.verifyCode((r as { challenge: string }).challenge, s.codeNow(), "src");
    s.tick(30);
    return (v as { sessionToken: string }).sessionToken;
  };

  it("asks for the app, emails nothing, accepts a current code once and never a recovery code", async () => {
    const s = await setup();
    const codes = await s.enrol();
    const token = await session(s);
    const mails = s.sent.length;
    const start = await s.svc.startStepUp(token, "src");
    expect(start).toMatchObject({ ok: true, method: "app" });
    expect(s.sent).toHaveLength(mails);
    const challenge = (start as { challenge: string }).challenge;

    expect(await s.svc.verifyStepUp(token, challenge, codes[1]!, "src")).toEqual({ ok: false, reason: "wrong" });
    expect(await s.svc.verifyStepUp(token, challenge, "000000", "src")).toEqual({ ok: false, reason: "wrong" });
    expect(await s.svc.verifyStepUp(token, challenge, s.codeNow(), "src")).toEqual({ ok: true });
    // The challenge is used up by the right code in the same request that makes the change.
    expect(await s.svc.verifyStepUp(token, challenge, s.codeNow(), "src")).toMatchObject({ ok: false });
  });

  it("refuses the code that was just used to sign in", async () => {
    const s = await setup();
    await s.enrol();
    const r = await s.svc.signIn(EMAIL, PW, "src");
    const code = s.codeNow();
    const v = await s.svc.verifyCode((r as { challenge: string }).challenge, code, "src");
    const start = await s.svc.startStepUp((v as { sessionToken: string }).sessionToken, "src");
    expect(await s.svc.verifyStepUp((v as { sessionToken: string }).sessionToken, (start as { challenge: string }).challenge, code, "src")).toEqual({ ok: false, reason: "wrong" });
  });
});

describe("new recovery codes", () => {
  it("need a current app code (not a recovery code), and make the old ones stop working", async () => {
    const s = await setup();
    const old = await s.enrol();
    expect(await s.svc.renewRecoveryCodes(s.user.id, old[0]!, "src")).toEqual({ ok: false, reason: "wrong" });
    const fresh = await s.svc.renewRecoveryCodes(s.user.id, s.codeNow(), "src");
    expect(fresh.ok && fresh.recoveryCodes).toHaveLength(8);
    const r = await s.svc.signIn(EMAIL, PW, "src");
    expect(await s.svc.verifyCode((r as { challenge: string }).challenge, old[2]!, "src")).toEqual({ ok: false, reason: "wrong" });
    expect(s.audit.actions()).toContain("owner.recovery_codes_renewed");
  });
});

describe("owner authenticator handler", () => {
  it("maps results to plain answers", async () => {
    const s = await setup();
    const call = (action: unknown, code?: unknown) =>
      handleAuthenticator({ service: s.svc, user: s.user, action, code, sourceKey: "src", qr: async (u) => `<svg>${u.length}</svg>` });
    expect((await call("status")).body).toMatchObject({ enabled: false });
    const begun = await call("begin");
    expect(begun.status).toBe(200);
    expect(begun.body.qr).toMatch(/^<svg>/);
    expect((await call("confirm", "000000")).status).toBe(403);
    const ok = await call("confirm", s.codeNow());
    expect(ok.status).toBe(200);
    expect(ok.body.recoveryCodes).toHaveLength(8);
    expect((await call("begin")).status).toBe(400);
    expect((await call("nonsense")).status).toBe(400);
    expect((await call("renew", "000000")).status).toBe(403);
  });
});
