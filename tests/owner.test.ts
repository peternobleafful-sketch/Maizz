import { describe, expect, it } from "vitest";
import { createSupabaseOwnerData, platformSummary, type PlatformGift } from "../src/lib/ownerData";
import { createStaffService, type Mailer } from "../src/lib/staff";
import { createSupabaseStaffStore } from "../src/lib/staffStore";
import { FakeAudit, FakeStaffStore, mockFetch } from "./helpers";

const NOW = Date.UTC(2026, 9, 14, 12, 0, 0); // Wed 14 Oct 2026, noon
const iso = (daysAgo: number, hour = 9) => new Date(Date.UTC(2026, 9, 14 - daysAgo, hour)).toISOString();
const gift = (over: Partial<PlatformGift> = {}): PlatformGift => ({
  churchId: "c1",
  createdAt: iso(0),
  amountPesewas: 10_000,
  feePesewas: 301,
  maizzFeePesewas: 100,
  refundedPesewas: 0,
  ...over,
});

describe("platformSummary", () => {
  it("adds up today, the week, the month and all time, less refunds", () => {
    const s = platformSummary(
      [
        gift({ createdAt: iso(0) }),
        gift({ createdAt: iso(3), amountPesewas: 5_000, refundedPesewas: 2_000 }),
        gift({ createdAt: iso(10), amountPesewas: 7_000 }),
        gift({ createdAt: iso(40), amountPesewas: 1_000 }),
      ],
      NOW,
    );
    expect(s.todayPesewas).toBe(10_000);
    expect(s.weekPesewas).toBe(13_000);
    expect(s.monthPesewas).toBe(20_000); // 14 Oct, 11 Oct and 4 Oct are in October
    expect(s.totalPesewas).toBe(21_000);
    expect(s.giftCount).toBe(4);
  });

  it("counts Maizz's own fee separately from all fees", () => {
    const s = platformSummary([gift(), gift({ createdAt: iso(40) })], NOW);
    expect(s.feesPesewas).toBe(602);
    expect(s.maizzFeeTotalPesewas).toBe(200);
    expect(s.maizzFeeMonthPesewas).toBe(100);
  });

  it("never lets a refund take a gift below zero, and splits by church", () => {
    const s = platformSummary(
      [gift({ amountPesewas: 1_000, refundedPesewas: 9_000 }), gift({ churchId: "c2", amountPesewas: 2_500 }), gift({ churchId: "c2", amountPesewas: 500, createdAt: iso(1) })],
      NOW,
    );
    expect(s.totalPesewas).toBe(3_000);
    expect(s.byChurch.get("c1")).toMatchObject({ totalPesewas: 0, giftCount: 1 });
    expect(s.byChurch.get("c2")).toMatchObject({ totalPesewas: 3_000, giftCount: 2, weekPesewas: 3_000 });
    expect(s.byChurch.get("c2")!.lastGiftAt).toBe(iso(0));
  });

  it("handles no gifts", () => {
    const s = platformSummary([], NOW);
    expect(s.totalPesewas).toBe(0);
    expect(s.byChurch.size).toBe(0);
  });
});

const row = (over: Record<string, unknown> = {}) => ({
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  church_name: "Grace Chapel",
  town: "Accra",
  contact_name: "Ama",
  contact_email: "ama@grace.org",
  contact_phone: "0551234987",
  note: null,
  status: "new",
  church_id: null,
  created_at: iso(1),
  ...over,
});

describe("owner data (REST)", () => {
  const make = (replies: Parameters<typeof mockFetch>[0]) => {
    const m = mockFetch(replies);
    return { m, data: createSupabaseOwnerData({ url: "https://x.supabase.co", serviceKey: "sb_secret_abc", fetchFn: m.fn }) };
  };

  it("reads paid gifts without any giver detail", async () => {
    const { m, data } = make([
      { json: [{ church_id: "c1", created_at: iso(0), amount_pesewas: 10000, fee_pesewas: 301, maizz_fee_pesewas: 100, refunded_pesewas: 0 }] },
    ]);
    const g = await data.listPaidGifts({ limit: 99_999 });
    expect(g).toEqual([{ churchId: "c1", createdAt: iso(0), amountPesewas: 10000, feePesewas: 301, maizzFeePesewas: 100, refundedPesewas: 0 }]);
    expect(m.calls[0]!.url).toContain("was_paid=is.true");
    expect(m.calls[0]!.url).toContain("limit=5000");
    expect(m.calls[0]!.url).not.toMatch(/giver|phone|email/);
  });

  it("refuses a gift with a decimal amount", async () => {
    const { data } = make([{ json: [{ church_id: "c1", created_at: iso(0), amount_pesewas: 100.5, fee_pesewas: 1, maizz_fee_pesewas: 0, refunded_pesewas: 0 }] }]);
    await expect(data.listPaidGifts({ limit: 10 })).rejects.toThrow();
  });

  it("counts problem gifts", async () => {
    const { data } = make([{ json: [{}, {}] }, { json: [{}] }, { json: [] }]);
    expect(await data.problemCounts(NOW)).toEqual({ failedWeek: 2, waiting: 1, refundedWeek: 0 });
  });

  it("saves an application with only the fields it should", async () => {
    const { m, data } = make([{ status: 201, json: [row()] }]);
    const id = await data.createApplication({ churchName: "Grace Chapel", contactName: "Ama", contactEmail: "ama@grace.org", contactPhone: "0551234987" });
    expect(id).toBe(row().id);
    expect(Object.keys(m.calls[0]!.body as object).sort()).toEqual(["church_name", "contact_email", "contact_name", "contact_phone", "note", "town"]);
  });

  it("lets only one caller win a decision", async () => {
    const win = make([{ json: [row({ status: "accepted" })] }]);
    expect(await win.data.claimApplication(row().id, "accepted")).toBe(true);
    expect(win.m.calls[0]!.url).toContain("status=eq.new");
    const lose = make([{ json: [] }]);
    expect(await lose.data.claimApplication(row().id, "accepted")).toBe(false);
    const bad = make([]);
    expect(await bad.data.claimApplication("not-an-id", "accepted")).toBe(false);
  });

  it("only releases an application that has no church yet", async () => {
    const { m, data } = make([{ json: [row()] }]);
    await data.releaseApplication(row().id);
    expect(m.calls[0]!.url).toContain("church_id=is.null");
  });

  it("reads alerts and refused attempts from the audit log", async () => {
    const { m, data } = make([{ json: [{ at: iso(0), actor: "alerts", action: "alert.sent.large_gift", outcome: "ok" }] }]);
    expect(await data.recentActivity(500)).toHaveLength(1);
    expect(m.calls[0]!.url).toContain("limit=100");
  });
});

describe("owner store (REST)", () => {
  it("uses its own tables and has no church", async () => {
    const m = mockFetch([
      { status: 201, json: [{ id: "u1", email: "isaac@maizz.test", full_name: "Isaac", status: "invited", password_hash: null, failed_attempts: 0, locked_until: null }] },
      { status: 201, json: [{ id: "t1" }] },
      { json: [{ id: "t1", user_id: "u1", kind: "session", token_hash: "h", attempts: 0, expires_at: iso(0), used_at: null }] },
    ]);
    const store = createSupabaseStaffStore({ url: "https://x.supabase.co", serviceKey: "sb_secret_abc", fetchFn: m.fn, area: "owner" });
    const u = await store.createUser({ churchId: "platform", email: "isaac@maizz.test", fullName: "Isaac", role: "owner" });
    expect(u).toMatchObject({ churchId: "platform", role: "owner" });
    expect(m.calls[0]!.url).toContain("/owner_users");
    expect(m.calls[0]!.body).toEqual({ email: "isaac@maizz.test", full_name: "Isaac" });
    await store.createToken({ userId: "u1", kind: "session", tokenHash: "h", expiresAt: Date.now() + 1000 });
    expect(m.calls[1]!.url).toContain("/owner_tokens");
    await store.findTokenByHash("session", "h");
    expect(m.calls[2]!.url).toContain("owner_tokens?kind=eq.session");
  });

  it("church people still use the church tables", async () => {
    const m = mockFetch([{ json: [] }]);
    const store = createSupabaseStaffStore({ url: "https://x.supabase.co", serviceKey: "sb_secret_abc", fetchFn: m.fn });
    await store.findUserByEmail("a@b.co");
    expect(m.calls[0]!.url).toContain("church_users?email=eq.");
  });
});

describe("owner sign-in service", () => {
  const setup = () => {
    const store = new FakeStaffStore();
    const audit = new FakeAudit();
    const sent: { to: string; subject: string; text: string }[] = [];
    const alerts: string[] = [];
    const mailer: Mailer = { send: async (m) => void sent.push(m) };
    const svc = createStaffService({ store, audit, mailer, pepper: "p".repeat(40), area: "owner", alert: async (k) => void alerts.push(k) });
    return { store, audit, sent, alerts, svc };
  };

  it("sends links to the owner pages and says it is for Maizz", async () => {
    const { svc, sent } = setup();
    await svc.invite({ churchId: "platform", churchName: "Maizz", email: "isaac@maizz.test", fullName: "Isaac", role: "owner", baseUrl: "https://m.test" });
    expect(sent[0]!.subject).toBe("You are invited to run Maizz");
    expect(sent[0]!.text).toContain("https://m.test/owner/invite?token=");
    expect(sent[0]!.text).not.toMatch(/church owner|church/i);
    const token = /token=([\w-]+)/.exec(sent[0]!.text)![1]!;
    expect(await svc.acceptInvite(token, "correct horse battery")).toEqual({ ok: true });
    await svc.requestReset("isaac@maizz.test", "https://m.test", "src");
    expect(sent.at(-1)!.text).toContain("https://m.test/owner/reset?token=");
  });

  it("records owner actions under an owner actor, and raises the owner lock alert", async () => {
    const { svc, sent, audit, alerts } = setup();
    await svc.invite({ churchId: "platform", churchName: "Maizz", email: "isaac@maizz.test", fullName: "Isaac", role: "owner", baseUrl: "https://m.test" });
    await svc.acceptInvite(/token=([\w-]+)/.exec(sent[0]!.text)![1]!, "correct horse battery");
    for (let i = 0; i < 20; i += 1) await svc.signIn("isaac@maizz.test", "wrong wrong wrong", `src${i}`);
    expect(audit.entries.some((e) => e.actor.startsWith("owner:"))).toBe(true);
    expect(audit.entries.some((e) => e.actor.startsWith("staff:"))).toBe(false);
    expect(alerts).toEqual(["owner_locked"]);
  });
});
