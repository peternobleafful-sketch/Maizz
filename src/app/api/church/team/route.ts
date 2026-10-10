import { getAudit } from "@/lib/audit";
import { ROLES, StaffError, type Role } from "@/lib/staff";
import { getStaffService, readCookie } from "@/lib/staffRuntime";
import { createSupabaseStaffStore } from "@/lib/staffStore";
import { requireSupabase } from "@/lib/config";
import { readJson, sameSite, sourceOf } from "@/lib/staffRoutes";
import { getLedger } from "@/lib/payments";

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
  const church = (await getLedger().listChurches()).find((c) => c.id === me.churchId);
  if (!church) return NO(403, "Not allowed");
  const baseUrl = process.env.MAIZZ_PUBLIC_URL?.trim() || new URL(req.url).origin;
  const audit = getAudit();
  const source = sourceOf(req);

  try {
    const action = body.action;
    if (action === "invite") {
      const role = ROLES.find((r) => r === body.role) as Role | undefined;
      if (!role) return NO(400, "Choose a role.");
      const user = await service.invite({
        churchId: church.id,
        churchName: church.name,
        email: String(body.email ?? ""),
        fullName: String(body.fullName ?? ""),
        role,
        baseUrl,
      });
      await audit.record({ actor: `staff:${me.id}`, action: "staff.team_invite", target: user.id, outcome: "ok", sourceKey: source });
      return Response.json({ message: `Invite emailed to ${user.email}.` });
    }

    const targetId = typeof body.userId === "string" ? body.userId : "";
    const target = await store.getUser(targetId);
    // Someone else's church, or no such person: the same answer, so nothing leaks.
    if (!target || target.churchId !== church.id) return NO(404, "That person was not found.");
    if (target.id === me.id) return NO(400, "You cannot change your own access.");

    if (action === "resend") {
      await service.resendInvite({ userId: target.id, churchName: church.name, baseUrl });
      await audit.record({ actor: `staff:${me.id}`, action: "staff.team_resend", target: target.id, outcome: "ok", sourceKey: source });
      return Response.json({ message: "A new invite email was sent." });
    }
    if (action === "disable" || action === "enable") {
      if (action === "enable" && target.status !== "disabled") return NO(400, "That person is not removed.");
      if (action === "disable" && target.status === "disabled") return NO(400, "That person is already removed.");
      // A person who never set a password goes back to "invited", never straight to active.
      const next = action === "disable" ? "disabled" : target.passwordHash ? "active" : "invited";
      await store.updateUser(target.id, { status: next, failedAttempts: 0, lockedUntil: null });
      if (action === "disable") {
        await store.revokeTokens(target.id, "session");
        await store.revokeTokens(target.id, "code");
      }
      await audit.record({ actor: `staff:${me.id}`, action: `staff.team_${action}`, target: target.id, outcome: "ok", sourceKey: source });
      return Response.json({ message: action === "disable" ? "Access removed. They are signed out." : "Access restored." });
    }
    return NO(400, "Unknown action.");
  } catch (err) {
    if (err instanceof StaffError && (err.code === "exists" || err.code === "bad_input")) return NO(400, err.message);
    return NO(502, "Something went wrong. Check that email sending is set up, then try again.");
  }
}
