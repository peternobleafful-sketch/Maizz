import { openAdminRoute } from "@/lib/adminAuth";
import { logError } from "@/lib/log";
import { getLedger, getPaymentProvider } from "@/lib/payments";
import { ProviderError } from "@/lib/payments/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Private tool: asks Paystack directly about a test gift, and shows what the ledger recorded.
export async function GET(req: Request) {
  const reference = new URL(req.url).searchParams.get("reference") ?? "";
  const valid = /^mz_test_[a-f0-9]{24}$/.test(reference);

  const denied = await openAdminRoute(req, process.env, "admin.check_gift", valid ? reference : undefined);
  if (denied) return denied;

  if (!valid) {
    return Response.json({ error: "That is not a Maizz test reference." }, { status: 400 });
  }

  try {
    const provider = getPaymentProvider();
    const ledger = getLedger();
    const [fromProvider, inLedger] = await Promise.all([
      provider.verify(reference).catch((err: unknown) => {
        if (err instanceof ProviderError && err.httpStatus === 404) return null;
        throw err;
      }),
      ledger.currentStatus(reference),
    ]);
    return Response.json({
      paystack: fromProvider
        ? { status: fromProvider.rawStatus ?? fromProvider.status, amountPesewas: fromProvider.amountPesewas }
        : null,
      ledger: inLedger,
    });
  } catch (err) {
    logError("check_gift.failed", { reason: err instanceof Error ? err.message : "unknown" });
    return Response.json({ error: "Could not check that gift. Try again." }, { status: 502 });
  }
}
