import { getAudit } from "@/lib/audit";
import { openAdminRoute } from "@/lib/adminAuth";
import { logError } from "@/lib/log";
import { getLedger, getPaymentProvider } from "@/lib/payments";
import { reconcile } from "@/lib/reconcile";

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
    const summary = await reconcile({ ledger: getLedger(), provider: getPaymentProvider(), audit: getAudit() });
    return Response.json({ ok: true, summary });
  } catch (err) {
    logError("cron.reconcile_failed", { reason: err instanceof Error ? err.message : "unknown" });
    return Response.json({ ok: false }, { status: 500 });
  }
}
