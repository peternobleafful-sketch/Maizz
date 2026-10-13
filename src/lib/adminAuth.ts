import { createHash, timingSafeEqual } from "node:crypto";
import { getAudit, sourceKeyFor, type AuditLog } from "./audit";
import type { Env } from "./config";
import { logError } from "./log";

export const ADMIN_LIMITS = {
  /** Wrong tokens allowed from one source in the window before it is locked out. */
  perSource: 5,
  /** Wrong tokens from everyone together in the window that trigger an alert email. Nothing is blocked. */
  spikeAlert: 20,
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
 * - The secret is checked first. The right secret always goes through (and is audited), so nobody can shut the owner out by sending junk.
 * - Only wrong secrets count. Repeated wrong secrets from one source lock that source only (429).
 * - A burst of wrong secrets from many sources never blocks anyone; it only sends an alert.
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
  /** Which setting holds the secret. The daily check and the watchdog use CRON_SECRET, everything else SETUP_CHECK_TOKEN. */
  tokenEnv?: string;
  /** What a wrong secret is logged as, and what the lock-out counts. Each caller group has its own. */
  failedAction?: string;
  /** Called when one source locks because of repeated wrong secrets. Must not throw. */
  onLocked?: () => Promise<void>;
  /** Called (alert only, nothing is blocked) when wrong secrets keep arriving from many sources. Must not throw. */
  onSpike?: () => Promise<void>;
}): Promise<Response | null> {
  const { req, env, audit, action, target } = args;
  const FAILED = args.failedAction ?? "admin.auth_failed";
  const token = env[args.tokenEnv ?? "SETUP_CHECK_TOKEN"]?.trim();
  if (!token || token.length < MIN_TOKEN_LENGTH) {
    return new Response("Not found", { status: 404 });
  }
  const sourceKey = sourceKeyFor(req, token);
  const wait = "The audit log is not available. Check that 0002_audit.sql has been run in Supabase and that the Supabase settings in Vercel are right.";

  const header = req.headers.get("authorization") ?? "";
  const sent = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const ok = sent.length > 0 && timingSafeEqual(digest(sent), digest(token));

  if (ok) {
    try {
      await audit.record({ actor: args.tokenEnv ? "cron" : "admin", action, outcome: "ok", sourceKey, target });
    } catch {
      logError("admin.audit_write_failed");
      return unavailable(wait);
    }
    return null;
  }

  try {
    const [mine, everyone] = await Promise.all([
      audit.countSince(FAILED, ADMIN_LIMITS.windowMinutes, sourceKey),
      audit.countSince(FAILED, ADMIN_LIMITS.windowMinutes),
    ]);
    if (mine >= ADMIN_LIMITS.perSource) {
      await args.onLocked?.();
      return Response.json(
        { error: "locked", message: "Too many wrong attempts from this address. Try again in 15 minutes." },
        { status: 429, headers: { "Retry-After": String(ADMIN_LIMITS.windowMinutes * 60) } },
      );
    }
    if (everyone >= ADMIN_LIMITS.spikeAlert) await args.onSpike?.();
  } catch {
    logError("admin.audit_unavailable");
    return unavailable(wait);
  }

  try {
    await audit.record({ actor: "unknown", action: FAILED, outcome: "denied", sourceKey, target: action });
  } catch {
    logError("admin.audit_write_failed");
    return unavailable(wait);
  }
  return Response.json({ error: "Not allowed" }, { status: 401 });
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
    await getNotifier(env).alert("admin_locked", "One address was locked out of the owner tools", [
      "Someone tried the owner tools or the daily-check address with a wrong secret several times, so that one address was locked for 15 minutes. The right secret still works for you.",
      "If this was not you, rotate SETUP_CHECK_TOKEN and CRON_SECRET in Vercel.",
    ]);
  };
  const onSpike = async () => {
    const { getNotifier } = await import("./notifyRuntime");
    await getNotifier(env).alert("admin_spike", "Many wrong secrets are arriving at the owner tools", [
      "Wrong secrets keep arriving from several addresses. Nothing is blocked and your own secret still works.",
      "If this keeps happening, rotate SETUP_CHECK_TOKEN and CRON_SECRET in Vercel.",
    ]);
  };
  return adminGate({ req, env, audit, action, target, onLocked, onSpike, ...options });
}
