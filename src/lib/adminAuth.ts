import { createHash, timingSafeEqual } from "node:crypto";
import type { Env } from "./config";

const MIN_TOKEN_LENGTH = 24;

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/**
 * Protects the private setup and test tools.
 * - If SETUP_CHECK_TOKEN is not set (or is too short), the tools are switched off and answer 404.
 * - Otherwise the request must send the same token as "Authorization: Bearer <token>".
 * Returns null when allowed, or a Response to send back.
 */
export function requireAdmin(req: Request, env: Env): Response | null {
  const token = env.SETUP_CHECK_TOKEN?.trim();
  if (!token || token.length < MIN_TOKEN_LENGTH) {
    return new Response("Not found", { status: 404 });
  }
  const header = req.headers.get("authorization") ?? "";
  const sent = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const ok = sent.length > 0 && timingSafeEqual(digest(sent), digest(token));
  if (!ok) {
    return Response.json({ error: "Not allowed" }, { status: 401 });
  }
  return null;
}
