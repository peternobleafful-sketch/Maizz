import { getAudit, sourceKeyFor } from "@/lib/audit";
import { REFERENCE_PATTERN, toGiverStep } from "@/lib/checkout";
import { logError } from "@/lib/log";
import { giftKey, rateSecret } from "@/lib/rateKey";
import { readCappedText, sameSite } from "@/lib/staffRoutes";
import { getLedger, getPaymentProvider } from "@/lib/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A whole church can share one Wi-Fi address, so the address limit is high; the limit per gift is what stops code guessing.
const OTP_LIMIT_PER_SOURCE = 40;
const OTP_LIMIT_PER_GIFT = 10;

/** Public. Sends the code a giver received (some networks ask for one). Limited per source. */
export async function POST(req: Request) {
  // Only our own pages may call this, and never read more than a small body.
  if (!sameSite(req)) return Response.json({ error: "Not allowed" }, { status: 403 });
  const text = await readCappedText(req, 1_000).catch(() => null);
  let raw: unknown;
  try {
    raw = text !== null ? JSON.parse(text) : null;
  } catch {
    raw = null;
  }
  const b = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const reference = typeof b.reference === "string" && REFERENCE_PATTERN.test(b.reference) ? b.reference : null;
  const otp = typeof b.otp === "string" && /^[A-Za-z0-9]{3,10}$/.test(b.otp.trim()) ? b.otp.trim() : null;
  if (!reference || !otp) return Response.json({ error: "Enter the code you were sent." }, { status: 400 });

  try {
    const audit = getAudit();
    const source = sourceKeyFor(req, rateSecret(process.env));
    const tries = await audit.hit({ action: "checkout.code", sourceKey: source, minutes: 10 });
    const forGift = await audit.hit({ action: "checkout.code_gift", sourceKey: giftKey(reference), minutes: 10 });
    if (tries > OTP_LIMIT_PER_SOURCE || forGift > OTP_LIMIT_PER_GIFT) {
      return Response.json({ error: "Too many attempts. Please wait a few minutes and try again." }, { status: 429, headers: { "Retry-After": "600" } });
    }

    const gift = await getLedger().findGiftByReference(reference);
    if (!gift) return Response.json({ error: "We could not find that gift." }, { status: 404 });
    const result = await getPaymentProvider().submitOtp(reference, otp);
    return Response.json({ step: toGiverStep(result) });
  } catch (err) {
    logError("checkout.code_failed", { reason: err instanceof Error ? err.message : "unknown" });
    return Response.json({ error: "That code did not work. Please check it and try again." }, { status: 502 });
  }
}
