import { classifyPaystackKey, type Env } from "./config";

// Tests each Maizz setting and reports pass or fix. It never returns any key or secret value.

export interface CheckResult {
  id: string;
  label: string;
  ok: boolean;
  hint: string;
}

const LEDGER_OBJECTS = ["churches", "givers", "gifts", "gift_events", "gift_status", "church_totals"] as const;

function jwtRole(key: string): string | null {
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload: unknown = JSON.parse(Buffer.from(parts[1] ?? "", "base64url").toString("utf8"));
    if (typeof payload === "object" && payload !== null && "role" in payload) {
      const role = (payload as { role: unknown }).role;
      return typeof role === "string" ? role : null;
    }
  } catch {
    // not a JWT
  }
  return null;
}

type Fetch = typeof fetch;

async function status(fetchFn: Fetch, url: string, headers: Record<string, string>): Promise<number | null> {
  try {
    const res = await fetchFn(url, { headers, signal: AbortSignal.timeout(10_000) });
    return res.status;
  } catch {
    return null;
  }
}

export async function runSetupChecks(env: Env, fetchFn: Fetch = fetch): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const add = (id: string, label: string, ok: boolean, hint: string) => results.push({ id, label, ok, hint });

  // 1. Paystack key kind
  const pk = env.PAYSTACK_SECRET_KEY?.trim();
  const kind = classifyPaystackKey(pk);
  const kindHints: Record<string, string> = {
    test: "It is a test key. Good.",
    live: "This is a LIVE key. Maizz is test mode only. In Paystack switch to Test mode, copy the Test Secret Key, and replace it in Vercel.",
    public: "This is a public key. Use the Secret key instead (it starts with sk_test_).",
    unknown: "This does not look like a Paystack secret key. Copy the Test Secret Key again (it starts with sk_test_).",
    missing: "PAYSTACK_SECRET_KEY is not set in Vercel for Production.",
  };
  add("paystack_key", "Paystack key is a test key", kind === "test", kindHints[kind] ?? "");

  // 2. Paystack accepts the key
  if (kind === "test") {
    const s = await status(fetchFn, "https://api.paystack.co/balance", { Authorization: `Bearer ${pk}` });
    add(
      "paystack_reach",
      "Paystack accepts the key",
      s === 200,
      s === 200
        ? "Paystack accepted the key."
        : s === 401
          ? "Paystack rejected the key. Copy the Test Secret Key again, with no spaces."
          : "Could not reach Paystack just now. Try again in a minute.",
    );
  } else {
    add("paystack_reach", "Paystack accepts the key", false, "Fix the key above first.");
  }

  // 3. Supabase address
  const rawUrl = env.SUPABASE_URL?.trim();
  const urlOk = !!rawUrl && /^https:\/\/[a-z0-9]{8,}\.supabase\.co$/.test(rawUrl);
  add(
    "supabase_url",
    "Supabase address looks right",
    urlOk,
    urlOk
      ? "The address has the right shape."
      : !rawUrl
        ? "SUPABASE_URL is not set in Vercel for Production."
        : "It should look like https://yourprojectid.supabase.co with nothing after .co (no slash, no /rest/v1).",
  );

  // 4. Supabase key kind
  const sk = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  let keyOk = false;
  let keyHint = "SUPABASE_SERVICE_ROLE_KEY is not set in Vercel for Production.";
  if (sk) {
    if (sk.startsWith("sb_secret_")) {
      keyOk = true;
      keyHint = "It is a secret key. Good.";
    } else if (sk.startsWith("sb_publishable_")) {
      keyHint = "This is the publishable key. Use the secret key (or the legacy service_role key).";
    } else {
      const role = jwtRole(sk);
      if (role === "service_role") {
        keyOk = true;
        keyHint = "It is the service_role key. Good.";
      } else if (role === "anon") {
        keyHint = "This is the anon key. Use the service_role key (or the secret key) instead.";
      } else {
        keyHint = "This does not look like a Supabase secret key. Copy it again from Project Settings, API Keys.";
      }
    }
  }
  add("supabase_key", "Supabase key is the secret one", keyOk, keyHint);

  // 5. Ledger reachable and installed, 6. refuses a request with no key
  if (urlOk && keyOk && rawUrl && sk) {
    const headers: Record<string, string> = { apikey: sk };
    if (sk.startsWith("eyJ")) headers.Authorization = `Bearer ${sk}`;

    const codes = await Promise.all(
      LEDGER_OBJECTS.map((name) => status(fetchFn, `${rawUrl}/rest/v1/${name}?select=*&limit=0`, headers)),
    );
    const missing = LEDGER_OBJECTS.filter((_, i) => codes[i] === 404);
    const rejected = codes.some((c) => c === 401 || c === 403);
    const unreachable = codes.some((c) => c === null);
    const allOk = codes.every((c) => c === 200);
    add(
      "ledger",
      "Ledger from step 2 is installed and reachable",
      allOk,
      allOk
        ? "All ledger tables and views were found."
        : rejected
          ? "Supabase rejected the key. Copy the secret key again, with no spaces."
          : missing.length > 0
            ? `Not found: ${missing.join(", ")}. Run the 0001_ledger.sql file in the Supabase SQL Editor.`
            : unreachable
              ? "Could not reach Supabase just now. Try again in a minute."
              : "Supabase gave an unexpected answer. Tell Claude.",
    );

    const anonCode = await status(fetchFn, `${rawUrl}/rest/v1/gifts?select=*&limit=0`, {});
    add(
      "locked",
      "Ledger refuses requests with no key",
      anonCode === 401 || anonCode === 403,
      anonCode === 401 || anonCode === 403
        ? "A request with no key was refused. Good."
        : "A request with no key was not refused. Tell Claude straight away.",
    );
  } else {
    add("ledger", "Ledger from step 2 is installed and reachable", false, "Fix the Supabase settings above first.");
    add("locked", "Ledger refuses requests with no key", false, "Fix the Supabase settings above first.");
  }

  // 7. Test mode guard
  add(
    "guard",
    "Live payments are switched off",
    env.MAIZZ_ALLOW_LIVE !== "yes",
    env.MAIZZ_ALLOW_LIVE === "yes"
      ? "MAIZZ_ALLOW_LIVE is set to yes. Remove it until the company and legal checks are done."
      : "Maizz will refuse live keys. Good.",
  );

  return results;
}
