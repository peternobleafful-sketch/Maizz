import { giverStatus, REFERENCE_PATTERN } from "@/lib/checkout";
import { logError } from "@/lib/log";
import { getLedger } from "@/lib/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public. Tells a giver whether their gift has been confirmed. Returns a word, nothing else. */
export async function GET(req: Request) {
  const reference = new URL(req.url).searchParams.get("reference") ?? "";
  if (!REFERENCE_PATTERN.test(reference)) return Response.json({ status: "unknown" }, { status: 400 });
  try {
    const s = await getLedger().currentStatus(reference);
    return Response.json({ status: giverStatus(s) });
  } catch (err) {
    logError("checkout.status_failed", { reason: err instanceof Error ? err.message : "unknown" });
    return Response.json({ status: "confirming" });
  }
}
