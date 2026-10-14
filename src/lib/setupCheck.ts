import { classifyPaystackKey, publicBaseUrl, type Env } from "./config";

// Tests each Maizz setting and reports pass or fix. It never returns any key or secret value.

export interface CheckResult {
  id: string;
  label: string;
  ok: boolean;
  hint: string;
}

const LEDGER_OBJECTS = ["churches", "givers", "gifts", "gift_events", "gift_status", "church_totals", "audit_log"] as const;

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
      "Ledger and audit log are installed and reachable",
      allOk,
      allOk
        ? "All ledger tables, views and the audit log were found."
        : rejected
          ? "Supabase rejected the key. Copy the secret key again, with no spaces."
          : missing.length > 0
            ? `Not found: ${missing.join(", ")}. Run the missing SQL file (0001_ledger.sql, then 0002_audit.sql) in the Supabase SQL Editor.`
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

    // 0005 adds church status and payout columns. The giving page reads them, so a missing file would break giving.
    const churchCols = await status(fetchFn, `${rawUrl}/rest/v1/churches?select=status,provider_subaccount_code&limit=0`, headers);
    add(
      "church_accounts",
      "Church accounts are installed",
      churchCols === 200,
      churchCols === 200
        ? "Church status and payout columns were found."
        : churchCols === 400
          ? "Not found. Run 0003, 0004 and 0005 (the files in supabase/migrations) in the Supabase SQL Editor, in that order."
          : "Could not check just now. Try again in a minute.",
    );

    // 0006 adds church sign-in. Without it the church dashboard cannot work.
    const staffTable = await status(fetchFn, `${rawUrl}/rest/v1/church_users?select=id&limit=0`, headers);
    add(
      "church_staff",
      "Church sign-in tables are installed",
      staffTable === 200,
      staffTable === 200
        ? "Church sign-in tables were found."
        : staffTable === 404 || staffTable === 400
          ? "Not found. Run 0006_church_staff.sql (in supabase/migrations) in the Supabase SQL Editor."
          : "Could not check just now. Try again in a minute.",
    );

    // 0008 adds the owner dashboard, church applications and the church's own pause switch.
    const ownerTable = await status(fetchFn, `${rawUrl}/rest/v1/owner_users?select=id&limit=0`, headers);
    add(
      "owner_dashboard",
      "Owner dashboard tables are installed",
      ownerTable === 200,
      ownerTable === 200
        ? "Owner dashboard tables were found."
        : ownerTable === 404 || ownerTable === 400
          ? "Not found. Run 0008_owner_signup_pause.sql (in supabase/migrations) in the Supabase SQL Editor."
          : "Could not check just now. Try again in a minute.",
    );

    // The daily check leaves a note in the audit log every time it runs.
    const since = new Date(Date.now() - 26 * 3_600_000).toISOString();
    let ran: boolean | null = null;
    try {
      const res = await fetchFn(
        `${rawUrl}/rest/v1/audit_log?action=eq.reconcile.run&at=gte.${encodeURIComponent(since)}&select=id&limit=1`,
        { headers, signal: AbortSignal.timeout(10_000) },
      );
      const rowsFound: unknown = res.ok ? await res.json() : null;
      ran = Array.isArray(rowsFound) ? rowsFound.length > 0 : null;
    } catch {
      ran = null;
    }
    add(
      "reconcile",
      "Daily check of the books has run in the last 26 hours",
      ran === true,
      ran === true
        ? "The daily check ran recently."
        : ran === false
          ? "It has not run yet. It runs by itself at 03:00 once CRON_SECRET is set in Vercel. You can also press Run daily check now below."
          : "Could not read the audit log just now. Try again in a minute.",
    );

    // A live key must never share a database with test gifts (they would count as real money on dashboards and in downloads).
    if (kind === "live") {
      let found: boolean | null = null;
      try {
        const res = await fetchFn(`${rawUrl}/rest/v1/gifts?reference=like.mz_test_*&select=id&limit=1`, { headers, signal: AbortSignal.timeout(10_000) });
        const body: unknown = res.ok ? await res.json() : null;
        found = Array.isArray(body) ? body.length > 0 : null;
      } catch {
        found = null;
      }
      add(
        "live_test_data",
        "Live key with test gifts in the database",
        found === false,
        found === false
          ? "No test gifts in this database. Good."
          : found === true
            ? "FAIL: this database holds test gifts but the key is a live one. Use a separate, empty live database (docs/LIVE_DATABASE.md). Checkout refuses to start until then."
            : "Could not check just now. Try again in a minute.",
      );
    } else {
      add("live_test_data", "Live key with test gifts in the database", true, "Not a live key, so test gifts here are expected. This check matters once a live key is used.");
    }

    // 0013 adds the nightly-cleaned counter table (0010 added the atomic functions). This only reads, so nothing is written.
    let counters: number | null = null;
    try {
      const res = await fetchFn(`${rawUrl}/rest/v1/limit_hits?select=id&limit=0`, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(10_000),
      });
      counters = res.status;
    } catch {
      counters = null;
    }
    add(
      "atomic_limits",
      "Attempt counters are installed",
      counters === 200,
      counters === 200
        ? "The attempt counters were found."
        : counters === 404
          ? "Not found. Run 0010_atomic_limits_retention.sql and then 0013_counters_and_payout_rule.sql (in supabase/migrations) in the Supabase SQL Editor."
          : "Could not check just now. Try again in a minute.",
    );
  } else {
    add("atomic_limits", "Attempt counters are installed", false, "Fix the Supabase settings above first.");
    add("live_test_data", "Live key with test gifts in the database", kind !== "live", kind === "live" ? "Fix the Supabase settings above first." : "Not a live key, so test gifts here are expected.");
    add("ledger", "Ledger and audit log are installed and reachable", false, "Fix the Supabase settings above first.");
    add("locked", "Ledger refuses requests with no key", false, "Fix the Supabase settings above first.");
    add("church_accounts", "Church accounts are installed", false, "Fix the Supabase settings above first.");
    add("church_staff", "Church sign-in tables are installed", false, "Fix the Supabase settings above first.");
    add("owner_dashboard", "Owner dashboard tables are installed", false, "Fix the Supabase settings above first.");
    add("reconcile", "Daily check of the books has run in the last 26 hours", false, "Fix the Supabase settings above first.");
  }

  // Church sign-in settings
  const stafSecret = (env.STAFF_SECRET?.trim().length ?? 0) >= 32;
  add(
    "staff_secret",
    "Church sign-in secret is set",
    stafSecret,
    stafSecret ? "STAFF_SECRET is set." : "Add STAFF_SECRET in Vercel (Production): a long random string, at least 32 characters.",
  );
  const rateOk = (env.RATE_LIMIT_SECRET?.trim().length ?? 0) >= 32;
  add(
    "rate_secret",
    "Rate-limit secret is set",
    rateOk,
    rateOk
      ? "RATE_LIMIT_SECRET is set."
      : "Add RATE_LIMIT_SECRET in Vercel (Production): a long random string, at least 32 characters. Without it the giving page refuses gifts on the live site.",
  );
  const totpKeyOk = (env.TOTP_KEY?.trim().length ?? 0) >= 32;
  add(
    "totp_key",
    "Authenticator key is set",
    totpKeyOk,
    totpKeyOk
      ? "TOTP_KEY is set, so changing STAFF_SECRET cannot lock the owner out of the authenticator app."
      : "Add TOTP_KEY in Vercel (Production, Sensitive): a long random string, at least 32 characters, different from STAFF_SECRET. Without it, changing STAFF_SECRET locks the owner out of the authenticator app. Write it in your password manager.",
  );
  const memberOk = (env.MEMBER_LINK_MASTER_KEY?.trim().length ?? 0) >= 32;
  add(
    "member_link_key",
    "Church Manager link key",
    true,
    memberOk
      ? "MEMBER_LINK_MASTER_KEY is set. The Church Manager link can be switched on per church on the Churches page."
      : "Not set, so the Church Manager link is off everywhere. That is fine until step 8 is used. To use it, add MEMBER_LINK_MASTER_KEY in Vercel (Production, Sensitive): a long random string, at least 32 characters.",
  );
  const standIn = env.PROVIDER_STAND_IN_EMAIL?.trim() ?? "";
  const standInOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(standIn) && !/@example\./i.test(standIn);
  add(
    "stand_in_email",
    "Maizz mailbox for gifts without an email is set",
    standInOk || kind !== "live",
    standInOk
      ? "PROVIDER_STAND_IN_EMAIL is set."
      : kind === "live"
        ? "FAIL: add PROVIDER_STAND_IN_EMAIL in Vercel (Production): a mailbox Maizz owns. With a live key, gifts without an email are refused until it is set."
        : "Not needed while the key is a test key. Add PROVIDER_STAND_IN_EMAIL (a mailbox Maizz owns) before going live.",
  );
  const publicOk = publicBaseUrl(env) !== null;
  add(
    "public_url",
    "Public web address is set",
    publicOk,
    publicOk
      ? "Links in emails and QR codes use MAIZZ_PUBLIC_URL."
      : "Add MAIZZ_PUBLIC_URL in Vercel (Production), for example https://maizz-nu.vercel.app (no slash, no path). Without it no invite or reset email can be sent and the share card cannot be made.",
  );
  const alertOk = Boolean(env.ALERT_EMAIL?.trim().includes("@")) && Boolean(env.RESEND_API_KEY?.trim() && env.MAIZZ_FROM_EMAIL?.trim());
  add(
    "alerts",
    "Alert emails are set up",
    alertOk,
    alertOk
      ? "Maizz will email you about odd events."
      : "Add ALERT_EMAIL in Vercel (Production) with the address you want alerts sent to. It also needs the email settings below.",
  );
  const mailReady = Boolean(env.RESEND_API_KEY?.trim() && env.MAIZZ_FROM_EMAIL?.trim());
  add(
    "email",
    "Email sending is set up",
    mailReady,
    mailReady
      ? "RESEND_API_KEY and MAIZZ_FROM_EMAIL are set."
      : "Sign-in codes and invites need RESEND_API_KEY and MAIZZ_FROM_EMAIL in Vercel (Production).",
  );

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
