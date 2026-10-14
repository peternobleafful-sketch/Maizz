import { getAudit } from "@/lib/audit";
import { ROLES, StaffError, type Role } from "@/lib/staff";
import { getStaffService, readCookie } from "@/lib/staffRuntime";
import { createSupabaseStaffStore } from "@/lib/staffStore";
import { PUBLIC_URL_MESSAGE, publicBaseUrl, requireSupabase } from "@/lib/config";
import { readJson, sameSite, sourceOf } from "@/lib/staffRoutes";
import { getLedger } from "@/lib/payments";
import { getNotifier } from "@/lib/notifyRuntime";
import { mayInvite, removalDecision } from "@/lib/teamRules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO = (status: number, error: string) => Response.json({ error }, { status });

// A church owner manages their own team. The church always comes from the signed-in session, never from the request.
export async function POST(req: Request) {
  if (!sameSite(req)) return NO(403, "Not allowed");
  const body = await readJson(req);
  if (!body) return NO(400, "Bad request");

  let service;
  try {
    service = getStaffService();
  } catch {
    return NO(503, "Email sending is not set up yet.");
  }
  const session = await service.getSession(readCookie(req));
  if (!session) return NO(401, "Please sign in again.");
  const me = session.user;
  if (me.role !== "owner") return NO(403, "Only owners can change the team.");

  const { url, serviceKey } = requireSupabase(process.env);
  const store = createSupabaseStaffStore({ url, serviceKey });
  const church = await getLedger().getChurchById(me.churchId);
  if (!church) return NO(403, "Not allowed");
  const baseUrl = publicBaseUrl(process.env);
  if (!baseUrl) return NO(503, PUBLIC_URL_MESSAGE);
  const audit = getAudit();
  const source = sourceOf(req);
  // The record is written BEFORE the change, and if the audit log is down nothing changes (it fails closed).
  const record = async (action: string, target: string, outcome: "ok" | "denied" = "ok"): Promise<boolean> => {
    try {
      await audit.record({ actor: `staff:${me.id}`, action, target, outcome, sourceKey: source });
      return true;
    } catch {
      return false;
    }
  };
  const AUDIT_DOWN = "The audit log is not available, so nothing was changed. Try again in a minute.";

  try {
    const action = body.action;
    if (action === "invite") {
      const role = ROLES.find((r) => r === body.role) as Role | undefined;
      if (!role) return NO(400, "Choose a role.");
      if (!(await mayInvite(audit, church.id))) return NO(429, "Too many invites today. Try again tomorrow, or ask Maizz.");
      if (!(await record("staff.team_invite", church.id))) return NO(503, AUDIT_DOWN);
      const user = await service.invite({
        churchId: church.id,
        churchName: church.name,
        email: String(body.email ?? ""),
        fullName: String(body.fullName ?? ""),
        role,
        baseUrl,
      });
      return Response.json({ message: `Invite emailed to ${user.email}.` });
    }

    const targetId = typeof body.userId === "string" ? body.userId : "";
    const target = await store.getUser(targetId);
    // Someone else's church, or no such person: the same answer, so nothing leaks.
    if (!target || target.churchId !== church.id) return NO(404, "That person was not found.");
    if (target.id === me.id) return NO(400, "You cannot change your own access.");

    if (action === "resend") {
      if (!(await mayInvite(audit, church.id))) return NO(429, "Too many invites today. Try again tomorrow, or ask Maizz.");
      if (!(await record("staff.team_resend", target.id))) return NO(503, AUDIT_DOWN);
      await service.resendInvite({ userId: target.id, churchName: church.name, baseUrl });
      return Response.json({ message: "A new invite email was sent." });
    }
    if (action === "disable" || action === "enable") {
      if (action === "enable" && target.status !== "disabled") return NO(400, "That person is not removed.");
      if (action === "disable" && target.status === "disabled") return NO(400, "That person is already removed.");
      if (action === "disable" && target.role === "owner") {
        const verdict = removalDecision(await store.listUsers(church.id), target.id);
        if (verdict === "last_other_owner") {
          await record("staff.team_disable_refused", target.id, "denied");
          return NO(400, "A church must keep at least two active owners. To remove this owner, ask Maizz.");
        }
      }
      if (!(await record(`staff.team_${action}`, target.id))) return NO(503, AUDIT_DOWN);
      // A person who never set a password goes back to "invited", never straight to active.
      const next = action === "disable" ? "disabled" : target.passwordHash ? "active" : "invited";
      await store.updateUser(target.id, { status: next });
      if (action === "disable") {
        await store.revokeTokens(target.id, "session");
        await store.revokeTokens(target.id, "code");
      }
      if (action === "disable" && target.role === "owner") {
        await getNotifier().alert("church_owner_removed", "A church owner was removed", [
          `An owner of ${church.name} was removed by another owner of that church.`,
          "If the church did not expect this, suspend the church in the owner dashboard and check the audit log.",
        ], target.id);
      }
      return Response.json({ message: action === "disable" ? "Access removed. They are signed out." : "Access restored." });
    }
    return NO(400, "Unknown action.");
  } catch (err) {
    if (err instanceof StaffError && (err.code === "exists" || err.code === "bad_input")) return NO(400, err.message);
    return NO(502, "Something went wrong. Check that email sending is set up, then try again.");
  }
}
