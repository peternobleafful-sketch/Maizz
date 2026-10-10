import { getAudit } from "@/lib/audit";
import { openAdminRoute } from "@/lib/adminAuth";
import { logError } from "@/lib/log";
import { getNotifier } from "@/lib/notifyRuntime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Runs at 08:00, five hours after the daily check. If the daily check left no note in the last 26 hours, it emails the owner.
// Uses the same CRON_SECRET as the daily check.
export async function GET(req: Request) {
  const denied = await openAdminRoute(req, process.env, "cron.watchdog", undefined, {
    tokenEnv: "CRON_SECRET",
    failedAction: "cron.auth_failed",
  });
  if (denied) return denied;
  try {
    const ran = await getAudit().countSince("reconcile.run", 26 * 60);
    if (ran === 0) {
      await getNotifier().alert("daily_check_missing", "The daily check of the books did not run", [
        "The daily check has not run in the last 26 hours.",
        "Check Vercel, Settings, Cron Jobs, and that CRON_SECRET is set for Production.",
      ]);
    }
    return Response.json({ ok: true, dailyCheckRan: ran > 0 });
  } catch (err) {
    logError("cron.watchdog_failed", { reason: err instanceof Error ? err.message : "unknown" });
    return Response.json({ ok: false }, { status: 500 });
  }
}
