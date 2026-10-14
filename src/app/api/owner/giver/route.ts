import { getAudit } from "@/lib/audit";
import { openOwnerRoute } from "@/lib/ownerRequest";
import { removeGiverDetails } from "@/lib/ownerGiver";
import { getLedger } from "@/lib/payments";
import { sourceOf } from "@/lib/staffRoutes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The owner removes a giver's personal details (a data request). Needs the owner sign-in; audited.
export async function POST(req: Request) {
  const opened = await openOwnerRoute(req, "owner.giver_remove");
  if (opened instanceof Response) return opened;
  const body = (await req.json().catch(() => null)) as { reference?: unknown } | null;
  const out = await removeGiverDetails({
    ledger: getLedger(),
    audit: getAudit(),
    actor: `owner:${opened.user.id}`,
    sourceKey: sourceOf(req),
    reference: body?.reference,
  });
  return Response.json(out.body, { status: out.status });
}
