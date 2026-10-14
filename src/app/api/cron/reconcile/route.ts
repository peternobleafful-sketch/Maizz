import { getAudit } from "@/lib/audit";
import { openAdminRoute } from "@/lib/adminAuth";
import { logError } from "@/lib/log";
import { getLedger, getPaymentProvider } from "@/lib/payments";
import { getNotifier } from "@/lib/notifyRuntime";
import { reconcile } from "@/lib/reconcile";
import { runCleanUp } from "@/lib/retention";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called once a day by Vercel's scheduler. Vercel sends "Authorization: Bearer <CRON_SECRET>".
// Switched off (404) unless CRON_SECRET is set (24+ characters). Wrong secrets lock it like the admin tools.
export async function GET(req: Request) {
  const denied = await openAdminRoute(req, process.env, "cron.reconcile", undefined, {
    tokenEnv: "CRON_SECRET",
    failedAction: "cron.auth_failed",
  });
  if (denied) return denied;
  try {
    const ledger = getLedger();
    const audit = getAudit();
    const summary = await reconcile({ ledger, provider: getPaymentProvider(), audit, notify: getNotifier() });
    // Old personal details are removed after the books are checked, so a problem in one never stops the other.
    const cleanUp = await runCleanUp({ ledger, audit });
    return Response.json({ ok: true, summary, cleanUp });
  } catch (err) {
    logError("cron.reconcile_failed", { reason: err instanceof Error ? err.message : "unknown" });
    return Response.json({ ok: false }, { status: 500 });
  }
}
