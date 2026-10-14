import { describe, expect, it } from "vitest";
import { checkStartLimits, PHONE_LIMIT, START_LIMIT } from "../src/lib/checkoutLimits";
import { phoneKey, rateSecret } from "../src/lib/rateKey";
import { FakeAudit } from "./helpers";

const ENV = { RATE_LIMIT_SECRET: "r".repeat(40) };

describe("gift start limits", () => {
  it("refuses a fourth gift start to the same phone within an hour, from any source", async () => {
    const audit = new FakeAudit();
    const phone = phoneKey("0551234987", ENV);
    for (let i = 0; i < PHONE_LIMIT.perPhone; i++) expect(await checkStartLimits(audit, `src${i}`, phone)).toBeNull();
    expect(await checkStartLimits(audit, "src9", phone)).toBe("phone");
    expect(await checkStartLimits(audit, "src9", phoneKey("0241234567", ENV))).toBeNull();
  });

  it("lets the phone try again after an hour", async () => {
    const audit = new FakeAudit();
    const phone = phoneKey("0551234987", ENV);
    for (let i = 0; i < 4; i++) await checkStartLimits(audit, `s${i}`, phone);
    audit.shift(PHONE_LIMIT.minutes + 1);
    expect(await checkStartLimits(audit, "s9", phone)).toBeNull();
  });

  it("refuses the ninth gift start from one source in ten minutes", async () => {
    const audit = new FakeAudit();
    for (let i = 0; i < START_LIMIT.perSource; i++) expect(await checkStartLimits(audit, "same", phoneKey(`05512349${i}0`, ENV))).toBeNull();
    expect(await checkStartLimits(audit, "same", phoneKey("0599999999", ENV))).toBe("source");
  });

  it("50 simultaneous starts to one phone let only three through", async () => {
    const audit = new FakeAudit();
    const phone = phoneKey("0551234987", ENV);
    const results = await Promise.all(Array.from({ length: 50 }, (_, i) => checkStartLimits(audit, `src${i}`, phone)));
    expect(results.filter((r) => r === null)).toHaveLength(PHONE_LIMIT.perPhone);
  });

  it("never stores the phone number, only a one-way fingerprint", async () => {
    const audit = new FakeAudit();
    await checkStartLimits(audit, "src", phoneKey("0551234987", ENV));
    expect(JSON.stringify(audit.entries)).not.toContain("0551234987");
    expect(phoneKey("0551234987", ENV)).toHaveLength(32);
    expect(phoneKey("0551234987", ENV)).not.toBe(phoneKey("0551234987", { RATE_LIMIT_SECRET: "q".repeat(40) }));
  });
});

describe("rate secret", () => {
  it("uses RATE_LIMIT_SECRET when it is long enough", () => {
    expect(rateSecret(ENV)).toBe(ENV.RATE_LIMIT_SECRET);
  });
  it("until it is set, derives a separate key from another long secret, never the secret itself", () => {
    const k = rateSecret({ STAFF_SECRET: "s".repeat(40) });
    expect(k).not.toContain("s".repeat(40));
    expect(k).toBe(rateSecret({ STAFF_SECRET: "s".repeat(40) }));
  });
  it("refuses to run with no secret at all", () => {
    expect(() => rateSecret({})).toThrow();
    expect(() => rateSecret({ RATE_LIMIT_SECRET: "short" })).toThrow();
  });
});
