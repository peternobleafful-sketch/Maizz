import { describe, expect, it } from "vitest";
import { clientAddress, createSupabaseAudit, sourceKeyFor } from "../src/lib/audit";
import { checkStartLimits, noteSiteVolume } from "../src/lib/checkoutLimits";
import { CSP_REPORTS_PER_DAY, saveCspReport } from "../src/lib/cspReport";
import { runSetupChecks } from "../src/lib/setupCheck";
import { readCappedText } from "../src/lib/staffRoutes";
import { INVITE_LIMIT_PER_DAY, mayInvite } from "../src/lib/teamRules";
import { FakeAudit, mockFetch } from "./helpers";

describe("counters are read from their own table (finding 2)", () => {
  it("hit() calls maizz_hit with three plain values, and countHits() reads limit_hits, not the audit log", async () => {
    const m = mockFetch([{ json: 3 }, { json: [], status: 200 }]);
    const a = createSupabaseAudit({ url: "https://x.supabase.co", serviceKey: "sb_secret_abc", fetchFn: m.fn });
    expect(await a.hit({ action: "x.y", sourceKey: "k", minutes: 5 })).toBe(3);
    expect(m.calls[0]!.url).toContain("rpc/maizz_hit");
    expect(m.calls[0]!.body).toEqual({ p_action: "x.y", p_source_key: "k", p_minutes: 5 });
    const m2 = mockFetch([() => ({ json: [] })]);
    const b = createSupabaseAudit({ url: "https://x.supabase.co", serviceKey: "sb_secret_abc", fetchFn: m2.fn });
    await b.countHits("x.y", 5).catch(() => undefined);
    expect(m2.calls[0]!.url).toContain("/rest/v1/limit_hits?");
    await b.countSince("x.y", 5).catch(() => undefined);
    expect(m2.calls.length).toBeGreaterThan(0);
  });

  it("the church-wide report ceiling keeps the permanent log small even with many visitors", async () => {
    const audit = new FakeAudit();
    let saved = 0;
    for (let i = 0; i < CSP_REPORTS_PER_DAY + 50; i += 1) {
      if (await saveCspReport(audit, `visitor-${i}`, { directive: "img-src", blocked: "https://x.example", page: "/" })) saved += 1;
    }
    expect(saved).toBe(CSP_REPORTS_PER_DAY);
    expect(audit.entries).toHaveLength(CSP_REPORTS_PER_DAY);
  });

  it("gift starts only add counters, never permanent log rows, and the site-wide count rises", async () => {
    const audit = new FakeAudit();
    await checkStartLimits(audit, "s", "p");
    expect(await noteSiteVolume(audit)).toBe(1);
    expect(await noteSiteVolume(audit)).toBe(2);
    expect(audit.entries).toHaveLength(0);
  });
});

describe("the caller's address (finding 15)", () => {
  const req = (h: Record<string, string>) => new Request("https://x.test/", { headers: h });

  it("trusts Vercel's own header over a made-up X-Forwarded-For", () => {
    expect(clientAddress(req({ "x-vercel-forwarded-for": "198.51.100.7", "x-forwarded-for": "6.6.6.6, 198.51.100.7" }), { VERCEL: "1" })).toBe("198.51.100.7");
  });

  it("on Vercel, ignores X-Forwarded-For entirely when Vercel's header is missing", () => {
    expect(clientAddress(req({ "x-forwarded-for": "6.6.6.6" }), { VERCEL: "1" })).toBe("unknown");
    expect(clientAddress(req({ "x-forwarded-for": "6.6.6.6", "x-real-ip": "198.51.100.9" }), { VERCEL: "1" })).toBe("198.51.100.9");
  });

  it("away from Vercel (local work, tests) still reads X-Forwarded-For", () => {
    expect(clientAddress(req({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }), {})).toBe("203.0.113.5");
  });

  it("changing a fake X-Forwarded-For does not change the source key on Vercel", () => {
    const prev = process.env.VERCEL;
    process.env.VERCEL = "1";
    try {
      const a = sourceKeyFor(req({ "x-vercel-forwarded-for": "198.51.100.7", "x-forwarded-for": "1.1.1.1" }), "s".repeat(40));
      const b = sourceKeyFor(req({ "x-vercel-forwarded-for": "198.51.100.7", "x-forwarded-for": "2.2.2.2" }), "s".repeat(40));
      expect(a).toBe(b);
    } finally {
      if (prev === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = prev;
    }
  });
});

describe("invite emails per church per day (finding 13)", () => {
  it("allows the daily number, refuses the next, and counts each church on its own", async () => {
    const audit = new FakeAudit();
    for (let i = 0; i < INVITE_LIMIT_PER_DAY; i += 1) expect(await mayInvite(audit, "church-a")).toBe(true);
    expect(await mayInvite(audit, "church-a")).toBe(false);
    expect(await mayInvite(audit, "church-b")).toBe(true);
  });

  it("starts again the next day, and refuses when the counters are down", async () => {
    const audit = new FakeAudit();
    for (let i = 0; i <= INVITE_LIMIT_PER_DAY; i += 1) await mayInvite(audit, "church-a");
    audit.shift(24 * 60 + 1);
    expect(await mayInvite(audit, "church-a")).toBe(true);
    audit.failWrites = true;
    expect(await mayInvite(audit, "church-a")).toBe(false);
  });
});

describe("bodies are read with a cap (finding 17)", () => {
  const post = (body: string, headers: Record<string, string> = {}) => new Request("https://x.test/", { method: "POST", body, headers });

  it("returns small bodies whole", async () => {
    expect(await readCappedText(post("hello"), 100)).toBe("hello");
    expect(await readCappedText(post(""), 100)).toBe("");
  });

  it("refuses a body over the cap, from the declared size or from what arrives", async () => {
    expect(await readCappedText(post("x".repeat(500)), 100)).toBeNull();
    expect(await readCappedText(post("x".repeat(500), { "content-length": "500" }), 100)).toBeNull();
    // A lying small content-length does not help: the bytes that arrive are counted.
    expect(await readCappedText(post("x".repeat(500), { "content-length": "5" }), 100)).toBeNull();
  });
});

describe("setup checks for the new settings", () => {
  const run = async (env: Record<string, string>) => {
    const m = mockFetch([]);
    const rows = await runSetupChecks({ ...env }, m.fn).catch(() => []);
    return Object.fromEntries(rows.map((r) => [r.id, r]));
  };

  it("asks for TOTP_KEY, and wants a Maizz mailbox once the key is live", async () => {
    const without = await run({ PAYSTACK_SECRET_KEY: "sk_test_abc" });
    expect(without.totp_key?.ok).toBe(false);
    expect(without.stand_in_email?.ok).toBe(true); // test key: not needed yet
    const live = await run({ PAYSTACK_SECRET_KEY: "sk_live_abc123", TOTP_KEY: "k".repeat(40) });
    expect(live.totp_key?.ok).toBe(true);
    expect(live.stand_in_email?.ok).toBe(false);
    const done = await run({ PAYSTACK_SECRET_KEY: "sk_live_abc123", PROVIDER_STAND_IN_EMAIL: "gifts@maizz.africa" });
    expect(done.stand_in_email?.ok).toBe(true);
    const fake = await run({ PAYSTACK_SECRET_KEY: "sk_live_abc123", PROVIDER_STAND_IN_EMAIL: "giver@example.com" });
    expect(fake.stand_in_email?.ok).toBe(false);
  });
});

describe("public gift routes only answer our own pages (finding 3, in part)", () => {
  it("refuses a gift start or a code with no Origin, or another site's Origin, before touching anything", async () => {
    const { POST: start } = await import("../src/app/api/checkout/route");
    const { POST: code } = await import("../src/app/api/checkout/otp/route");
    for (const origin of [null, "https://evil.test"]) {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (origin) headers.Origin = origin;
      const body = JSON.stringify({ any: "thing" });
      expect((await start(new Request("https://maizz.test/api/checkout", { method: "POST", headers, body }))).status).toBe(403);
      expect((await code(new Request("https://maizz.test/api/checkout/otp", { method: "POST", headers, body }))).status).toBe(403);
    }
  });
});

describe("counters never hold a gift reference", () => {
  it("the status poll counts under a fingerprint, not the reference", async () => {
    const { mayAskProvider } = await import("../src/lib/statusPoll");
    const audit = new FakeAudit();
    await mayAskProvider(audit, "mz_secretreference123456");
    expect(audit.hits).toHaveLength(1);
    expect(JSON.stringify(audit.hits)).not.toContain("mz_secretreference");
    expect(audit.hits[0]!.sourceKey).toMatch(/^[0-9a-f]{32}$/);
  });
});
