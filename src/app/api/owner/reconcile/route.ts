import { getAudit } from "@/lib/audit";
import { logError } from "@/lib/log";
import { getNotifier } from "@/lib/notifyRuntime";
import { openOwnerRoute } from "@/lib/ownerRequest";
import { getLedger, getPaymentProvider } from "@/lib/payments";
import { reconcile } from "@/lib/reconcile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The owner runs the daily check of the books now. Needs the owner sign-in.
export async function POST(req: Request) {
  const opened = await openOwnerRoute(req, "owner.reconcile");
  if (opened instanceof Response) return opened;
  try {
    const summary = await reconcile({ ledger: getLedger(), provider: getPaymentProvider(), audit: getAudit(), notify: getNotifier() });
    return Response.json({ summary });
  } catch (err) {
    logError("owner.reconcile_failed", { reason: err instanceof Error ? err.message : "unknown" });
    return Response.json({ error: "The daily check could not run. See the Vercel logs." }, { status: 502 });
  }
}
