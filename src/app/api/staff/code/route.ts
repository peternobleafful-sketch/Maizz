import { cookieHeader, getStaffService } from "@/lib/staffRuntime";
import { STAFF_LIMITS } from "@/lib/staff";
import { readJson, sameSite, setupProblem, sourceOf } from "@/lib/staffRoutes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Step two of church sign-in: the six-digit code from the email.
export async function POST(req: Request) {
  if (!sameSite(req)) return Response.json({ error: "Not allowed" }, { status: 403 });
  const body = await readJson(req);
  if (!body) return Response.json({ error: "Bad request" }, { status: 400 });
  let service;
  try {
    service = getStaffService(process.env, { needMail: false });
  } catch (err) {
    return setupProblem(err);
  }
  const r = await service.verifyCode(body.challenge, body.code, sourceOf(req));
  if (r.ok) {
    return Response.json(
      { ok: true },
      { headers: { "Set-Cookie": cookieHeader(r.sessionToken, STAFF_LIMITS.sessionHours * 3600), "Cache-Control": "no-store" } },
    );
  }
  if (r.reason === "locked") {
    return Response.json({ error: "locked", message: "Too many tries. Wait 15 minutes and try again." }, { status: 429 });
  }
  if (r.reason === "expired") {
    return Response.json({ error: "expired", message: "That code has expired. Go back and sign in again for a new one." }, { status: 410 });
  }
  if (r.reason === "unavailable") {
    return Response.json({ error: "unavailable", message: "Something went wrong. Try again in a minute." }, { status: 503 });
  }
  return Response.json({ error: "wrong", message: "That code is not right. Check the email and try again." }, { status: 401 });
}
