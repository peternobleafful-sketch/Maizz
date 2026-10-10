import type { Role, StaffStore, StaffToken, StaffUser, TokenKind, UserStatus } from "./staff";
import { StaffError } from "./staff";

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const ms = (v: unknown): number | null => (typeof v === "string" ? Date.parse(v) : null);

const USER_COLUMNS = "id,church_id,email,full_name,role,status,password_hash,failed_attempts,locked_until";
const TOKEN_COLUMNS = "id,user_id,kind,token_hash,attempts,expires_at,used_at";

function toUser(row: unknown): StaffUser {
  if (!isRec(row) || typeof row.id !== "string" || typeof row.church_id !== "string" || typeof row.email !== "string") {
    throw new StaffError("unavailable", "Unexpected person row from the database");
  }
  return {
    id: row.id,
    churchId: row.church_id,
    email: row.email,
    fullName: typeof row.full_name === "string" ? row.full_name : "",
    role: row.role as Role,
    status: row.status as UserStatus,
    passwordHash: typeof row.password_hash === "string" ? row.password_hash : null,
    failedAttempts: typeof row.failed_attempts === "number" ? row.failed_attempts : 0,
    lockedUntil: ms(row.locked_until),
  };
}

function toToken(row: unknown): StaffToken {
  if (!isRec(row) || typeof row.id !== "string" || typeof row.user_id !== "string") {
    throw new StaffError("unavailable", "Unexpected token row from the database");
  }
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind as TokenKind,
    tokenHash: String(row.token_hash),
    attempts: typeof row.attempts === "number" ? row.attempts : 0,
    expiresAt: ms(row.expires_at) ?? 0,
    usedAt: ms(row.used_at),
  };
}

export function createSupabaseStaffStore(opts: { url: string; serviceKey: string; fetchFn?: typeof fetch }): StaffStore {
  const base = `${opts.url.replace(/\/+$/, "")}/rest/v1`;
  const fetchFn = opts.fetchFn ?? fetch;
  const headers: Record<string, string> = { apikey: opts.serviceKey, "Content-Type": "application/json" };
  if (opts.serviceKey.startsWith("eyJ")) headers.Authorization = `Bearer ${opts.serviceKey}`;

  async function request(method: "GET" | "POST" | "PATCH", path: string, body?: unknown, prefer?: string): Promise<Response> {
    try {
      return await fetchFn(`${base}/${path}`, {
        method,
        headers: prefer ? { ...headers, Prefer: prefer } : headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new StaffError("unavailable", "Could not reach the database");
    }
  }

  async function rows(res: Response, what: string): Promise<unknown[]> {
    if (!res.ok) throw new StaffError("unavailable", `Database refused ${what} (${res.status})`);
    const j: unknown = await res.json();
    if (!Array.isArray(j)) throw new StaffError("unavailable", `Unexpected reply for ${what}`);
    return j;
  }

  const q = encodeURIComponent;
  const iso = (t: number) => new Date(t).toISOString();

  return {
    async findUserByEmail(email) {
      const r = (await rows(await request("GET", `church_users?email=eq.${q(email)}&select=${USER_COLUMNS}&limit=1`), "person lookup"))[0];
      return r === undefined ? null : toUser(r);
    },
    async getUser(id) {
      const r = (await rows(await request("GET", `church_users?id=eq.${q(id)}&select=${USER_COLUMNS}&limit=1`), "person lookup"))[0];
      return r === undefined ? null : toUser(r);
    },
    async listUsers(churchId) {
      const res = await request("GET", `church_users?church_id=eq.${q(churchId)}&select=${USER_COLUMNS}&order=created_at.asc&limit=200`);
      return (await rows(res, "team list")).map(toUser);
    },
    async createUser(u) {
      const res = await request(
        "POST",
        "church_users",
        { church_id: u.churchId, email: u.email, full_name: u.fullName, role: u.role },
        "return=representation",
      );
      if (res.status === 409) throw new StaffError("exists", "Someone with that email already has an account.");
      return toUser((await rows(res, "person creation"))[0]);
    },
    async updateUser(id, patch) {
      const body: Rec = {};
      if (patch.passwordHash !== undefined) body.password_hash = patch.passwordHash;
      if (patch.status !== undefined) body.status = patch.status;
      if (patch.failedAttempts !== undefined) body.failed_attempts = patch.failedAttempts;
      if (patch.lockedUntil !== undefined) body.locked_until = patch.lockedUntil === null ? null : iso(patch.lockedUntil);
      const res = await request("PATCH", `church_users?id=eq.${q(id)}`, body, "return=representation");
      if ((await rows(res, "person update")).length !== 1) throw new StaffError("unavailable", "That person was not found");
    },
    async createToken(t) {
      const res = await request(
        "POST",
        "staff_tokens",
        { user_id: t.userId, kind: t.kind, token_hash: t.tokenHash, expires_at: iso(t.expiresAt) },
        "return=representation",
      );
      const created = (await rows(res, "token creation"))[0];
      if (!isRec(created) || typeof created.id !== "string") throw new StaffError("unavailable", "Token was not created");
      return created.id;
    },
    async findTokenByHash(kind, tokenHash) {
      const res = await request("GET", `staff_tokens?kind=eq.${kind}&token_hash=eq.${q(tokenHash)}&select=${TOKEN_COLUMNS}&limit=1`);
      const r = (await rows(res, "token lookup"))[0];
      return r === undefined ? null : toToken(r);
    },
    async getToken(id) {
      const r = (await rows(await request("GET", `staff_tokens?id=eq.${q(id)}&select=${TOKEN_COLUMNS}&limit=1`), "token lookup"))[0];
      return r === undefined ? null : toToken(r);
    },
    async consumeToken(id) {
      const res = await request(
        "PATCH",
        `staff_tokens?id=eq.${q(id)}&used_at=is.null`,
        { used_at: new Date().toISOString() },
        "return=representation",
      );
      return (await rows(res, "token use")).length === 1;
    },
    async setTokenAttempts(id, attempts) {
      await rows(await request("PATCH", `staff_tokens?id=eq.${q(id)}`, { attempts }, "return=representation"), "token update");
    },
    async revokeTokens(userId, kind) {
      await rows(
        await request(
          "PATCH",
          `staff_tokens?user_id=eq.${q(userId)}&kind=eq.${kind}&used_at=is.null`,
          { used_at: new Date().toISOString() },
          "return=representation",
        ),
        "token revoke",
      );
    },
  };
}
