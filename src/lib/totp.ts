import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

// Authenticator-app codes (RFC 6238: 6 digits, 30 seconds, HMAC-SHA1, as every authenticator app expects).
// The shared secret is kept encrypted in the database. Recovery codes are kept only as keyed hashes.

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_STEP_SECONDS = 30;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("bad base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new random secret (160 bits), as the text an authenticator app accepts. */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpStep(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
}

export function totpCode(secretBase32: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", base32Decode(secretBase32)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 15;
  const bin = ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(bin % 1_000_000).padStart(6, "0");
}

/**
 * Returns the step the code belongs to, or null. One step either side of now is accepted (clock drift).
 * `lastStep` is the newest step already used: a code from that step or earlier is refused, so each code works once.
 */
export function verifyTotp(secretBase32: string, codeRaw: unknown, nowMs: number, lastStep = 0): number | null {
  const code = typeof codeRaw === "string" ? codeRaw.replace(/\s/g, "") : "";
  if (!/^\d{6}$/.test(code)) return null;
  const current = totpStep(nowMs);
  let found: number | null = null;
  for (const step of [current - 1, current, current + 1]) {
    // Every step is compared (no early exit) so the time taken does not show which one matched.
    const ok = timingSafeEqual(Buffer.from(totpCode(secretBase32, step)), Buffer.from(code));
    if (ok && step > lastStep) found = step;
  }
  return found;
}

export function otpauthUri(email: string, secretBase32: string, issuer = "Maizz"): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${TOTP_STEP_SECONDS}`;
}

// ---- secret at rest: AES-256-GCM, key derived from STAFF_SECRET ----

function key(pepper: string): Buffer {
  return createHmac("sha256", pepper).update("maizz-totp-secret-v1").digest();
}

export function encryptSecret(secretBase32: string, pepper: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(pepper), iv);
  const ct = Buffer.concat([c.update(secretBase32, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString("base64url")).join(".");
}

export function decryptSecret(stored: string, pepper: string): string | null {
  try {
    const [iv, tag, ct] = stored.split(".").map((p) => Buffer.from(p, "base64url"));
    if (!iv || !tag || !ct || iv.length !== 12 || tag.length !== 16) return null;
    const d = createDecipheriv("aes-256-gcm", key(pepper), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// ---- recovery codes: for a lost phone. Eight of them, each works once. ----

const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

export function newRecoveryCodes(count = 8): string[] {
  return Array.from({ length: count }, () => {
    const pick = () => Array.from({ length: 4 }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]).join("");
    return `${pick()}-${pick()}`;
  });
}

/** Accepts the code however it is typed (lower case, no dash, spaces). Null if it cannot be a recovery code. */
export function normaliseRecoveryCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const c = raw.replace(/[\s-]/g, "").toUpperCase();
  return /^[A-HJ-NP-Z2-9]{8}$/.test(c) ? `${c.slice(0, 4)}-${c.slice(4)}` : null;
}

export function hashRecoveryCode(code: string, pepper: string): string {
  return createHmac("sha256", pepper).update(`recovery:${code}`).digest("hex");
}
