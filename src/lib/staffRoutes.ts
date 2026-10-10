import { sourceKeyFor } from "./audit";
import { ConfigError } from "./config";

export async function readJson(req: Request, maxBytes = 4_000): Promise<Record<string, unknown> | null> {
  const text = await req.text();
  if (text.length > maxBytes) return null;
  try {
    const v: unknown = JSON.parse(text);
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function sourceOf(req: Request): string {
  return sourceKeyFor(req, process.env.STAFF_SECRET?.trim() ?? "none");
}

/** Only accept sign-in calls made from our own pages. */
export function sameSite(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(req.url).host || new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}

export function setupProblem(err: unknown): Response {
  const message = err instanceof ConfigError ? err.message : "Sign-in is not available right now.";
  return Response.json({ error: "not_ready", message: err instanceof ConfigError ? "Sign-in is not set up yet." : message }, { status: 503 });
}
