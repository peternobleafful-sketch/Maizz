import { openAdminRoute } from "@/lib/adminAuth";
import { classifyPaystackKey } from "@/lib/config";
import { addFees } from "@/lib/fees";
import { logError } from "@/lib/log";
import { normaliseGhanaPhone } from "@/lib/phone";
import { getLedger, getPaymentProvider } from "@/lib/payments";
import { newGiftReference } from "@/lib/payments/reference";
import { ProviderError, type MobileMoneyNetwork } from "@/lib/payments/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NETWORKS: readonly MobileMoneyNetwork[] = ["mtn", "vodafone", "airteltigo"];
const TEST_AMOUNT_PESEWAS = 100; // GH₵1.00

// Private tool for test mode only: starts a GH₵1 mobile money test gift for a "Maizz Test Church".
export async function POST(req: Request) {
  const denied = await openAdminRoute(req, process.env, "admin.test_gift");
  if (denied) return denied;

  if (classifyPaystackKey(process.env.PAYSTACK_SECRET_KEY) !== "test") {
    return Response.json({ error: "This tool only works with a Paystack test key." }, { status: 400 });
  }

  let input: unknown;
  try {
    input = await req.json();
  } catch {
    return Response.json({ error: "Send the network and phone number." }, { status: 400 });
  }
  const body = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const network = NETWORKS.find((n) => n === body.network);
  const phone = typeof body.phone === "string" ? normaliseGhanaPhone(body.phone) : null;
  const email = typeof body.email === "string" && body.email.trim() ? body.email.trim() : "maizz-test@example.com";
  if (!network) return Response.json({ error: "Choose MTN, Vodafone or AirtelTigo." }, { status: 400 });
  if (!phone) return Response.json({ error: "Enter a Ghana number such as 0551234987." }, { status: 400 });

  try {
    const provider = getPaymentProvider();
    const ledger = getLedger();
    const churchId = await ledger.getOrCreateChurch("maizz-test-church", "Maizz Test Church");
    const reference = newGiftReference("mz_test");
    const fees = addFees(TEST_AMOUNT_PESEWAS);
    const gift = await ledger.createGift({
      reference,
      churchId,
      giftType: "other",
      amountPesewas: fees.giftPesewas,
      feePesewas: fees.feePesewas,
    });

    const result = await provider.initialize({
      reference,
      amountPesewas: gift.totalPesewas,
      email,
      channel: "mobile_money",
      mobileMoney: { network, phone },
      metadata: { church_id: churchId, test: "true" },
    });

    if (result.kind === "failed") {
      await ledger.addEvent({ giftId: gift.id, status: "failed", detail: { source: "initialize" } });
    } else {
      await ledger.addEvent({ giftId: gift.id, status: "pending", detail: { source: "initialize" } });
    }
    return Response.json({ reference, result, giftPesewas: fees.giftPesewas, feePesewas: fees.feePesewas, totalPesewas: fees.totalPesewas });
  } catch (err) {
    const message = err instanceof ProviderError ? err.message : "Something went wrong. Check the Vercel logs.";
    logError("test_gift.failed", { reason: err instanceof Error ? err.message : "unknown" });
    return Response.json({ error: message }, { status: 502 });
  }
}
