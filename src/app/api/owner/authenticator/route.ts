import QRCode from "qrcode";
import { handleAuthenticator } from "@/lib/ownerAuthenticator";
import { openOwnerRoute } from "@/lib/ownerRequest";
import { readJson, sourceOf } from "@/lib/staffRoutes";
import { getStaffService } from "@/lib/staffRuntime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The owner sets up and manages their authenticator app. Needs the owner sign-in; every call is audited first.
export async function POST(req: Request) {
  const body = await readJson(req);
  const action = typeof body?.action === "string" && ["status", "begin", "confirm", "renew"].includes(body.action) ? body.action : "invalid";
  const opened = await openOwnerRoute(req, `owner.authenticator_${action}`);
  if (opened instanceof Response) return opened;
  let service;
  try {
    service = getStaffService(process.env, { needMail: false, area: "owner" });
  } catch {
    return Response.json({ error: "Sign-in is not available right now." }, { status: 503 });
  }
  const out = await handleAuthenticator({
    service,
    user: opened.user,
    action: body?.action,
    code: body?.code,
    sourceKey: sourceOf(req),
    qr: (uri) => QRCode.toString(uri, { type: "svg", margin: 1, width: 220, color: { dark: "#0a0a0f", light: "#ffffff" } }),
  });
  return Response.json(out.body, { status: out.status, headers: { "Cache-Control": "no-store" } });
}
