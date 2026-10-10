import { getAudit, sourceKeyFor, type AuditLog } from "@/lib/audit";
import { parseCheckout, startCheckout } from "@/lib/checkout";
import { classifyPaystackKey } from "@/lib/config";
import { logError } from "@/lib/log";
import { getLedger, getPaymentProvider } from "@/lib/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 5_000;
const START_LIMIT = { perSource: 8, minutes: 10 };

/** Public. Starts a mobile money gift. Limited per source, and refuses if the audit log is down. */
export async function POST(req: Request) {
  let audit: AuditLog;
  try {
    audit = getAudit();
  } catch {
    return Response.json({ error: "Giving is not available right now. Please try again shortly." }, { status: 503 });
  }

  const secret = process.env.SETUP_CHECK_TOKEN ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "maizz";
  const source = sourceKeyFor(req, secret);

  const text = await req.text();
  if (text.length > MAX_BODY) return Response.json({ error: "That request is too large." }, { status: 413 });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return Response.json({ error: "Enter your gift details." }, { status: 400 });
  }
  const parsed = parseCheckout(raw);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  try {
    const recent = await audit.countSince("checkout.started", START_LIMIT.minutes, source);
    if (recent >= START_LIMIT.perSource) {
      return Response.json({ error: "Too many attempts. Please wait a few minutes and try again." }, { status: 429, headers: { "Retry-After": "600" } });
    }

    const testMode = classifyPaystackKey(process.env.PAYSTACK_SECRET_KEY) === "test";
    const started = await startCheckout({ ledger: getLedger(), provider: getPaymentProvider(), input: parsed.input, testMode });
    await audit
      .record({
        actor: "giver",
        action: "checkout.started",
        target: started.reference,
        sourceKey: source,
        detail: { gift_type: parsed.input.giftType, amount_pesewas: parsed.input.amountPesewas, anonymous: parsed.input.anonymous },
      })
      .catch(() => logError("audit.write_failed", { action: "checkout.started" }));
    return Response.json({
      reference: started.reference,
      step: started.step,
      giftPesewas: started.fees.giftPesewas,
      feePesewas: started.fees.feePesewas,
      totalPesewas: started.fees.totalPesewas,
    });
  } catch (err) {
    logError("checkout.failed", { reason: err instanceof Error ? err.message : "unknown" });
    return Response.json({ error: "Giving is not available right now. Please try again shortly." }, { status: 503 });
  }
}
