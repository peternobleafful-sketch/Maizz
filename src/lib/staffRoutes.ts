import { sourceKeyFor } from "./audit";
import { ConfigError } from "./config";

/**
 * Reads a request body but never more than maxBytes (plus one chunk). Returns null when the body is bigger,
 * decided from the declared size first and then from what actually arrives, so nobody can make the server read a huge body.
 */
export async function readCappedText(req: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function readJson(req: Request, maxBytes = 4_000): Promise<Record<string, unknown> | null> {
  const text = await readCappedText(req, maxBytes);
  if (text === null) return null;
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
