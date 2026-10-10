import { createHmac } from "node:crypto";
import { requireSupabase, type Env } from "./config";

// The permanent record of admin actions, refused attempts and odd events.
// It lives in the database (audit_log, append-only), so it outlasts Vercel's short-lived logs.

export type AuditOutcome = "ok" | "denied" | "failed";

export interface AuditEntry {
  actor: string;
  action: string;
  target?: string;
  outcome?: AuditOutcome;
  sourceKey?: string;
  detail?: Record<string, unknown>;
}

export interface AuditLog {
  record(entry: AuditEntry): Promise<void>;
  /** How many records with this action in the last N minutes (optionally from one source). */
  countSince(action: string, minutes: number, sourceKey?: string): Promise<number>;
}

export class AuditError extends Error {}

// Keys that could carry a secret or personal detail are dropped before anything is written.
const SENSITIVE_KEY = /token|secret|key|authorization|password|passwd|phone|msisdn|email|name|pin|otp|card/i;
// Values that look like keys are dropped too, whatever the field is called.
const SECRET_VALUE = /^(sk_|pk_|sb_secret_|sb_publishable_|eyJ|Bearer )/;

type Simple = string | number | boolean | null;

function simple(v: unknown): Simple | undefined {
  if (v === null || typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") return SECRET_VALUE.test(v) ? undefined : v.slice(0, 200);
  return undefined;
}

/** Keeps only plain, harmless fields. Never throws. */
export function scrubDetail(detail: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!detail) return out;
  for (const [key, value] of Object.entries(detail)) {
    if (SENSITIVE_KEY.test(key)) continue;
    if (Array.isArray(value)) {
      const items = value.slice(0, 20).map(simple).filter((x): x is Simple => x !== undefined);
      out[key] = items;
      continue;
    }
    const s = simple(value);
    if (s !== undefined) out[key] = s;
  }
  return out;
}

/** A one-way fingerprint of the caller's address. The address itself is never stored. */
export function sourceKeyFor(req: Request, secret: string): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || req.headers.get("x-real-ip") || "unknown";
  return createHmac("sha256", secret).update(ip).digest("hex").slice(0, 32);
}

export function createSupabaseAudit(opts: { url: string; serviceKey: string; fetchFn?: typeof fetch }): AuditLog {
  const base = `${opts.url.replace(/\/+$/, "")}/rest/v1/audit_log`;
  const fetchFn = opts.fetchFn ?? fetch;
  const headers: Record<string, string> = { apikey: opts.serviceKey, "Content-Type": "application/json" };
  if (opts.serviceKey.startsWith("eyJ")) headers.Authorization = `Bearer ${opts.serviceKey}`;

  async function send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetchFn(url, { ...init, signal: AbortSignal.timeout(10_000) });
    } catch {
      throw new AuditError("Could not reach the audit log");
    }
  }

  return {
    async record(entry) {
      const res = await send(base, {
        method: "POST",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify({
          actor: entry.actor,
          action: entry.action,
          target: entry.target ?? null,
          outcome: entry.outcome ?? "ok",
          source_key: entry.sourceKey ?? null,
          detail: scrubDetail(entry.detail),
        }),
      });
      if (res.status !== 201) throw new AuditError(`Audit log refused the record (${res.status})`);
    },

    async countSince(action, minutes, sourceKey) {
      const since = new Date(Date.now() - minutes * 60_000).toISOString();
      let url = `${base}?action=eq.${encodeURIComponent(action)}&at=gte.${encodeURIComponent(since)}&select=id&limit=1`;
      if (sourceKey) url += `&source_key=eq.${encodeURIComponent(sourceKey)}`;
      const res = await send(url, { method: "GET", headers: { ...headers, Prefer: "count=exact" } });
      if (!res.ok) throw new AuditError(`Audit log refused the count (${res.status})`);
      const total = res.headers.get("content-range")?.split("/")[1];
      const n = total === undefined ? NaN : Number(total);
      if (!Number.isSafeInteger(n) || n < 0) throw new AuditError("Audit log gave an unreadable count");
      return n;
    },
  };
}

export function getAudit(env: Env = process.env): AuditLog {
  const { url, serviceKey } = requireSupabase(env);
  return createSupabaseAudit({ url, serviceKey });
}
