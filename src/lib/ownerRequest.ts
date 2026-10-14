import { getAudit } from "./audit";
import { allowedBeforeApp } from "./ownerRules";
import type { StaffUser } from "./staff";
import { sameSite, sourceOf } from "./staffRoutes";
import { getStaffService, OWNER_COOKIE, readCookie } from "./staffRuntime";

/**
 * For the owner's own API routes. Accepts only calls from our own pages with a valid owner sign-in
 * (a church sign-in never counts), and writes the audit record before the caller does anything.
 * Returns the signed-in owner, or a Response to send back.
 */
export async function openOwnerRoute(req: Request, action: string): Promise<{ user: StaffUser } | Response> {
  if (!sameSite(req)) return Response.json({ error: "Not allowed" }, { status: 403 });
  let user: StaffUser | null;
  try {
    // With a live key an owner without the authenticator app gets a session here only for the app's own set-up calls.
    user = (await getStaffService(process.env, { needMail: false, area: "owner" }).getSession(readCookie(req, OWNER_COOKIE), { setup: allowedBeforeApp(action) }))?.user ?? null;
  } catch {
    return Response.json({ error: "Sign-in is not available right now." }, { status: 503 });
  }
  if (!user) return Response.json({ error: "Please sign in again." }, { status: 401 });
  try {
    await getAudit().record({ actor: `owner:${user.id}`, action, outcome: "ok", sourceKey: sourceOf(req) });
  } catch {
    return Response.json({ error: "The audit log is not available, so nothing was done. Try again in a minute." }, { status: 503 });
  }
  return { user };
}
