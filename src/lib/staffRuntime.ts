import { getAudit } from "./audit";
import { ConfigError, requireSupabase, type Env } from "./config";
import { requireMailer } from "./mailer";
import { createStaffService, StaffError, type StaffService } from "./staff";
import { createSupabaseStaffStore } from "./staffStore";

export const STAFF_COOKIE = "maizz_staff";

/** Builds the sign-in service from settings. Throws a plain message if something is not set up. */
export function getStaffService(env: Env = process.env, opts: { needMail?: boolean } = {}): StaffService {
  const pepper = env.STAFF_SECRET?.trim() ?? "";
  if (pepper.length < 32) throw new ConfigError("STAFF_SECRET is not set (it needs at least 32 characters).");
  const { url, serviceKey } = requireSupabase(env);
  return createStaffService({
    store: createSupabaseStaffStore({ url, serviceKey }),
    audit: getAudit(env),
    mailer: opts.needMail === false ? { send: async () => { throw new StaffError("unavailable", "no mail"); } } : requireMailer(env),
    pepper,
  });
}

export function cookieHeader(value: string, maxAgeSeconds: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${STAFF_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export function readCookie(req: Request, name = STAFF_COOKIE): string | undefined {
  const raw = req.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=") || undefined;
  }
  return undefined;
}
