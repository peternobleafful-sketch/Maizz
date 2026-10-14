import { describe, expect, it } from "vitest";
import { mayAskProvider, VERIFY_PER_MINUTE } from "../src/lib/statusPoll";
import { FakeAudit } from "./helpers";

describe("status polling (C1)", () => {
  it("lets the provider be asked 6 times a minute per gift, then says no", async () => {
    const audit = new FakeAudit();
    for (let i = 0; i < VERIFY_PER_MINUTE; i += 1) expect(await mayAskProvider(audit, "mz_one_11111")).toBe(true);
    expect(await mayAskProvider(audit, "mz_one_11111")).toBe(false);
    expect(await mayAskProvider(audit, "mz_two_22222")).toBe(true);
  });
  it("asks again once the minute has passed", async () => {
    const audit = new FakeAudit();
    for (let i = 0; i < VERIFY_PER_MINUTE; i += 1) await mayAskProvider(audit, "mz_one_11111");
    audit.shift(2);
    expect(await mayAskProvider(audit, "mz_one_11111")).toBe(true);
  });
  it("says no, without throwing, when the audit log is down", async () => {
    const audit = new FakeAudit();
    audit.failReads = true;
    expect(await mayAskProvider(audit, "mz_one_11111")).toBe(false);
  });
});
