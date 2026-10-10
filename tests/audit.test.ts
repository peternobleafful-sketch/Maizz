import { describe, expect, it } from "vitest";
import { adminGate, ADMIN_LIMITS } from "../src/lib/adminAuth";
import { createSupabaseAudit, scrubDetail, sourceKeyFor, AuditError } from "../src/lib/audit";
import { FakeAudit, mockFetch } from "./helpers";

const TOKEN = "a-long-random-token-1234567890";
const ENV = { SETUP_CHECK_TOKEN: TOKEN };

function req(opts: { token?: string; ip?: string } = {}) {
  const headers: Record<string, string> = { "x-forwarded-for": opts.ip ?? "203.0.113.5" };
  if (opts.token !== undefined) headers.authorization = `Bearer ${opts.token}`;
  return new Request("https://x.test/api/setup-check", { method: "POST", headers });
}

const gate = (audit: FakeAudit, r: Request, env: Record<string, string | undefined> = ENV) =>
  adminGate({ req: r, env, audit, action: "admin.setup_check" });

describe("scrubDetail", () => {
  it("drops keys that could carry secrets or personal details", () => {
    const out = scrubDetail({
      reference: "mz_1",
      count: 3,
      token: "x",
      api_key: "x",
      secret: "x",
      Authorization: "x",
      phone: "0551234987",
      email: "a@b.co",
      full_name: "Ama",
      pin: "1234",
      otp: "123456",
      card_number: "4111",
    });
    expect(out).toEqual({ reference: "mz_1", count: 3 });
  });

  it("drops values that look like keys, whatever the field is called", () => {
    const out = scrubDetail({ a: "sk_test_abc", b: "sb_secret_abc", c: "eyJhbGciOi.x.y", d: "Bearer abc", e: "fine" });
    expect(out).toEqual({ e: "fine" });
  });

  it("keeps only plain values and shortens long text", () => {
    const out = scrubDetail({ nested: { a: 1 }, fn: () => 1, long: "x".repeat(500), list: [1, "a", { b: 1 }, null], ok: true });
    expect(out.nested).toBeUndefined();
    expect(out.fn).toBeUndefined();
    expect((out.long as string).length).toBe(200);
    expect(out.list).toEqual([1, "a", null]);
    expect(out.ok).toBe(true);
  });

  it("copes with nothing", () => {
    expect(scrubDetail(undefined)).toEqual({});
  });
});

describe("sourceKeyFor", () => {
  it("is a stable fingerprint that is not the address", () => {
    const a = sourceKeyFor(req({ ip: "203.0.113.5" }), TOKEN);
    expect(a).toBe(sourceKeyFor(req({ ip: "203.0.113.5" }), TOKEN));
    expect(a).not.toBe(sourceKeyFor(req({ ip: "203.0.113.6" }), TOKEN));
    expect(a).not.toContain("203");
    expect(a).toMatch(/^[a-f0-9]{32}$/);
  });

  it("uses the first address in a forwarded list", () => {
    const one = new Request("https://x.test", { headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" } });
    expect(sourceKeyFor(one, TOKEN)).toBe(sourceKeyFor(req({ ip: "203.0.113.5" }), TOKEN));
  });
});

describe("admin gate: switched off", () => {
  it("answers 404 with no token set or one that is too short, and touches nothing", async () => {
    const audit = new FakeAudit();
    expect((await gate(audit, req({ token: TOKEN }), {}))!.status).toBe(404);
    expect((await gate(audit, req({ token: "short" }), { SETUP_CHECK_TOKEN: "short" }))!.status).toBe(404);
    expect(audit.entries).toHaveLength(0);
  });
});

describe("admin gate: tokens", () => {
  it("lets the right token through and records the action first", async () => {
    const audit = new FakeAudit();
    expect(await gate(audit, req({ token: TOKEN }))).toBeNull();
    expect(audit.actions()).toEqual(["admin.setup_check"]);
    expect(audit.entries[0]).toMatchObject({ actor: "admin", outcome: "ok" });
  });

  it("refuses wrong or missing tokens (401) and records each one", async () => {
    const audit = new FakeAudit();
    for (const r of [req(), req({ token: "nope" }), req({ token: "" })]) {
      expect((await gate(audit, r))!.status).toBe(401);
    }
    expect(audit.actions()).toEqual(["admin.auth_failed", "admin.auth_failed", "admin.auth_failed"]);
    expect(audit.entries.every((e) => e.outcome === "denied")).toBe(true);
  });

  it("never writes the token, right or wrong, into the audit log", async () => {
    const audit = new FakeAudit();
    await gate(audit, req({ token: "my-wrong-guess-123456789012345" }));
    await gate(audit, req({ token: TOKEN }));
    const text = JSON.stringify(audit.entries);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("my-wrong-guess");
  });
});

describe("admin gate: attempt limits", () => {
  it("locks one source after repeated wrong tokens, even for the right token", async () => {
    const audit = new FakeAudit();
    for (let i = 0; i < ADMIN_LIMITS.perSource; i++) {
      expect((await gate(audit, req({ token: "wrong" })))!.status).toBe(401);
    }
    const locked = await gate(audit, req({ token: "wrong" }));
    expect(locked!.status).toBe(429);
    expect(locked!.headers.get("retry-after")).toBe("900");
    expect((await gate(audit, req({ token: TOKEN })))!.status).toBe(429);
    // A locked attempt is not recorded as another failure, and no action ran.
    expect(audit.actions().filter((a) => a === "admin.setup_check")).toHaveLength(0);
  });

  it("does not lock out a different source for one source's mistakes", async () => {
    const audit = new FakeAudit();
    for (let i = 0; i < ADMIN_LIMITS.perSource; i++) await gate(audit, req({ token: "wrong", ip: "198.51.100.1" }));
    expect((await gate(audit, req({ token: "wrong", ip: "198.51.100.1" })))!.status).toBe(429);
    expect(await gate(audit, req({ token: TOKEN, ip: "198.51.100.2" }))).toBeNull();
  });

  it("locks everyone after too many wrong tokens from many sources", async () => {
    const audit = new FakeAudit();
    for (let i = 0; i < ADMIN_LIMITS.global; i++) {
      await gate(audit, req({ token: "wrong", ip: `198.51.100.${i + 10}` }));
    }
    expect((await gate(audit, req({ token: TOKEN, ip: "192.0.2.77" })))!.status).toBe(429);
  });

  it("unlocks once the window has passed", async () => {
    const audit = new FakeAudit();
    for (let i = 0; i < ADMIN_LIMITS.perSource; i++) await gate(audit, req({ token: "wrong" }));
    expect((await gate(audit, req({ token: TOKEN })))!.status).toBe(429);
    audit.shift(ADMIN_LIMITS.windowMinutes + 1);
    expect(await gate(audit, req({ token: TOKEN }))).toBeNull();
  });
});

describe("admin gate: fails closed", () => {
  it("refuses with 503 when the audit log cannot be read", async () => {
    const audit = new FakeAudit();
    audit.failReads = true;
    const res = await gate(audit, req({ token: TOKEN }));
    expect(res!.status).toBe(503);
    expect(((await res!.json()) as { error: string }).error).toBe("audit_unavailable");
  });

  it("refuses with 503, and does not run the action, when the action cannot be recorded", async () => {
    const audit = new FakeAudit();
    audit.failWrites = true;
    expect((await gate(audit, req({ token: TOKEN })))!.status).toBe(503);
  });

  it("does not let wrong guesses go uncounted when the log cannot be written", async () => {
    const audit = new FakeAudit();
    audit.failWrites = true;
    expect((await gate(audit, req({ token: "wrong" })))!.status).toBe(503);
  });
});

describe("supabase audit log", () => {
  const URL_ = "https://abcdefghij.supabase.co";

  it("records an entry with scrubbed details", async () => {
    const m = mockFetch([{ status: 201, json: {} }]);
    const a = createSupabaseAudit({ url: `${URL_}/`, serviceKey: "sb_secret_abc", fetchFn: m.fn });
    await a.record({
      actor: "admin",
      action: "admin.test",
      target: "ref",
      sourceKey: "abc",
      detail: { count: 2, phone: "0551234987", token: "secret" },
    });
    const call = m.calls[0]!;
    expect(call.url).toBe(`${URL_}/rest/v1/audit_log`);
    expect(call.headers.apikey).toBe("sb_secret_abc");
    expect(call.body).toEqual({
      actor: "admin",
      action: "admin.test",
      target: "ref",
      outcome: "ok",
      source_key: "abc",
      detail: { count: 2 },
    });
  });

  it("fails loudly if the record is refused", async () => {
    const m = mockFetch([{ status: 404, json: {} }]);
    const a = createSupabaseAudit({ url: URL_, serviceKey: "sb_secret_abc", fetchFn: m.fn });
    await expect(a.record({ actor: "a", action: "b" })).rejects.toThrow(AuditError);
  });

  it("counts from the Content-Range header and encodes the query", async () => {
    const m = mockFetch([]);
    const fn = (async (input: string | URL | Request) => {
      m.calls.push({ url: String(input), method: "GET", headers: {}, body: undefined });
      return new Response("[]", { status: 206, headers: { "content-range": "0-0/7" } });
    }) as typeof fetch;
    const a = createSupabaseAudit({ url: URL_, serviceKey: "sb_secret_abc", fetchFn: fn });
    expect(await a.countSince("admin.auth_failed", 15, "k&ey")).toBe(7);
    const url = m.calls[0]!.url;
    expect(url).toContain("action=eq.admin.auth_failed");
    expect(url).toContain("source_key=eq.k%26ey");
    expect(url).toMatch(/at=gte\.\d{4}-\d{2}-\d{2}T/);
  });

  it("refuses an unreadable count", async () => {
    const fn = (async () => new Response("[]", { status: 200 })) as typeof fetch;
    const a = createSupabaseAudit({ url: URL_, serviceKey: "sb_secret_abc", fetchFn: fn });
    await expect(a.countSince("x", 5)).rejects.toThrow(AuditError);
  });
});
