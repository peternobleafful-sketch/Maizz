import { createHash, timingSafeEqual } from "node:crypto";
import { getAudit, sourceKeyFor, type AuditLog } from "./audit";
import type { Env } from "./config";
import { logError } from "./log";

export const ADMIN_LIMITS = {
  /** Wrong tokens allowed from one source in the window before it is locked out. */
  perSource: 5,
  /** Wrong tokens allowed from everyone together in the window before all attempts are locked out. */
  global: 20,
  windowMinutes: 15,
} as const;

const MIN_TOKEN_LENGTH = 24;

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function unavailable(message: string): Response {
  return Response.json({ error: "audit_unavailable", message }, { status: 503 });
}

/**
 * Protects the private setup and test tools.
 * - Switched off (404) unless SETUP_CHECK_TOKEN is set and at least 24 characters.
 * - Repeated wrong tokens lock the tools for a while (429), even if the right token is then tried.
 * - Every wrong attempt and every admin action is written to the permanent audit log first.
 * - If the audit log cannot be reached, the tools refuse to work (503). They never run unrecorded.
 * Returns null when the request may go ahead, or a Response to send back.
 */
export async function adminGate(args: {
  req: Request;
  env: Env;
  audit: AuditLog;
  action: string;
  target?: string;
  /** Which setting holds the secret. The daily check uses CRON_SECRET, everything else SETUP_CHECK_TOKEN. */
  tokenEnv?: string;
  /** What a wrong secret is logged as, and what the lock-out counts. */
  failedAction?: string;
  /** Called when the tools lock because of repeated wrong secrets. Must not throw. */
  onLocked?: () => Promise<void>;
}): Promise<Response | null> {
  const { req, env, audit, action, target } = args;
  const FAILED = args.failedAction ?? "admin.auth_failed";
  const token = env[args.tokenEnv ?? "SETUP_CHECK_TOKEN"]?.trim();
  if (!token || token.length < MIN_TOKEN_LENGTH) {
    return new Response("Not found", { status: 404 });
  }
  const sourceKey = sourceKeyFor(req, token);
  const wait = "The audit log is not available. Check that 0002_audit.sql has been run in Supabase and that the Supabase settings in Vercel are right.";

  try {
    const [mine, everyone] = await Promise.all([
      audit.countSince(FAILED, ADMIN_LIMITS.windowMinutes, sourceKey),
      audit.countSince(FAILED, ADMIN_LIMITS.windowMinutes),
    ]);
    if (mine >= ADMIN_LIMITS.perSource || everyone >= ADMIN_LIMITS.global) {
      await args.onLocked?.();
      return Response.json(
        { error: "locked", message: "Too many wrong attempts. The tools are locked for 15 minutes." },
        { status: 429, headers: { "Retry-After": String(ADMIN_LIMITS.windowMinutes * 60) } },
      );
    }
  } catch {
    logError("admin.audit_unavailable");
    return unavailable(wait);
  }

  const header = req.headers.get("authorization") ?? "";
  const sent = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const ok = sent.length > 0 && timingSafeEqual(digest(sent), digest(token));

  try {
    if (!ok) {
      await audit.record({ actor: "unknown", action: FAILED, outcome: "denied", sourceKey, target: action });
      return Response.json({ error: "Not allowed" }, { status: 401 });
    }
    await audit.record({ actor: args.tokenEnv ? "cron" : "admin", action, outcome: "ok", sourceKey, target });
  } catch {
    logError("admin.audit_write_failed");
    return unavailable(wait);
  }
  return null;
}

/** For the routes: builds the audit log, then runs the gate. */
export async function openAdminRoute(
  req: Request,
  env: Env,
  action: string,
  target?: string,
  options: { tokenEnv?: string; failedAction?: string } = {},
): Promise<Response | null> {
  let audit: AuditLog;
  try {
    audit = getAudit(env);
  } catch (err) {
    return unavailable(err instanceof Error ? err.message : "The Supabase settings are missing.");
  }
  const onLocked = async () => {
    const { getNotifier } = await import("./notifyRuntime");
    await getNotifier(env).alert("admin_locked", "The owner tools were locked after wrong attempts", [
      "Someone tried the owner tools or the daily-check address with a wrong secret several times, so they were locked for 15 minutes.",
      "If this was not you, rotate SETUP_CHECK_TOKEN and CRON_SECRET in Vercel.",
    ]);
  };
  return adminGate({ req, env, audit, action, target, onLocked, ...options });
}
