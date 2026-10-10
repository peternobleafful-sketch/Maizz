import { getAudit, sourceKeyFor } from "@/lib/audit";
import { REFERENCE_PATTERN, toGiverStep } from "@/lib/checkout";
import { logError } from "@/lib/log";
import { getLedger, getPaymentProvider } from "@/lib/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public. Sends the code a giver received (some networks ask for one). Limited per source. */
export async function POST(req: Request) {
  const text = await req.text();
  let raw: unknown;
  try {
    raw = text.length <= 1_000 ? JSON.parse(text) : null;
  } catch {
    raw = null;
  }
  const b = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const reference = typeof b.reference === "string" && REFERENCE_PATTERN.test(b.reference) ? b.reference : null;
  const otp = typeof b.otp === "string" && /^[A-Za-z0-9]{3,10}$/.test(b.otp.trim()) ? b.otp.trim() : null;
  if (!reference || !otp) return Response.json({ error: "Enter the code you were sent." }, { status: 400 });

  try {
    const audit = getAudit();
    const secret = process.env.SETUP_CHECK_TOKEN ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "maizz";
    const source = sourceKeyFor(req, secret);
    if ((await audit.countSince("checkout.code", 10, source)) >= 10) {
      return Response.json({ error: "Too many attempts. Please wait a few minutes and try again." }, { status: 429, headers: { "Retry-After": "600" } });
    }
    await audit.record({ actor: "giver", action: "checkout.code", target: reference, sourceKey: source });

    const gift = await getLedger().findGiftByReference(reference);
    if (!gift) return Response.json({ error: "We could not find that gift." }, { status: 404 });
    const result = await getPaymentProvider().submitOtp(reference, otp);
    return Response.json({ step: toGiverStep(result) });
  } catch (err) {
    logError("checkout.code_failed", { reason: err instanceof Error ? err.message : "unknown" });
    return Response.json({ error: "That code did not work. Please check it and try again." }, { status: 502 });
  }
}
