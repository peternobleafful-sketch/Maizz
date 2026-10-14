import { createHmac, timingSafeEqual } from "node:crypto";
import type { Env } from "./config";

// The Church Manager link. Church Manager (WordPress) and Maizz share one secret key PER CHURCH.
// The key is never stored: it is made from MEMBER_LINK_MASTER_KEY, the church's id and the church's key version,
// so it can be shown to the owner again, and replaced by raising the version.
//
// Two signed things:
//   * the "Give now" link  -> /give/<church>?m=<member>&e=<expiry>&s=<signature>   (tags a gift with that member)
//   * the history request  -> POST /api/church-manager/history                    (asks for that member's paid gifts)
// A member reference is an opaque id chosen by Church Manager: no name, phone or email.

export const MEMBER_REF = /^[A-Za-z0-9_-]{1,64}$/;
/** A "Give now" link may be valid for at most this long, whatever expiry it carries. */
export const LINK_MAX_SECONDS = 6 * 60 * 60;
/** A history request must be this fresh (seconds). */
export const HISTORY_MAX_AGE_SECONDS = 5 * 60;

/** The master secret, or null when it is not set (then the whole feature is off). */
export function memberMasterKey(env: Env): string | null {
  const v = env.MEMBER_LINK_MASTER_KEY?.trim();
  return v && v.length >= 32 ? v : null;
}

/** The church's own signing key (64 hex characters). */
export function churchMemberKey(master: string, churchId: string, version: number): string {
  return createHmac("sha256", master).update(`maizz-member-link-v1:${churchId}:${version}`).digest("hex");
}

const sign = (key: string, text: string) => createHmac("sha256", key).update(text).digest("hex");

function sameHex(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function signMemberLink(key: string, slug: string, member: string, expiresAtSeconds: number): string {
  return sign(key, `link.${slug}.${member}.${expiresAtSeconds}`);
}

export interface MemberLinkParts {
  member: unknown;
  expires: unknown;
  signature: unknown;
}

/** The member reference when the link is genuine, in date and not too far ahead; otherwise null. */
export function verifyMemberLink(key: string, slug: string, parts: MemberLinkParts, nowMs: number): string | null {
  const { member, signature } = parts;
  const exp = typeof parts.expires === "string" ? Number(parts.expires) : parts.expires;
  if (typeof member !== "string" || !MEMBER_REF.test(member)) return null;
  if (typeof signature !== "string" || !/^[0-9a-f]{64}$/.test(signature)) return null;
  if (typeof exp !== "number" || !Number.isSafeInteger(exp)) return null;
  const now = Math.floor(nowMs / 1000);
  if (exp <= now || exp > now + LINK_MAX_SECONDS) return null;
  return sameHex(signature, signMemberLink(key, slug, member, exp)) ? member : null;
}

export function signHistoryRequest(key: string, slug: string, member: string, timestampSeconds: number): string {
  return sign(key, `history.${slug}.${member}.${timestampSeconds}`);
}

export function verifyHistoryRequest(
  key: string,
  slug: string,
  parts: { member: unknown; timestamp: unknown; signature: unknown },
  nowMs: number,
): string | null {
  const { member, signature } = parts;
  const ts = typeof parts.timestamp === "string" ? Number(parts.timestamp) : parts.timestamp;
  if (typeof member !== "string" || !MEMBER_REF.test(member)) return null;
  if (typeof signature !== "string" || !/^[0-9a-f]{64}$/.test(signature)) return null;
  if (typeof ts !== "number" || !Number.isSafeInteger(ts)) return null;
  if (Math.abs(Math.floor(nowMs / 1000) - ts) > HISTORY_MAX_AGE_SECONDS) return null;
  return sameHex(signature, signHistoryRequest(key, slug, member, ts)) ? member : null;
}
