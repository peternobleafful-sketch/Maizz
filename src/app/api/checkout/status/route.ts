import { giverStatus, REFERENCE_PATTERN } from "@/lib/checkout";
import { logError } from "@/lib/log";
import { getLedger, getPaymentProvider } from "@/lib/payments";
import { settleGift } from "@/lib/reconcile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SETTLE_AFTER_MS = 15_000;

/** Public. Tells a giver whether their gift has been confirmed. Returns a word, nothing else. */
export async function GET(req: Request) {
  const reference = new URL(req.url).searchParams.get("reference") ?? "";
  if (!REFERENCE_PATTERN.test(reference)) return Response.json({ status: "unknown" }, { status: 400 });
  try {
    const ledger = getLedger();
    let s = await ledger.currentStatus(reference);
    // Still waiting after a short while: ask the provider directly instead of waiting for its notice.
    if (s && s.status === "pending") {
      const gift = await ledger.findGiftByReference(reference);
      if (gift && Date.now() - Date.parse(gift.createdAt) > SETTLE_AFTER_MS) {
        await settleGift({ ledger, provider: getPaymentProvider(), gift });
        s = await ledger.currentStatus(reference);
      }
    }
    return Response.json({ status: giverStatus(s) });
  } catch (err) {
    logError("checkout.status_failed", { reason: err instanceof Error ? err.message : "unknown" });
    return Response.json({ status: "confirming" });
  }
}
