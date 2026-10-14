import { createHmac } from "node:crypto";
import type { Env } from "./config";

// Fingerprints used to count attempts. A raw phone number or address is never stored: only a keyed one-way fingerprint.

/**
 * The secret behind the fingerprints. RATE_LIMIT_SECRET (32+ characters) is the proper one.
 * Until it is set, a separate key is derived from another long secret so nothing breaks (the setup check shows FIX).
 */
export function rateSecret(env: Env): string {
  const own = env.RATE_LIMIT_SECRET?.trim();
  if (own && own.length >= 32) return own;
  const fallback = [env.STAFF_SECRET, env.SETUP_CHECK_TOKEN, env.SUPABASE_SERVICE_ROLE_KEY].map((v) => v?.trim()).find((v) => v && v.length >= 24);
  if (!fallback) throw new Error("RATE_LIMIT_SECRET is not set");
  return createHmac("sha256", fallback).update("maizz-rate-limit-v1").digest("hex");
}

/** A one-way fingerprint of a phone number, 32 characters. */
export function phoneKey(phone: string, env: Env): string {
  return createHmac("sha256", rateSecret(env)).update(`phone:${phone}`).digest("hex").slice(0, 32);
}
