import { describe, expect, it } from "vitest";
import { requireAdmin } from "../src/lib/adminAuth";
import { runSetupChecks } from "../src/lib/setupCheck";
import { mockFetch } from "./helpers";

const GOOD_ENV = {
  PAYSTACK_SECRET_KEY: "sk_test_abc",
  SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_abc",
};

const ok = { status: 200, json: [] };
const all200 = [ok, ...Array.from({ length: 6 }, () => ok), { status: 401, json: {} }];

function byId(results: Awaited<ReturnType<typeof runSetupChecks>>) {
  return Object.fromEntries(results.map((r) => [r.id, r]));
}

describe("setup check", () => {
  it("passes everything when settings are right", async () => {
    const m = mockFetch(all200);
    const r = byId(await runSetupChecks(GOOD_ENV, m.fn));
    for (const id of ["paystack_key", "paystack_reach", "supabase_url", "supabase_key", "ledger", "locked", "guard"]) {
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
    const replies = [ok, ok, { status: 404, json: {} }, ok, ok, ok, ok, { status: 401, json: {} }];
    const r = byId(await runSetupChecks(GOOD_ENV, mockFetch(replies).fn));
    expect(r.ledger!.ok).toBe(false);
    expect(r.ledger!.hint).toMatch(/givers/);
    expect(r.ledger!.hint).toMatch(/SQL Editor/);
  });

  it("flags a ledger that is open to requests with no key", async () => {
    const replies = [ok, ...Array.from({ length: 6 }, () => ok), { status: 200, json: [] }];
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

describe("admin access", () => {
  const TOKEN = "a-long-random-token-1234567890";
  const req = (header?: string) =>
    new Request("https://x.test/api/setup-check", { headers: header ? { authorization: header } : {} });

  it("is switched off with no token set, or one that is too short", () => {
    expect(requireAdmin(req(`Bearer ${TOKEN}`), {})!.status).toBe(404);
    expect(requireAdmin(req("Bearer short"), { SETUP_CHECK_TOKEN: "short" })!.status).toBe(404);
  });

  it("refuses a missing or wrong token", () => {
    expect(requireAdmin(req(), { SETUP_CHECK_TOKEN: TOKEN })!.status).toBe(401);
    expect(requireAdmin(req("Bearer nope"), { SETUP_CHECK_TOKEN: TOKEN })!.status).toBe(401);
    expect(requireAdmin(req(TOKEN), { SETUP_CHECK_TOKEN: TOKEN })!.status).toBe(401);
    expect(requireAdmin(req("Bearer "), { SETUP_CHECK_TOKEN: TOKEN })!.status).toBe(401);
  });

  it("lets the right token through", () => {
    expect(requireAdmin(req(`Bearer ${TOKEN}`), { SETUP_CHECK_TOKEN: TOKEN })).toBeNull();
  });
});
