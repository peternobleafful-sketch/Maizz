import { describe, expect, it } from "vitest";
import { removeGiverDetails } from "../src/lib/ownerGiver";
import { RETENTION, runCleanUp } from "../src/lib/retention";
import { createSupabaseLedger } from "../src/lib/ledger";
import { FakeAudit, FakeLedger, mockFetch } from "./helpers";

describe("nightly clean-up", () => {
  it("asks for 30 days and 90 days, and writes the result to the audit log", async () => {
    const ledger = new FakeLedger();
    const audit = new FakeAudit();
    expect(await runCleanUp({ ledger, audit })).toEqual({ ok: true, givers: 0, applications: 0 });
    expect(ledger.cleanUps).toEqual([{ giverDays: 30, applicationDays: 90 }]);
    expect(RETENTION).toEqual({ giverDays: 30, applicationDays: 90 });
    expect(audit.entries[0]).toMatchObject({ actor: "cleanup", action: "cleanup.run", outcome: "ok" });
  });

  it("does not throw when it fails, and the failure is visible", async () => {
    const ledger = new FakeLedger();
    ledger.cleanUpOldDetails = async () => {
      throw new Error("database down");
    };
    const audit = new FakeAudit();
    expect((await runCleanUp({ ledger, audit })).ok).toBe(false);
    expect(audit.entries[0]).toMatchObject({ action: "cleanup.run", outcome: "failed" });
  });
});

describe("removeGiverDetails (owner)", () => {
  const setup = async () => {
    const ledger = new FakeLedger();
    const audit = new FakeAudit();
    const giverId = await ledger.createGiver({ fullName: "Kofi", phone: "0551234567", email: "k@x.org" });
    const gift = await ledger.createGift({ reference: "mz_test_abcdef123", churchId: "c1", giftType: "tithe", amountPesewas: 10_000, feePesewas: 301, giverId });
    await ledger.createGift({ reference: "mz_test_anon00001", churchId: "c1", giftType: "tithe", amountPesewas: 500, feePesewas: 15 });
    await ledger.addEvent({ giftId: gift.id, status: "succeeded", providerEventId: "p:1" });
    return { ledger, audit };
  };
  const call = (s: Awaited<ReturnType<typeof setup>>, reference: unknown) => removeGiverDetails({ ...s, actor: "owner:u1", reference });

  it("removes the details but not the gift", async () => {
    const s = await setup();
    const out = await call(s, "mz_test_abcdef123");
    expect(out.status).toBe(200);
    expect(s.ledger.givers[0]).toMatchObject({ fullName: "", phone: "", removed: true });
    expect(s.ledger.givers[0]!.email).toBeUndefined();
    expect(await s.ledger.currentStatus("mz_test_abcdef123")).toMatchObject({ status: "succeeded", wasPaid: true });
    expect(s.audit.entries.at(-1)).toMatchObject({ actor: "owner:u1", action: "owner.giver_details_removed", target: "mz_test_abcdef123", outcome: "ok" });
  });

  it("says plainly when there is nothing to remove, and never puts details in the audit log", async () => {
    const s = await setup();
    await call(s, "mz_test_abcdef123");
    expect((await call(s, "mz_test_abcdef123")).body.message).toMatch(/already removed/);
    expect((await call(s, "mz_test_anon00001")).body.message).toMatch(/anonymous/);
    expect((await call(s, "mz_test_nothere99")).status).toBe(404);
    expect(JSON.stringify(s.audit.entries)).not.toMatch(/Kofi|0551234567|k@x\.org/);
  });

  it("refuses odd input", async () => {
    const s = await setup();
    expect((await call(s, "")).status).toBe(400);
    expect((await call(s, 5)).status).toBe(400);
    expect((await call(s, "a b; drop table")).status).toBe(400);
  });

  it("reports a database failure without claiming success", async () => {
    const s = await setup();
    s.ledger.anonymiseGiverOfGift = async () => {
      throw new Error("down");
    };
    expect((await call(s, "mz_test_abcdef123")).status).toBe(502);
  });
});

describe("ledger (REST): removing details", () => {
  const make = (replies: Parameters<typeof mockFetch>[0]) => {
    const m = mockFetch(replies);
    return { m, l: createSupabaseLedger({ url: "https://x.supabase.co", serviceKey: "sb_secret_abc", fetchFn: m.fn }) };
  };

  it("blanks the three details and marks when, only if not already done", async () => {
    const { m, l } = make([{ json: [{ id: "g1" }] }]);
    expect(await l.anonymiseGiver("11111111-1111-1111-1111-111111111111")).toBe(true);
    expect(m.calls[0]!.method).toBe("PATCH");
    expect(m.calls[0]!.url).toContain("anonymised_at=is.null");
    expect(m.calls[0]!.body).toMatchObject({ full_name: null, phone: null, email: null });
    expect(typeof (m.calls[0]!.body as { anonymised_at: string }).anonymised_at).toBe("string");
  });

  it("finds the giver through the gift reference", async () => {
    const { m, l } = make([{ json: [{ giver_id: "11111111-1111-1111-1111-111111111111" }] }, { json: [] }]);
    expect(await l.anonymiseGiverOfGift("mz_test_abcdef123")).toBe("already");
    expect(m.calls[0]!.url).toContain("gifts?reference=eq.mz_test_abcdef123");
    expect((await make([{ json: [] }]).l.anonymiseGiverOfGift("mz_test_zzzzzzzz"))).toBe("not_found");
    expect((await make([{ json: [{ giver_id: null }] }]).l.anonymiseGiverOfGift("mz_test_anon00001"))).toBe("no_giver");
  });

  it("runs the database clean-up and checks the answer", async () => {
    const { m, l } = make([{ json: { givers: 3, applications: 1 } }]);
    expect(await l.cleanUpOldDetails({ giverDays: 30, applicationDays: 90 })).toEqual({ givers: 3, applications: 1 });
    expect(m.calls[0]!.url).toContain("rpc/maizz_clean_up");
    expect(m.calls[0]!.body).toEqual({ p_giver_days: 30, p_application_days: 90 });
    await expect(make([{ json: { givers: "x" } }]).l.cleanUpOldDetails({ giverDays: 30, applicationDays: 90 })).rejects.toThrow();
    await expect(make([{ status: 500, json: {} }]).l.cleanUpOldDetails({ giverDays: 30, applicationDays: 90 })).rejects.toThrow();
  });
});

describe("ledger (REST): gifts closed too early", () => {
  it("asks only for unpaid abandoned or failed gifts from the last days", async () => {
    const m = mockFetch([{ json: [{ id: "g1", reference: "mz_test_abcdef123", church_id: "c1", amount_pesewas: 10000, fee_pesewas: 301, total_pesewas: 10301, created_at: "2026-10-13T10:00:00Z" }] }]);
    const l = createSupabaseLedger({ url: "https://x.supabase.co", serviceKey: "sb_secret_abc", fetchFn: m.fn });
    const out = await l.listClosedUnpaid({ sinceDays: 3, limit: 100 });
    expect(out).toHaveLength(1);
    expect(m.calls[0]!.url).toContain("was_paid=eq.false");
    expect(m.calls[0]!.url).toContain("status=in.(abandoned,failed)");
    expect(m.calls[0]!.url).toContain("limit=100");
  });
});
