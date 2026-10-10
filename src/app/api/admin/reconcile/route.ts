import { getAudit } from "@/lib/audit";
import { openAdminRoute } from "@/lib/adminAuth";
import { logError } from "@/lib/log";
import { getLedger, getPaymentProvider } from "@/lib/payments";
import { getNotifier } from "@/lib/notifyRuntime";
import { reconcile } from "@/lib/reconcile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Private tool: runs the daily check now.
export async function POST(req: Request) {
  const denied = await openAdminRoute(req, process.env, "admin.reconcile");
  if (denied) return denied;
  try {
    const summary = await reconcile({ ledger: getLedger(), provider: getPaymentProvider(), audit: getAudit(), notify: getNotifier() });
    return Response.json({ summary });
  } catch (err) {
    logError("admin.reconcile_failed", { reason: err instanceof Error ? err.message : "unknown" });
    return Response.json({ error: "The daily check could not run. See the Vercel logs." }, { status: 502 });
  }
}
