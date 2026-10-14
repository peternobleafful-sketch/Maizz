import { getAudit, sourceKeyFor, type AuditLog } from "@/lib/audit";
import { checkStartLimits, noteSiteVolume, SITE_HOURLY_ALERT } from "@/lib/checkoutLimits";
import { memberMasterKey } from "@/lib/memberLink";
import { getNotifier } from "@/lib/notifyRuntime";
import { readCappedText, sameSite } from "@/lib/staffRoutes";
import { phoneKey, rateSecret } from "@/lib/rateKey";
import { CheckoutError, parseCheckout, startCheckout } from "@/lib/checkout";
import { classifyPaystackKey } from "@/lib/config";
import { logError } from "@/lib/log";
import { getLedger, getPaymentProvider } from "@/lib/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 5_000;

/** Public. Starts a mobile money gift. Limited per source, and refuses if the audit log is down. */
export async function POST(req: Request) {
  // Only our own pages may start a gift. (A bot can still fake this header, so the limits below remain the real protection.)
  if (!sameSite(req)) return Response.json({ error: "Not allowed" }, { status: 403 });
  let audit: AuditLog;
  try {
    audit = getAudit();
  } catch {
    return Response.json({ error: "Giving is not available right now. Please try again shortly." }, { status: 503 });
  }

  let source: string;
  try {
    source = sourceKeyFor(req, rateSecret(process.env));
  } catch {
    logError("checkout.rate_secret_missing");
    return Response.json({ error: "Giving is not available right now. Please try again shortly." }, { status: 503 });
  }

  const text = await readCappedText(req, MAX_BODY).catch(() => null);
  if (text === null) return Response.json({ error: "That request is too large." }, { status: 413 });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return Response.json({ error: "Enter your gift details." }, { status: 400 });
  }
  const parsed = parseCheckout(raw);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  try {
    const refused = await checkStartLimits(audit, source, phoneKey(parsed.input.phone, process.env));
    if (refused === "source") {
      return Response.json({ error: "Too many attempts. Please wait a few minutes and try again." }, { status: 429, headers: { "Retry-After": "600" } });
    }
    if (refused === "phone") {
      return Response.json(
        { error: "This number has had several gift requests in the last hour. Please wait a little before trying again." },
        { status: 429, headers: { "Retry-After": "3600" } },
      );
    }

    // Many gift starts site-wide in an hour is only an alert, never a block: a big Sunday is not an attack.
    const volume = await noteSiteVolume(audit).catch(() => 0);
    if (volume === SITE_HOURLY_ALERT) {
      await getNotifier()
        .alert("checkout_surge", "Unusually many gift starts in the last hour", [
          `${SITE_HOURLY_ALERT} gift starts were counted across Maizz in an hour. That may be a big Sunday, or someone testing the giving page.`,
          "Nothing is blocked. If it is not a Sunday, check Vercel's firewall and the audit log, and consider switching on the bot check.",
        ])
        .catch(() => undefined);
    }

    const keyKind = classifyPaystackKey(process.env.PAYSTACK_SECRET_KEY);
    const testMode = keyKind === "test";
    // A gift's own row in the ledger is the record that it started; nothing is added to the audit log for it.
    const started = await startCheckout({
      ledger: getLedger(),
      provider: getPaymentProvider(),
      input: parsed.input,
      testMode,
      live: keyKind === "live",
      standInEmail: process.env.PROVIDER_STAND_IN_EMAIL?.trim() || undefined,
      memberLinkMaster: memberMasterKey(process.env),
    });
    return Response.json({
      reference: started.reference,
      step: started.step,
      giftPesewas: started.fees.giftPesewas,
      feePesewas: started.fees.feePesewas,
      totalPesewas: started.fees.totalPesewas,
    });
  } catch (err) {
    if (err instanceof CheckoutError) return Response.json({ error: err.message }, { status: 404 });
    logError("checkout.failed", { reason: err instanceof Error ? err.message : "unknown" });
    return Response.json({ error: "Giving is not available right now. Please try again shortly." }, { status: 503 });
  }
}
