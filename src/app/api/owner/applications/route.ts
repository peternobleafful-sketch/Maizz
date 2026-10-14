import { getAudit } from "@/lib/audit";
import { freeSlug } from "@/lib/churchAdmin";
import { PUBLIC_URL_MESSAGE, publicBaseUrl } from "@/lib/config";
import { logError } from "@/lib/log";
import { getOwnerData } from "@/lib/ownerRuntime";
import { getLedger } from "@/lib/payments";
import { StaffError } from "@/lib/staff";
import { readJson, sameSite, sourceOf } from "@/lib/staffRoutes";
import { getStaffService, OWNER_COOKIE, readCookie } from "@/lib/staffRuntime";


export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO = (status: number, error: string) => Response.json({ error }, { status });

// The Maizz owner accepts or declines a church's application.
// Accepting adds the church as "pending" and emails the contact an invite to be the church's owner on the dashboard.
// The church still cannot take gifts until you set up its payout account and open it under Churches.
export async function POST(req: Request) {
  if (!sameSite(req)) return NO(403, "Not allowed");
  const body = await readJson(req);
  if (!body || typeof body.id !== "string" || (body.action !== "accept" && body.action !== "decline")) return NO(400, "Bad request");

  let session;
  try {
    session = await getStaffService(process.env, { needMail: false, area: "owner" }).getSession(readCookie(req, OWNER_COOKIE));
  } catch {
    return NO(503, "Sign-in is not available right now.");
  }
  if (!session) return NO(401, "Please sign in again.");
  const me = session.user;
  const audit = getAudit();
  const source = sourceOf(req);

  try {
    const data = getOwnerData();
    const app = await data.getApplication(body.id);
    if (!app) return NO(404, "That application was not found.");

    if (body.action === "decline") {
      if (!(await data.claimApplication(app.id, "declined"))) return NO(409, "That application was already dealt with.");
      await audit.record({ actor: `owner:${me.id}`, action: "owner.application_decline", target: app.id, outcome: "ok", sourceKey: source });
      return Response.json({ message: "Application declined. Nothing was sent to them." });
    }

    // Accept. Only one click can win, so a double click cannot make two churches.
    const baseUrl = publicBaseUrl(process.env);
    if (!baseUrl) return NO(503, PUBLIC_URL_MESSAGE);
    const mailer = getStaffService(process.env, { area: "church" });
    if (!(await data.claimApplication(app.id, "accepted"))) return NO(409, "That application was already dealt with.");
    await audit.record({ actor: `owner:${me.id}`, action: "owner.application_accept", target: app.id, outcome: "ok", sourceKey: source });

    const ledger = getLedger();
    let church;
    try {
      const slug = await freeSlug(ledger, app.churchName);
      if (slug === "short" || slug === "crowded") throw new Error("no free web address");
      church = await ledger.createChurch({ slug, name: app.churchName });
      await data.attachChurch(app.id, church.id);
    } catch (err) {
      await data.releaseApplication(app.id).catch(() => undefined);
      logError("owner.application_church_failed", { reason: err instanceof Error ? err.message : "unknown" });
      return NO(502, "Could not add the church. The application is back in the list. Try again, or add it under Churches.");
    }

    try {
      await mailer.invite({
        churchId: church.id,
        churchName: church.name,
        email: app.contactEmail,
        fullName: app.contactName,
        role: "owner",
        baseUrl,
      });
    } catch (err) {
      const why = err instanceof StaffError && err.code === "exists" ? "That email already has a Maizz sign-in." : "The invite email did not send.";
      return Response.json({
        message: `${church.name} was added as pending. ${why} You can send the invite again under Churches, Manage, People.`,
        slug: church.slug,
      });
    }
    return Response.json({
      message: `${church.name} was added as pending and ${app.contactName} was emailed an invite. Next: under Churches, set up the payout account and open it.`,
      slug: church.slug,
    });
  } catch (err) {
    logError("owner.application_failed", { reason: err instanceof Error ? err.message : "unknown" });
    return NO(502, "Something went wrong. Try again in a minute.");
  }
}
