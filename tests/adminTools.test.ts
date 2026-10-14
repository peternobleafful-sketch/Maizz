import { describe, expect, it } from "vitest";
import { adminToolsOff, openAdminRoute } from "../src/lib/adminAuth";

const TOKEN = "a-long-random-token-1234567890";
const CRON = "a-different-long-secret-1234567";
const req = (token: string) =>
  new Request("https://x.test/api/admin/churches", { method: "POST", headers: { authorization: `Bearer ${token}`, "x-forwarded-for": "203.0.113.5" } });

describe("admin tools in Production", () => {
  it("are off in Production unless MAIZZ_ADMIN_TOOLS=on, and on elsewhere", () => {
    expect(adminToolsOff({ VERCEL_ENV: "production" })).toBe(true);
    expect(adminToolsOff({ VERCEL_ENV: "production", MAIZZ_ADMIN_TOOLS: "off" })).toBe(true);
    expect(adminToolsOff({ VERCEL_ENV: "production", MAIZZ_ADMIN_TOOLS: " on " })).toBe(false);
    expect(adminToolsOff({ VERCEL_ENV: "preview" })).toBe(false);
    expect(adminToolsOff({})).toBe(false);
    expect(adminToolsOff({ VERCEL_ENV: "preview", PAYSTACK_SECRET_KEY: "sk_test_abc" })).toBe(false);
  });

  it("stays off for a live key or the live database, in any environment, even with the override", () => {
    const live = "sk_live_" + "x".repeat(20);
    for (const VERCEL_ENV of ["preview", "development", "production", undefined]) {
      expect(adminToolsOff({ VERCEL_ENV, PAYSTACK_SECRET_KEY: live })).toBe(true);
      expect(adminToolsOff({ VERCEL_ENV, PAYSTACK_SECRET_KEY: live, MAIZZ_ADMIN_TOOLS: "on" })).toBe(true);
      expect(adminToolsOff({ VERCEL_ENV, MAIZZ_LIVE_DATABASE: "yes" })).toBe(true);
      expect(adminToolsOff({ VERCEL_ENV, MAIZZ_LIVE_DATABASE: " YES ", MAIZZ_ADMIN_TOOLS: "on" })).toBe(true);
    }
    expect(adminToolsOff({ VERCEL_ENV: "preview", MAIZZ_LIVE_DATABASE: "no" })).toBe(false);
  });

  it("answer 404 in Production even with the right token", async () => {
    const env = { VERCEL_ENV: "production", SETUP_CHECK_TOKEN: TOKEN };
    const res = await openAdminRoute(req(TOKEN), env, "admin.church_list");
    expect(res!.status).toBe(404);
  });

  it("stay open for the first-owner set-up only while the check says no owner has signed up", async () => {
    const env = { VERCEL_ENV: "production", SETUP_CHECK_TOKEN: TOKEN };
    // Allowed means the request goes on to the normal gate; with no Supabase settings that is a 503, not a 404.
    expect((await openAdminRoute(req(TOKEN), env, "admin.owner_invite", undefined, { allowInProductionWhen: async () => true }))!.status).toBe(503);
    expect((await openAdminRoute(req(TOKEN), env, "admin.owner_invite", undefined, { allowInProductionWhen: async () => false }))!.status).toBe(404);
    expect((await openAdminRoute(req(TOKEN), env, "admin.owner_invite", undefined, { allowInProductionWhen: async () => { throw new Error("x"); } }))!.status).toBe(404);
  });

  it("never switch off the daily-check addresses", async () => {
    const env = { VERCEL_ENV: "production", CRON_SECRET: CRON };
    const res = await openAdminRoute(req(CRON), env, "cron.reconcile", undefined, { tokenEnv: "CRON_SECRET", failedAction: "cron.auth_failed" });
    expect(res!.status).not.toBe(404);
  });

  it("work as before in Preview and when switched on", async () => {
    for (const env of [{ VERCEL_ENV: "preview", SETUP_CHECK_TOKEN: TOKEN }, { VERCEL_ENV: "production", MAIZZ_ADMIN_TOOLS: "on", SETUP_CHECK_TOKEN: TOKEN }]) {
      expect((await openAdminRoute(req(TOKEN), env, "admin.church_list"))!.status).toBe(503);
    }
  });
});
