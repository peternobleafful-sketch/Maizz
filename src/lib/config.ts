// Reads Maizz settings and refuses unsafe combinations.
// Rule: TEST MODE ONLY until the company, bank account and legal checks are confirmed.

export type Env = Record<string, string | undefined>;

export type PaystackKeyKind = "test" | "live" | "public" | "unknown" | "missing";

export class ConfigError extends Error {}

export function classifyPaystackKey(key: string | undefined): PaystackKeyKind {
  const k = key?.trim();
  if (!k) return "missing";
  if (k.startsWith("sk_test_")) return "test";
  if (k.startsWith("sk_live_")) return "live";
  if (k.startsWith("pk_")) return "public";
  return "unknown";
}

/** Returns the Paystack secret key, but only if it is a test key (or live has been deliberately allowed). */
export function requirePaystackSecret(env: Env): string {
  const key = env.PAYSTACK_SECRET_KEY?.trim() ?? "";
  switch (classifyPaystackKey(key)) {
    case "test":
      return key;
    case "live":
      if (env.MAIZZ_ALLOW_LIVE === "yes") return key;
      throw new ConfigError(
        "A live Paystack key is set, but Maizz is in test mode only. Replace it with the test key.",
      );
    case "public":
      throw new ConfigError("PAYSTACK_SECRET_KEY holds a public key. Use the secret key (it starts with sk_test_).");
    case "missing":
      throw new ConfigError("PAYSTACK_SECRET_KEY is not set.");
    default:
      throw new ConfigError("PAYSTACK_SECRET_KEY does not look like a Paystack secret key.");
  }
}

export function requireSupabase(env: Env): { url: string; serviceKey: string } {
  const url = env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url) throw new ConfigError("SUPABASE_URL is not set.");
  if (!serviceKey) throw new ConfigError("SUPABASE_SERVICE_ROLE_KEY is not set.");
  return { url, serviceKey };
}
