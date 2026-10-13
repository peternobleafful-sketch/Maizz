import { openAdminRoute } from "@/lib/adminAuth";
import { requireSupabase } from "@/lib/config";
import { noActiveOwnerYet } from "@/lib/ownerRuntime";
import { StaffError } from "@/lib/staff";
import { readJson } from "@/lib/staffRoutes";
import { getStaffService } from "@/lib/staffRuntime";
import { createSupabaseStaffStore } from "@/lib/staffStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_OWNERS = 5;


// Private tool (admin key): add a Maizz owner for the owner dashboard, resend their invite, or list the owners.
// Owners have their own sign-in, separate from church staff.
export async function POST(req: Request) {
  const body = (await readJson(req)) ?? {};
  const action = body.action === "invite" || body.action === "resend" || body.action === "list" ? body.action : undefined;

  // In Production this tool works only until the first Maizz owner has set a password (first-owner set-up). After that it is off.
  const denied = await openAdminRoute(req, process.env, `admin.owner_${action ?? "invalid"}`, undefined, {
    allowInProductionWhen: () => noActiveOwnerYet(process.env),
  });
  if (denied) return denied;
  if (!action) return Response.json({ error: "Choose an action." }, { status: 400 });

  try {
    const { url, serviceKey } = requireSupabase(process.env);
    const store = createSupabaseStaffStore({ url, serviceKey, area: "owner" });
    const baseUrl = process.env.MAIZZ_PUBLIC_URL?.trim() || new URL(req.url).origin;
    const owners = await store.listUsers("platform");

    if (action === "list") {
      return Response.json({ people: owners.map((u) => ({ id: u.id, name: u.fullName, email: u.email, role: "owner", status: u.status })) });
    }

    const service = getStaffService(process.env, { area: "owner" });
    if (action === "resend") {
      if (typeof body.userId !== "string") return Response.json({ error: "Choose a person." }, { status: 400 });
      await service.resendInvite({ userId: body.userId, churchName: "Maizz", baseUrl });
      return Response.json({ ok: true, message: "A new invite email was sent." });
    }

    if (owners.length >= MAX_OWNERS) {
      return Response.json({ error: `Maizz can have at most ${MAX_OWNERS} owners. Keep this list short.` }, { status: 400 });
    }
    const user = await service.invite({
      churchId: "platform",
      churchName: "Maizz",
      email: String(body.email ?? ""),
      fullName: String(body.fullName ?? ""),
      role: "owner",
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
