import { getStaffService } from "@/lib/staffRuntime";
import { readJson, sameSite, setupProblem, sourceOf } from "@/lib/staffRoutes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Step one of church sign-in. Wrong email and wrong password look the same on purpose.
export async function POST(req: Request) {
  if (!sameSite(req)) return Response.json({ error: "Not allowed" }, { status: 403 });
  const body = await readJson(req);
  if (!body) return Response.json({ error: "Bad request" }, { status: 400 });
  let service;
  try {
    service = getStaffService();
  } catch (err) {
    return setupProblem(err);
  }
  const r = await service.signIn(body.email, body.password, sourceOf(req));
  if (r.ok) return Response.json({ challenge: r.challenge });
  if (r.reason === "locked") {
    return Response.json({ error: "locked", message: "Too many tries. Wait 15 minutes and try again." }, { status: 429 });
  }
  if (r.reason === "unavailable") {
    return Response.json({ error: "unavailable", message: "We could not send your code. Try again in a minute." }, { status: 503 });
  }
  return Response.json({ error: "wrong", message: "That email or password is not right." }, { status: 401 });
}
