import { createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import type { AuditLog } from "./audit";

// Church sign-in: email and password, then a six-digit code sent to the same email.
// Passwords are kept only as salted scrypt hashes. Codes, invite links and sessions only as one-way hashes.

export const ROLES = ["owner", "finance", "viewer"] as const;
export type Role = (typeof ROLES)[number];
export type UserStatus = "invited" | "active" | "disabled";
export type TokenKind = "invite" | "code" | "session";

export const STAFF_LIMITS = {
  codeMinutes: 10,
  codeTries: 5,
  sessionHours: 12,
  inviteHours: 48,
  /** Wrong passwords or codes for one person before they are locked out. */
  userFailures: 5,
  lockMinutes: 15,
  /** Wrong passwords or codes from one source address in the window. */
  sourceFailures: 10,
  windowMinutes: 15,
  minPassword: 12,
  maxPassword: 200,
} as const;

export interface StaffUser {
  id: string;
  churchId: string;
  email: string;
  fullName: string;
  role: Role;
  status: UserStatus;
  passwordHash: string | null;
  failedAttempts: number;
  /** ms since 1970, or null */
  lockedUntil: number | null;
}

export interface StaffToken {
  id: string;
  userId: string;
  kind: TokenKind;
  tokenHash: string;
  attempts: number;
  expiresAt: number;
  usedAt: number | null;
}

export interface StaffStore {
  findUserByEmail(email: string): Promise<StaffUser | null>;
  getUser(id: string): Promise<StaffUser | null>;
  listUsers(churchId: string): Promise<StaffUser[]>;
  /** Throws StaffError("exists") if the email is already used. */
  createUser(u: { churchId: string; email: string; fullName: string; role: Role }): Promise<StaffUser>;
  updateUser(
    id: string,
    patch: Partial<{ passwordHash: string; status: UserStatus; failedAttempts: number; lockedUntil: number | null }>,
  ): Promise<void>;
  createToken(t: { userId: string; kind: TokenKind; tokenHash: string; expiresAt: number }): Promise<string>;
  findTokenByHash(kind: TokenKind, tokenHash: string): Promise<StaffToken | null>;
  getToken(id: string): Promise<StaffToken | null>;
  /** True only for the one caller that marks an unused token used. */
  consumeToken(id: string): Promise<boolean>;
  setTokenAttempts(id: string, attempts: number): Promise<void>;
  /** Marks every unused token of this kind for this person as used. */
  revokeTokens(userId: string, kind: TokenKind): Promise<void>;
}

export interface Mailer {
  send(mail: { to: string; subject: string; text: string }): Promise<void>;
}

export class StaffError extends Error {
  constructor(
    readonly code: "exists" | "bad_input" | "unavailable",
    message: string,
  ) {
    super(message);
  }
}

export function normaliseEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const e = raw.trim().toLowerCase();
  return e.length <= 200 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null;
}

export function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== "string" || pw.length < STAFF_LIMITS.minPassword) {
    return `Use at least ${STAFF_LIMITS.minPassword} characters. A few random words works well.`;
  }
  if (pw.length > STAFF_LIMITS.maxPassword) return "That password is too long.";
  if (/^(.)\1+$/.test(pw)) return "Choose a password that is not one repeated character.";
  return null;
}

function scryptAsync(pw: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(pw, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(pw, salt);
  return `scrypt$16384$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(pw: string, stored: string | null): Promise<boolean> {
  // Always do the same work, so a missing person or a missing password takes as long as a wrong one.
  const parts = (stored ?? "").split("$");
  const known = parts.length === 4 && parts[0] === "scrypt" && parts[1] === "16384";
  const salt = known ? Buffer.from(parts[2]!, "base64url") : Buffer.alloc(16);
  const want = known ? Buffer.from(parts[3]!, "base64url") : Buffer.alloc(32);
  const got = await scryptAsync(pw, salt);
  return known && want.length === got.length && timingSafeEqual(want, got);
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashToken(value: string, pepper: string): string {
  return createHmac("sha256", pepper).update(value).digest("hex");
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export type SignInResult =
  | { ok: true; challenge: string }
  | { ok: false; reason: "wrong" | "locked" | "unavailable" };

export type CodeResult =
  | { ok: true; sessionToken: string; expiresAt: number }
  | { ok: false; reason: "wrong" | "expired" | "locked" | "unavailable" };

export interface SessionInfo {
  user: StaffUser;
}

export function createStaffService(deps: {
  store: StaffStore;
  audit: AuditLog;
  mailer: Mailer;
  /** Secret mixed into stored hashes. At least 32 characters. */
  pepper: string;
  now?: () => number;
}) {
  const { store, audit, mailer } = deps;
  const now = deps.now ?? (() => Date.now());
  const minute = 60_000;
  if (deps.pepper.length < 32) throw new StaffError("unavailable", "STAFF_SECRET must be at least 32 characters.");
  const h = (v: string) => hashToken(v, deps.pepper);

  async function record(
    action: string,
    outcome: "ok" | "denied" | "failed",
    sourceKey: string | undefined,
    userId?: string,
  ): Promise<void> {
    await audit.record({ actor: userId ? `staff:${userId}` : "unknown", action, outcome, sourceKey, target: userId });
  }

  async function sourceLocked(sourceKey: string): Promise<boolean> {
    const [a, b] = await Promise.all([
      audit.countSince("staff.signin_failed", STAFF_LIMITS.windowMinutes, sourceKey),
      audit.countSince("staff.code_failed", STAFF_LIMITS.windowMinutes, sourceKey),
    ]);
    return a + b >= STAFF_LIMITS.sourceFailures;
  }

  async function fail(user: StaffUser | null, action: string, sourceKey: string): Promise<void> {
    await record(action, "denied", sourceKey, user?.id);
    if (!user) return;
    const failures = user.failedAttempts + 1;
    await store.updateUser(user.id, {
      failedAttempts: failures,
      lockedUntil: failures >= STAFF_LIMITS.userFailures ? now() + STAFF_LIMITS.lockMinutes * minute : user.lockedUntil,
    });
    if (failures === STAFF_LIMITS.userFailures) await record("staff.locked", "denied", sourceKey, user.id);
  }

  return {
    /** Owner tool: adds a person and emails them a link to choose a password. */
    async invite(args: { churchId: string; churchName: string; email: string; fullName: string; role: Role; baseUrl: string }) {
      const email = normaliseEmail(args.email);
      const fullName = args.fullName.trim();
      if (!email || fullName.length < 1 || fullName.length > 120 || !ROLES.includes(args.role)) {
        throw new StaffError("bad_input", "Check the name, email and role.");
      }
      const user = await store.createUser({ churchId: args.churchId, email, fullName, role: args.role });
      await sendInvite(user, args.churchName, args.baseUrl);
      return user;
    },

    /** Sends a fresh invite link, replacing any older one. Only for people who have not set a password. */
    async resendInvite(args: { userId: string; churchName: string; baseUrl: string }) {
      const user = await store.getUser(args.userId);
      if (!user || user.status !== "invited") throw new StaffError("bad_input", "That person has already set a password.");
      await store.revokeTokens(user.id, "invite");
      await sendInvite(user, args.churchName, args.baseUrl);
    },

    async acceptInvite(token: string, password: string): Promise<{ ok: true } | { ok: false; reason: "invalid" | "weak"; message: string }> {
      const problem = passwordProblem(password);
      if (problem) return { ok: false, reason: "weak", message: problem };
      const found = await store.findTokenByHash("invite", h(token));
      const user = found && found.usedAt === null && found.expiresAt > now() ? await store.getUser(found.userId) : null;
      if (!found || !user || user.status !== "invited") {
        return { ok: false, reason: "invalid", message: "This link has expired or was already used. Ask your church owner to send a new one." };
      }
      if (!(await store.consumeToken(found.id))) {
        return { ok: false, reason: "invalid", message: "This link has expired or was already used. Ask your church owner to send a new one." };
      }
      await store.updateUser(user.id, { passwordHash: await hashPassword(password), status: "active", failedAttempts: 0, lockedUntil: null });
      await record("staff.invite_accepted", "ok", undefined, user.id);
      return { ok: true };
    },

    /** Step one: email and password. If they are right, a code goes to the email. */
    async signIn(emailRaw: unknown, password: unknown, sourceKey: string): Promise<SignInResult> {
      try {
        if (await sourceLocked(sourceKey)) return { ok: false, reason: "locked" };
        const email = normaliseEmail(emailRaw);
        const pw = typeof password === "string" && password.length <= STAFF_LIMITS.maxPassword ? password : "";
        const user = email ? await store.findUserByEmail(email) : null;
        const usable = user && user.status === "active" ? user : null;
        const passwordOk = await verifyPassword(pw, usable?.passwordHash ?? null);

        if (usable?.lockedUntil && usable.lockedUntil > now()) {
          await record("staff.signin_failed", "denied", sourceKey, usable.id);
          return { ok: false, reason: "locked" };
        }
        if (!usable || !passwordOk) {
          await fail(usable, "staff.signin_failed", sourceKey);
          return { ok: false, reason: "wrong" };
        }
        await store.revokeTokens(usable.id, "code");
        const code = newCode();
        const challenge = await store.createToken({
          userId: usable.id,
          kind: "code",
          tokenHash: h(`${usable.id}:${code}`),
          expiresAt: now() + STAFF_LIMITS.codeMinutes * minute,
        });
        await mailer.send({
          to: usable.email,
          subject: `Your Maizz sign-in code is ${code}`,
          text: `Your Maizz sign-in code is ${code}.\n\nIt works for ${STAFF_LIMITS.codeMinutes} minutes. If you did not try to sign in, ignore this email and tell your church owner.\n\nMaizz will never ask you for this code by phone or message.`,
        });
        await record("staff.code_sent", "ok", sourceKey, usable.id);
        return { ok: true, challenge };
      } catch {
        return { ok: false, reason: "unavailable" };
      }
    },

    /** Step two: the emailed code. If it is right, a session starts. */
    async verifyCode(challenge: unknown, codeRaw: unknown, sourceKey: string): Promise<CodeResult> {
      try {
        if (await sourceLocked(sourceKey)) return { ok: false, reason: "locked" };
        const code = typeof codeRaw === "string" ? codeRaw.replace(/\s/g, "") : "";
        const token = typeof challenge === "string" && /^[0-9a-f-]{36}$/.test(challenge) ? await store.getToken(challenge) : null;
        if (!token || token.kind !== "code" || token.usedAt !== null || token.expiresAt <= now()) {
          await record("staff.code_failed", "denied", sourceKey, token?.userId);
          return { ok: false, reason: "expired" };
        }
        const user = await store.getUser(token.userId);
        if (!user || user.status !== "active") return { ok: false, reason: "expired" };
        if (user.lockedUntil && user.lockedUntil > now()) return { ok: false, reason: "locked" };
        if (token.attempts >= STAFF_LIMITS.codeTries) {
          await store.consumeToken(token.id);
          return { ok: false, reason: "expired" };
        }
        if (!/^\d{6}$/.test(code) || !same(token.tokenHash, h(`${user.id}:${code}`))) {
          await store.setTokenAttempts(token.id, token.attempts + 1);
          await fail(user, "staff.code_failed", sourceKey);
          return { ok: false, reason: "wrong" };
        }
        if (!(await store.consumeToken(token.id))) return { ok: false, reason: "expired" };
        const sessionToken = newToken();
        const expiresAt = now() + STAFF_LIMITS.sessionHours * 60 * minute;
        await store.createToken({ userId: user.id, kind: "session", tokenHash: h(sessionToken), expiresAt });
        await store.updateUser(user.id, { failedAttempts: 0, lockedUntil: null });
        await record("staff.signin", "ok", sourceKey, user.id);
        return { ok: true, sessionToken, expiresAt };
      } catch {
        return { ok: false, reason: "unavailable" };
      }
    },

    async getSession(sessionToken: string | undefined): Promise<SessionInfo | null> {
      if (!sessionToken || sessionToken.length < 20 || sessionToken.length > 100) return null;
      const t = await store.findTokenByHash("session", h(sessionToken));
      if (!t || t.usedAt !== null || t.expiresAt <= now()) return null;
      const user = await store.getUser(t.userId);
      return user && user.status === "active" ? { user } : null;
    },

    async signOut(sessionToken: string | undefined): Promise<void> {
      if (!sessionToken) return;
      const t = await store.findTokenByHash("session", h(sessionToken));
      if (t && t.usedAt === null) {
        await store.consumeToken(t.id);
        await record("staff.signout", "ok", undefined, t.userId);
      }
    },
  };

  async function sendInvite(user: StaffUser, churchName: string, baseUrl: string): Promise<void> {
    const token = newToken();
    await store.createToken({
      userId: user.id,
      kind: "invite",
      tokenHash: h(token),
      expiresAt: now() + STAFF_LIMITS.inviteHours * 60 * minute,
    });
    const link = `${baseUrl.replace(/\/+$/, "")}/church/invite?token=${token}`;
    await mailer.send({
      to: user.email,
      subject: `You are invited to ${churchName} on Maizz`,
      text: `Hello ${user.fullName},\n\nYou have been added to ${churchName} on Maizz as ${user.role}.\n\nChoose your password here (the link works once, for ${STAFF_LIMITS.inviteHours} hours):\n${link}\n\nIf you were not expecting this, ignore this email.`,
    });
    await record("staff.invite_sent", "ok", undefined, user.id);
  }
}

export type StaffService = ReturnType<typeof createStaffService>;
