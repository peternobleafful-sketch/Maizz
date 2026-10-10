import { getStaffService } from "@/lib/staffRuntime";
import { readJson, sameSite, setupProblem } from "@/lib/staffRoutes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!sameSite(req)) return Response.json({ error: "Not allowed" }, { status: 403 });
  const body = await readJson(req);
  if (!body || typeof body.token !== "string" || typeof body.password !== "string" || body.token.length > 100) {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  let service;
  try {
    service = getStaffService(process.env, { needMail: false });
  } catch (err) {
    return setupProblem(err);
  }
  try {
    const r = await service.resetPassword(body.token, body.password);
    if (r.ok) return Response.json({ ok: true });
    return Response.json({ error: r.reason, message: r.message }, { status: r.reason === "weak" ? 400 : 410 });
  } catch {
    return Response.json({ error: "unavailable", message: "Something went wrong. Try again in a minute." }, { status: 503 });
  }
}
