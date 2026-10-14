import { getAudit } from "@/lib/audit";
import { logError } from "@/lib/log";
import { getNotifier } from "@/lib/notifyRuntime";
import { getOwnerData } from "@/lib/ownerRuntime";
import { normaliseGhanaPhone } from "@/lib/phone";
import { normaliseEmail } from "@/lib/staff";
import { readJson, sameSite, sourceOf } from "@/lib/staffRoutes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMIT_PER_DAY = 3;
const MAX_WAITING = 100;

const reply = (status: number, message: string) => Response.json({ error: message }, { status });
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max + 1) : "");

// The public "register your church" form. It only saves an application for the Maizz owner to review.
// Nothing is created for the church yet, and nothing is sent to the person except a confirmation on the page.
export async function POST(req: Request) {
  if (!sameSite(req)) return reply(403, "Not allowed");
  const body = await readJson(req, 6_000);
  if (!body) return reply(400, "Please check the form and try again.");

  // A hidden box that people never see. A robot fills it in. It gets a normal-looking answer and nothing is saved.
  if (typeof body.website === "string" && body.website.trim() !== "") return Response.json({ ok: true });

  const churchName = clean(body.churchName, 100);
  const town = clean(body.town, 100);
  const contactName = clean(body.contactName, 120);
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 501) : "";
  const email = normaliseEmail(body.contactEmail);
  const phone = typeof body.contactPhone === "string" ? normaliseGhanaPhone(body.contactPhone) : null;

  if (churchName.length < 2 || churchName.length > 100) return reply(400, "Enter your church's name.");
  if (town.length > 100) return reply(400, "Keep the town or city short.");
  if (contactName.length < 1 || contactName.length > 120) return reply(400, "Enter your name.");
  if (!email) return reply(400, "Enter a valid email address.");
  if (!phone) return reply(400, "Enter a Ghana phone number, like 055 123 4987.");
  if (note.length > 500) return reply(400, "Keep the note under 500 characters.");

  try {
    const audit = getAudit();
    const source = sourceOf(req);
    // Counted and recorded in one atomic step, so simultaneous requests cannot slip past the daily limit.
    if ((await audit.hit({ action: "church.apply", sourceKey: source, minutes: 24 * 60 })) > LIMIT_PER_DAY) {
      return reply(429, "Too many applications from this connection today. Please try again tomorrow.");
    }
    const data = getOwnerData();
    // Real churches are never turned away. If a lot are waiting, the owner is told (once an hour) instead.
    const waiting = (await data.listApplications()).filter((a) => a.status === "new").length;
    await data.createApplication({ churchName, town, contactName, contactEmail: email, contactPhone: phone, note });
    if (waiting + 1 >= MAX_WAITING) {
      await getNotifier()
        .alert("applications_backlog", "Many church applications are waiting", [
          `${waiting + 1} applications are waiting for you. Real churches are still being accepted.`,
          "If many look like junk, someone may be filling the form. Decline them in the owner dashboard and consider the bot check.",
        ])
        .catch(() => undefined);
    }
    await getNotifier().alert("church_application", "A church applied to join Maizz", [
      "A new church application is waiting for you.",
      "Open your owner dashboard and look under Applications.",
    ]);
    return Response.json({ ok: true });
  } catch (err) {
    logError("church.apply_failed", { reason: err instanceof Error ? err.message : "unknown" });
    return reply(502, "Something went wrong. Please try again in a few minutes.");
  }
}
