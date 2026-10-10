import { getStaffService } from "@/lib/staffRuntime";
import { readJson, sameSite, sourceOf } from "@/lib/staffRoutes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Forgot password". The answer is always the same, whether or not the email has an account.
export async function POST(req: Request) {
  if (!sameSite(req)) return Response.json({ error: "Not allowed" }, { status: 403 });
  const body = await readJson(req);
  if (!body) return Response.json({ error: "Bad request" }, { status: 400 });
  try {
    const baseUrl = process.env.MAIZZ_PUBLIC_URL?.trim() || new URL(req.url).origin;
    await getStaffService().requestReset(body.email, baseUrl, sourceOf(req));
  } catch {
    // Same answer either way.
  }
  return Response.json({ ok: true });
}
