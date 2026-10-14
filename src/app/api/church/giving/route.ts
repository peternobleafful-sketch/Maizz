import { getAudit } from "@/lib/audit";
import { getStaffService, readCookie } from "@/lib/staffRuntime";
import { readJson, sameSite, sourceOf } from "@/lib/staffRoutes";
import { getLedger } from "@/lib/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO = (status: number, error: string) => Response.json({ error }, { status });

// A church owner pauses or resumes their own giving page. The church always comes from the session, never from the request.
// Maizz suspending a church is separate: a church can never undo that from here.
export async function POST(req: Request) {
  if (!sameSite(req)) return NO(403, "Not allowed");
  const body = await readJson(req);
  if (!body || typeof body.paused !== "boolean") return NO(400, "Bad request");

  let session;
  try {
    session = await getStaffService(process.env, { needMail: false }).getSession(readCookie(req));
  } catch {
    return NO(503, "Sign-in is not available right now.");
  }
  if (!session) return NO(401, "Please sign in again.");
  const me = session.user;
  if (me.role !== "owner") return NO(403, "Only owners can pause giving.");

  try {
    const ledger = getLedger();
    const church = await ledger.getChurchById(me.churchId);
    if (!church) return NO(403, "Not allowed");
    if (church.status !== "active") return NO(400, "Your giving page is not open, so there is nothing to pause.");
    if (church.paused === body.paused) return Response.json({ paused: church.paused });
    // Audit first: if the record cannot be written, the change is refused.
    await getAudit().record({
      actor: `staff:${me.id}`,
      action: body.paused ? "church.pause_giving" : "church.resume_giving",
      target: church.id,
      outcome: "ok",
      sourceKey: sourceOf(req),
    });
    await ledger.setChurchPaused(church.id, body.paused);
    return Response.json({ paused: body.paused });
  } catch {
    return NO(502, "Something went wrong. Try again in a minute.");
  }
}
