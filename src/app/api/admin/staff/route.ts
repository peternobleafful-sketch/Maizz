import { openAdminRoute } from "@/lib/adminAuth";
import { ROLES, StaffError, type Role } from "@/lib/staff";
import { getStaffService } from "@/lib/staffRuntime";
import { createSupabaseStaffStore } from "@/lib/staffStore";
import { requireSupabase } from "@/lib/config";
import { getLedger } from "@/lib/payments";
import { readJson } from "@/lib/staffRoutes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Private tool: add a person to a church (they get an email to choose a password), resend an invite, or list a church's team.
export async function POST(req: Request) {
  const body = (await readJson(req)) ?? {};
  const action = body.action === "invite" || body.action === "resend" || body.action === "list" ? body.action : undefined;
  const slug = typeof body.slug === "string" && /^[a-z0-9-]{1,80}$/.test(body.slug) ? body.slug : undefined;

  const denied = await openAdminRoute(req, process.env, `admin.staff_${action ?? "invalid"}`, slug);
  if (denied) return denied;
  if (!action || !slug) return Response.json({ error: "Choose an action and a church." }, { status: 400 });

  try {
    const church = await getLedger().findChurch(slug);
    if (!church) return Response.json({ error: "That church was not found." }, { status: 404 });
    const baseUrl = process.env.MAIZZ_PUBLIC_URL?.trim() || new URL(req.url).origin;

    if (action === "list") {
      const { url, serviceKey } = requireSupabase(process.env);
      const users = await createSupabaseStaffStore({ url, serviceKey }).listUsers(church.id);
      return Response.json({
        people: users.map((u) => ({ id: u.id, name: u.fullName, email: u.email, role: u.role, status: u.status })),
      });
    }

    const service = getStaffService();
    if (action === "resend") {
      if (typeof body.userId !== "string") return Response.json({ error: "Choose a person." }, { status: 400 });
      await service.resendInvite({ userId: body.userId, churchName: church.name, baseUrl });
      return Response.json({ ok: true, message: "A new invite email was sent." });
    }

    const role = ROLES.find((r) => r === body.role) as Role | undefined;
    if (!role) return Response.json({ error: "Choose a role: owner, finance or viewer." }, { status: 400 });
    const user = await service.invite({
      churchId: church.id,
      churchName: church.name,
      email: String(body.email ?? ""),
      fullName: String(body.fullName ?? ""),
      role,
      baseUrl,
    });
    return Response.json({ ok: true, message: `Invite emailed to ${user.email}.` });
  } catch (err) {
    if (err instanceof StaffError && (err.code === "exists" || err.code === "bad_input")) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    return Response.json({ error: "Something went wrong. Check that email sending is set up (see the Vercel logs)." }, { status: 502 });
  }
}
