import type { Role, StaffStore, StaffToken, StaffUser, TokenKind, UserStatus } from "./staff";
import { StaffError } from "./staff";

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const ms = (v: unknown): number | null => (typeof v === "string" ? Date.parse(v) : null);

const USER_COLUMNS = "id,church_id,email,full_name,role,status,password_hash,failed_attempts,locked_until";
// The Maizz owner's people have no church and no role, only the owner role.
const OWNER_COLUMNS = "id,email,full_name,status,password_hash,failed_attempts,locked_until,totp_secret,totp_enabled_at,totp_last_step";
export const PLATFORM = "platform";
const TOKEN_COLUMNS = "id,user_id,kind,token_hash,attempts,expires_at,used_at";

function toUser(row: unknown, owner = false): StaffUser {
  if (!isRec(row) || typeof row.id !== "string" || typeof row.email !== "string" || (!owner && typeof row.church_id !== "string")) {
    throw new StaffError("unavailable", "Unexpected person row from the database");
  }
  return {
    id: row.id,
    churchId: owner ? PLATFORM : String(row.church_id),
    email: row.email,
    fullName: typeof row.full_name === "string" ? row.full_name : "",
    role: owner ? "owner" : (row.role as Role),
    status: row.status as UserStatus,
    passwordHash: typeof row.password_hash === "string" ? row.password_hash : null,
    ...(owner
      ? {
          totp: {
            secretEnc: typeof row.totp_secret === "string" ? row.totp_secret : null,
            enabled: typeof row.totp_enabled_at === "string",
            lastStep: typeof row.totp_last_step === "number" ? row.totp_last_step : Number(row.totp_last_step ?? 0) || 0,
          },
        }
      : {}),
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

export function createSupabaseStaffStore(opts: {
  url: string;
  serviceKey: string;
  fetchFn?: typeof fetch;
  /** "owner" reads the Maizz owner's own people and tokens. Default "church". */
  area?: "church" | "owner";
}): StaffStore {
  const owner = opts.area === "owner";
  const usersTable = owner ? "owner_users" : "church_users";
  const tokensTable = owner ? "owner_tokens" : "staff_tokens";
  const COLS = owner ? OWNER_COLUMNS : USER_COLUMNS;
  const user = (row: unknown) => toUser(row, owner);
  const base = `${opts.url.replace(/\/+$/, "")}/rest/v1`;
  const fetchFn = opts.fetchFn ?? fetch;
  const headers: Record<string, string> = { apikey: opts.serviceKey, "Content-Type": "application/json" };
  if (opts.serviceKey.startsWith("eyJ")) headers.Authorization = `Bearer ${opts.serviceKey}`;

  async function request(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown, prefer?: string): Promise<Response> {
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

  async function count(res: Response, what: string): Promise<number> {
    if (!res.ok) throw new StaffError("unavailable", `Database refused ${what} (${res.status})`);
    const n: unknown = await res.json().catch(() => NaN);
    if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 1) throw new StaffError("unavailable", `Unreadable ${what}`);
    return n;
  }

  const q = encodeURIComponent;
  const iso = (t: number) => new Date(t).toISOString();

  return {
    async findUserByEmail(email) {
      const r = (await rows(await request("GET", `${usersTable}?email=eq.${q(email)}&select=${COLS}&limit=1`), "person lookup"))[0];
      return r === undefined ? null : user(r);
    },
    async getUser(id) {
      const r = (await rows(await request("GET", `${usersTable}?id=eq.${q(id)}&select=${COLS}&limit=1`), "person lookup"))[0];
      return r === undefined ? null : user(r);
    },
    async listUsers(churchId) {
      const scope = owner ? "" : `church_id=eq.${q(churchId)}&`;
      const res = await request("GET", `${usersTable}?${scope}select=${COLS}&order=created_at.asc&limit=200`);
      return (await rows(res, "team list")).map(user);
    },
    async createUser(u) {
      const res = await request(
        "POST",
        usersTable,
        owner ? { email: u.email, full_name: u.fullName } : { church_id: u.churchId, email: u.email, full_name: u.fullName, role: u.role },
        "return=representation",
      );
      if (res.status === 409) throw new StaffError("exists", "Someone with that email already has an account.");
      return user((await rows(res, "person creation"))[0]);
    },
    async updateUser(id, patch) {
      const body: Rec = {};
      if (patch.passwordHash !== undefined) body.password_hash = patch.passwordHash;
      if (patch.status !== undefined) body.status = patch.status;
      const res = await request("PATCH", `${usersTable}?id=eq.${q(id)}`, body, "return=representation");
      if ((await rows(res, "person update")).length !== 1) throw new StaffError("unavailable", "That person was not found");
    },
    async createToken(t) {
      const res = await request(
        "POST",
        tokensTable,
        { user_id: t.userId, kind: t.kind, token_hash: t.tokenHash, expires_at: iso(t.expiresAt) },
        "return=representation",
      );
      const created = (await rows(res, "token creation"))[0];
      if (!isRec(created) || typeof created.id !== "string") throw new StaffError("unavailable", "Token was not created");
      return created.id;
    },
    async findTokenByHash(kind, tokenHash) {
      const res = await request("GET", `${tokensTable}?kind=eq.${kind}&token_hash=eq.${q(tokenHash)}&select=${TOKEN_COLUMNS}&limit=1`);
      const r = (await rows(res, "token lookup"))[0];
      return r === undefined ? null : toToken(r);
    },
    async getToken(id) {
      const r = (await rows(await request("GET", `${tokensTable}?id=eq.${q(id)}&select=${TOKEN_COLUMNS}&limit=1`), "token lookup"))[0];
      return r === undefined ? null : toToken(r);
    },
    async consumeToken(id) {
      const res = await request(
        "PATCH",
        `${tokensTable}?id=eq.${q(id)}&used_at=is.null`,
        { used_at: new Date().toISOString() },
        "return=representation",
      );
      return (await rows(res, "token use")).length === 1;
    },
    async incrementTokenAttempts(id) {
      return count(await request("POST", "rpc/maizz_code_attempt", { p_token: id, p_area: owner ? "owner" : "church" }), "code attempt count");
    },
    async setTotp(userId, patch) {
      if (!owner) throw new StaffError("unavailable", "Only the Maizz owner has an authenticator app");
      const body: Rec = {};
      if (patch.secretEnc !== undefined) body.totp_secret = patch.secretEnc;
      if (patch.enabled !== undefined) body.totp_enabled_at = patch.enabled ? new Date().toISOString() : null;
      const res = await request("PATCH", `owner_users?id=eq.${q(userId)}`, body, "return=representation");
      if ((await rows(res, "authenticator update")).length !== 1) throw new StaffError("unavailable", "That person was not found");
    },
    async claimTotpStep(userId, step) {
      if (!owner || !Number.isSafeInteger(step) || step < 1) return false;
      const res = await request("PATCH", `owner_users?id=eq.${q(userId)}&totp_last_step=lt.${step}`, { totp_last_step: step }, "return=representation");
      return (await rows(res, "authenticator step")).length === 1;
    },
    async replaceRecoveryCodes(userId, hashes) {
      if (!owner) throw new StaffError("unavailable", "Only the Maizz owner has recovery codes");
      // One database step: the old codes go and the new ones arrive together, or nothing changes.
      const saved = await count(await request("POST", "rpc/maizz_replace_recovery_codes", { p_user: userId, p_hashes: hashes }), "recovery code save");
      if (saved !== hashes.length) throw new StaffError("unavailable", "Recovery codes were not all saved");
    },
    async consumeRecoveryCode(userId, hash) {
      if (!owner) return false;
      const res = await request(
        "PATCH",
        `owner_recovery_codes?user_id=eq.${q(userId)}&code_hash=eq.${q(hash)}&used_at=is.null`,
        { used_at: new Date().toISOString() },
        "return=representation",
      );
      return (await rows(res, "recovery code use")).length === 1;
    },
    async countRecoveryCodes(userId) {
      if (!owner) return 0;
      return (await rows(await request("GET", `owner_recovery_codes?user_id=eq.${q(userId)}&used_at=is.null&select=id&limit=50`), "recovery code count")).length;
    },
    async revokeTokens(userId, kind) {
      await rows(
        await request(
          "PATCH",
          `${tokensTable}?user_id=eq.${q(userId)}&kind=eq.${kind}&used_at=is.null`,
          { used_at: new Date().toISOString() },
          "return=representation",
        ),
        "token revoke",
      );
    },
  };
}
