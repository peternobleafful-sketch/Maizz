import { getAudit } from "@/lib/audit";
import { logError } from "@/lib/log";
import { getLedger, getPaymentProvider } from "@/lib/payments";
import { getNotifier } from "@/lib/notifyRuntime";
import { processWebhook } from "@/lib/payments/webhookHandler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Paystack posts payment notices here. Every notice is checked against its signature first.
export async function POST(req: Request) {
  let provider;
  let ledger;
  let audit;
  try {
    provider = getPaymentProvider();
    ledger = getLedger();
    audit = getAudit();
  } catch (err) {
    logError("webhook.misconfigured", { reason: err instanceof Error ? err.message : "unknown" });
    return Response.json({ ok: false, result: "misconfigured" }, { status: 500 });
  }

  const rawBody = await req.text();
  const result = await processWebhook({
    provider,
    ledger,
    rawBody,
    signature: req.headers.get("x-paystack-signature"),
    audit,
    notify: getNotifier(),
  });
  return Response.json(result.body, { status: result.status });
}
