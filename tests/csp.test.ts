import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";
import { buildCsp, cspHeaderName, cspMode, newNonce } from "../src/lib/csp";
import { CSP_REPORTS_PER_HOUR, readCspReport, saveCspReport } from "../src/lib/cspReport";
import { FakeAudit } from "./helpers";

describe("Content-Security-Policy", () => {
  it("has the rules from the security review, and no outside script or font hosts", () => {
    const p = buildCsp("abc123");
    for (const part of [
      "default-src 'self'",
      "script-src 'self' 'nonce-abc123'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
      "report-uri /api/csp-report",
    ]) expect(p).toContain(part);
    expect(p).not.toMatch(/unsafe-eval|https?:\/\//);
    expect(p).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it("starts in report-only and enforces only when asked", () => {
    expect(cspMode({})).toBe("report-only");
    expect(cspMode({ MAIZZ_CSP: "nonsense" })).toBe("report-only");
    expect(cspMode({ MAIZZ_CSP: " Enforce " })).toBe("enforce");
    expect(cspHeaderName("report-only")).toBe("Content-Security-Policy-Report-Only");
    expect(cspHeaderName("enforce")).toBe("Content-Security-Policy");
  });

  it("makes a new nonce every time", () => {
    const a = newNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(newNonce()).not.toBe(a);
  });

  it.each(["/", "/give/grace-chapel", "/church", "/owner", "/setup-check"])("sets the header on %s, with the same nonce for Next.js", (path) => {
    const res = middleware(new NextRequest(`https://maizz.test${path}`));
    const header = res.headers.get("Content-Security-Policy-Report-Only")!;
    expect(header).toContain("script-src 'self' 'nonce-");
    expect(res.headers.get("Content-Security-Policy")).toBeNull();
    const nonce = /'nonce-([^']+)'/.exec(header)![1]!;
    // The request header the page is rendered with carries the same policy, which is how Next.js finds the nonce.
    expect(res.headers.get("x-middleware-request-content-security-policy-report-only")).toContain(`'nonce-${nonce}'`);
    expect(res.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
  });

  it("is a different policy on each page load", () => {
    const get = () => middleware(new NextRequest("https://maizz.test/")).headers.get("Content-Security-Policy-Report-Only");
    expect(get()).not.toBe(get());
  });
});

describe("report reader", () => {
  it("reads the older format and keeps only the rule, the blocked address and the page path", () => {
    const r = readCspReport(
      JSON.stringify({
        "csp-report": {
          "document-uri": "https://maizz.test/give/grace?name=Kofi&phone=055",
          "violated-directive": "script-src-elem",
          "effective-directive": "script-src-elem",
          "blocked-uri": "https://evil.example/x.js?token=secret",
        },
      }),
    );
    expect(r).toEqual({ directive: "script-src-elem", blocked: "https://evil.example/x.js", page: "/give/grace" });
  });

  it("reads the newer format", () => {
    const r = readCspReport(JSON.stringify([{ type: "csp-violation", body: { effectiveDirective: "img-src", blockedURL: "inline", documentURL: "https://m.test/" } }]));
    expect(r).toEqual({ directive: "img-src", blocked: "inline", page: "/" });
  });

  it("ignores junk, giant bodies and other kinds of report", () => {
    expect(readCspReport("")).toBeNull();
    expect(readCspReport("not json")).toBeNull();
    expect(readCspReport("x".repeat(20_000))).toBeNull();
    expect(readCspReport(JSON.stringify([{ type: "deprecation", body: {} }]))).toBeNull();
    expect(readCspReport(JSON.stringify({ "csp-report": {} }))).toBeNull();
  });
});

describe("saving reports", () => {
  const report = { directive: "img-src", blocked: "https://x.example/a.png", page: "/" };

  it("keeps only the first 20 an hour from one source, and counts each source on its own", async () => {
    const audit = new FakeAudit();
    for (let i = 0; i < CSP_REPORTS_PER_HOUR + 5; i += 1) await saveCspReport(audit, "src-a", report);
    expect(audit.entries).toHaveLength(CSP_REPORTS_PER_HOUR);
    expect(await saveCspReport(audit, "src-b", report)).toBe(true);
    expect(audit.entries.at(-1)).toMatchObject({ actor: "browser", action: "csp.report", target: "img-src https://x.example/a.png", detail: { page: "/" } });
  });

  it("never fails the caller when the audit log is down", async () => {
    const audit = new FakeAudit();
    audit.failWrites = true;
    audit.failReads = true;
    expect(await saveCspReport(audit, "src-a", report)).toBe(false);
  });
});
