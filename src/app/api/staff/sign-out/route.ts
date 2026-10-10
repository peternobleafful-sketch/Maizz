import { cookieHeader, getStaffService, readCookie } from "@/lib/staffRuntime";
import { sameSite } from "@/lib/staffRoutes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!sameSite(req)) return Response.json({ error: "Not allowed" }, { status: 403 });
  try {
    await getStaffService(process.env, { needMail: false }).signOut(readCookie(req));
  } catch {
    // The cookie is cleared either way.
  }
  return Response.json({ ok: true }, { headers: { "Set-Cookie": cookieHeader("", 0) } });
}
