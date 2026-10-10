import { openAdminRoute } from "@/lib/adminAuth";
import { classifyPaystackKey } from "@/lib/config";
import { logError } from "@/lib/log";
import { assertPositivePesewas } from "@/lib/money";
import { getLedger, getPaymentProvider } from "@/lib/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Private tool, test mode only: refunds a paid TEST gift (all of what is left, or an amount in pesewas).
// The refund is recorded in the ledger when the payment provider's refund notice arrives, not here.
export async function POST(req: Request) {
  let input: unknown;
  try {
    input = await req.json();
  } catch {
    input = {};
  }
  const body = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const reference = typeof body.reference === "string" && /^mz_test_[a-f0-9]{24}$/.test(body.reference) ? body.reference : undefined;

  const denied = await openAdminRoute(req, process.env, "admin.refund", reference);
  if (denied) return denied;

  if (classifyPaystackKey(process.env.PAYSTACK_SECRET_KEY) !== "test") {
    return Response.json({ error: "This tool only works with a Paystack test key." }, { status: 400 });
  }
  if (!reference) return Response.json({ error: "That is not a Maizz test reference." }, { status: 400 });

  try {
    const ledger = getLedger();
    const gift = await ledger.findGiftByReference(reference);
    const now = await ledger.currentStatus(reference);
    if (!gift || !now) return Response.json({ error: "No such test gift." }, { status: 404 });
    if (!now.wasPaid) return Response.json({ error: "That gift was never paid, so there is nothing to refund." }, { status: 400 });

    const left = gift.totalPesewas - now.refundedPesewas;
    if (left <= 0) return Response.json({ error: "That gift is already fully refunded." }, { status: 400 });
    let amount = left;
    if (body.amountPesewas !== undefined) {
      try {
        assertPositivePesewas(body.amountPesewas, "refund amount");
      } catch {
        return Response.json({ error: "The refund amount must be whole pesewas." }, { status: 400 });
      }
      amount = body.amountPesewas as number;
      if (amount > left) return Response.json({ error: `Only ${left} pesewas are left to refund.` }, { status: 400 });
    }
    const result = await getPaymentProvider().refund({ reference, amountPesewas: amount });
    return Response.json({ refund: result.status, amountPesewas: amount });
  } catch (err) {
    logError("admin.refund_failed", { reason: err instanceof Error ? err.message : "unknown" });
    return Response.json({ error: "The refund could not be started. See the Vercel logs." }, { status: 502 });
  }
}
