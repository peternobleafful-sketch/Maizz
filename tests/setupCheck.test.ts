import { describe, expect, it } from "vitest";
import { runSetupChecks } from "../src/lib/setupCheck";
import { mockFetch } from "./helpers";

const GOOD_ENV = {
  PAYSTACK_SECRET_KEY: "sk_test_abc",
  SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_abc",
};

const ok = { status: 200, json: [] };
const all200 = [ok, ...Array.from({ length: 7 }, () => ok), { status: 401, json: {} }, { json: [{ id: 1 }] }];

function byId(results: Awaited<ReturnType<typeof runSetupChecks>>) {
  return Object.fromEntries(results.map((r) => [r.id, r]));
}

describe("setup check", () => {
  it("passes everything when settings are right", async () => {
    const m = mockFetch(all200);
    const r = byId(await runSetupChecks(GOOD_ENV, m.fn));
    for (const id of ["paystack_key", "paystack_reach", "supabase_url", "supabase_key", "ledger", "locked", "reconcile", "guard"]) {
      expect(r[id]!.ok, `${id}: ${r[id]!.hint}`).toBe(true);
    }
  });

  it("flags a live Paystack key and does not send it anywhere", async () => {
    const m = mockFetch([]);
    const r = byId(await runSetupChecks({ ...GOOD_ENV, PAYSTACK_SECRET_KEY: "sk_live_abc" }, m.fn));
    expect(r.paystack_key!.ok).toBe(false);
    expect(r.paystack_key!.hint).toMatch(/LIVE/);
    expect(m.calls.some((c) => c.headers.Authorization?.includes("sk_live_"))).toBe(false);
  });

  it("flags a public Paystack key", async () => {
    const r = byId(await runSetupChecks({ ...GOOD_ENV, PAYSTACK_SECRET_KEY: "pk_test_abc" }, mockFetch([]).fn));
    expect(r.paystack_key!.hint).toMatch(/public key/);
  });

  it("flags a Paystack key that Paystack rejects", async () => {
    const m = mockFetch([{ status: 401, json: {} }, ...all200.slice(1)]);
    const r = byId(await runSetupChecks(GOOD_ENV, m.fn));
    expect(r.paystack_reach!.ok).toBe(false);
  });

  it("flags the wrong Supabase address shapes", async () => {
    for (const bad of ["https://abcdefghijklmnopqrst.supabase.co/", "https://abcdefghijklmnopqrst.supabase.co/rest/v1", "abcdefghij", ""]) {
      const r = byId(await runSetupChecks({ ...GOOD_ENV, SUPABASE_URL: bad }, mockFetch([ok]).fn));
      expect(r.supabase_url!.ok, bad).toBe(false);
    }
  });

  it("flags the publishable and anon Supabase keys", async () => {
    const anon = `x.${Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url")}.y`;
    const service = `x.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.y`;
    const pub = byId(await runSetupChecks({ ...GOOD_ENV, SUPABASE_SERVICE_ROLE_KEY: "sb_publishable_abc" }, mockFetch([ok]).fn));
    expect(pub.supabase_key!.ok).toBe(false);
    const a = byId(await runSetupChecks({ ...GOOD_ENV, SUPABASE_SERVICE_ROLE_KEY: anon }, mockFetch([ok]).fn));
    expect(a.supabase_key!.hint).toMatch(/anon/);
    const s = byId(await runSetupChecks({ ...GOOD_ENV, SUPABASE_SERVICE_ROLE_KEY: service }, mockFetch(all200).fn));
    expect(s.supabase_key!.ok).toBe(true);
  });

  it("says when the ledger file has not been run", async () => {
    const replies = [ok, ok, { status: 404, json: {} }, ok, ok, ok, ok, ok, { status: 401, json: {} }];
    const r = byId(await runSetupChecks(GOOD_ENV, mockFetch(replies).fn));
    expect(r.ledger!.ok).toBe(false);
    expect(r.ledger!.hint).toMatch(/givers/);
    expect(r.ledger!.hint).toMatch(/SQL Editor/);
  });

  it("flags a ledger that is open to requests with no key", async () => {
    const replies = [ok, ...Array.from({ length: 7 }, () => ok), { status: 200, json: [] }];
    const r = byId(await runSetupChecks(GOOD_ENV, mockFetch(replies).fn));
    expect(r.locked!.ok).toBe(false);
  });

  it("flags live payments being switched on", async () => {
    const r = byId(await runSetupChecks({ ...GOOD_ENV, MAIZZ_ALLOW_LIVE: "yes" }, mockFetch(all200).fn));
    expect(r.guard!.ok).toBe(false);
  });

  it("never includes any key or secret in its results", async () => {
    const env = {
      ...GOOD_ENV,
      PAYSTACK_SECRET_KEY: "sk_test_SUPERSECRET",
      SUPABASE_SERVICE_ROLE_KEY: "sb_secret_SUPERSECRET2",
    };
    const text = JSON.stringify(await runSetupChecks(env, mockFetch(all200).fn));
    expect(text).not.toContain("SUPERSECRET");
  });
});

describe("setup check: daily check", () => {
  it("says when the daily check has not run yet", async () => {
    const replies = [...all200.slice(0, -1), { json: [] }];
    const r = byId(await runSetupChecks(GOOD_ENV, mockFetch(replies).fn));
    expect(r.reconcile!.ok).toBe(false);
    expect(r.reconcile!.hint).toMatch(/CRON_SECRET/);
  });

  it("asks the audit log only for recent runs of the daily check", async () => {
    const m = mockFetch(all200);
    await runSetupChecks(GOOD_ENV, m.fn);
    const url = m.calls[m.calls.length - 1]!.url;
    expect(url).toContain("audit_log?action=eq.reconcile.run");
    expect(url).toMatch(/at=gte\.\d{4}-/);
  });
});
