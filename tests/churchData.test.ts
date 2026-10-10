import { describe, expect, it } from "vitest";
import { createSupabaseChurchData, giftsToCsv, netPesewas, summarise, type DashGift } from "../src/lib/churchData";
import { mockFetch } from "./helpers";

const CHURCH = "11111111-1111-1111-1111-111111111111";
const GIVER = "22222222-2222-2222-2222-222222222222";

const gift = (over: Partial<DashGift> = {}): DashGift => ({
  reference: "MZ-AAAA-0001",
  giftType: "tithe",
  amountPesewas: 10_000,
  refundedPesewas: 0,
  status: "succeeded",
  createdAt: "2026-10-10T10:00:00.000Z",
  giverName: "Ama Boateng",
  ...over,
});

describe("church data: reading gifts", () => {
  const row = { reference: "MZ-AAAA-0001", gift_type: "tithe", amount_pesewas: 10000, refunded_pesewas: 0, status: "succeeded", created_at: "2026-10-10T10:00:00+00:00", giver_id: GIVER };

  it("asks only for this church's paid gifts and never reads phone numbers", async () => {
    const m = mockFetch([{ json: [row, { ...row, reference: "MZ-AAAA-0002", giver_id: null }] }, { json: [{ id: GIVER, full_name: "Ama Boateng", anonymised_at: null }] }]);
    const d = createSupabaseChurchData({ url: "https://x.supabase.co", serviceKey: "sb_secret_a", fetchFn: m.fn });
    const gifts = await d.listPaidGifts(CHURCH, { limit: 50 });
    expect(m.calls[0]!.url).toContain(`church_id=eq.${CHURCH}`);
    expect(m.calls[0]!.url).toContain("was_paid=is.true");
    expect(m.calls[1]!.url).toContain("select=id,full_name,anonymised_at");
    expect(m.calls.map((c) => c.url).join()).not.toMatch(/phone/);
    expect(gifts.map((g) => g.giverName)).toEqual(["Ama Boateng", null]);
  });

  it("shows an anonymised giver as anonymous", async () => {
    const m = mockFetch([{ json: [row] }, { json: [{ id: GIVER, full_name: "Ama", anonymised_at: "2026-10-11T00:00:00Z" }] }]);
    const d = createSupabaseChurchData({ url: "https://x.supabase.co", serviceKey: "sb_secret_a", fetchFn: m.fn });
    expect((await d.listPaidGifts(CHURCH, { limit: 5 }))[0]!.giverName).toBeNull();
  });

  it("refuses a church id that is not a plain id, so nothing can be injected into the query", async () => {
    const m = mockFetch([]);
    const d = createSupabaseChurchData({ url: "https://x.supabase.co", serviceKey: "sb_secret_a", fetchFn: m.fn });
    await expect(d.listPaidGifts("x&church_id=neq.1", { limit: 5 })).rejects.toThrow();
    expect(await d.findPaidGift(CHURCH, "bad ref&x=1")).toBeNull();
    expect(m.calls).toHaveLength(0);
  });

  it("looks a gift up by reference inside the church", async () => {
    const m = mockFetch([{ json: [row] }, { json: [] }]);
    const d = createSupabaseChurchData({ url: "https://x.supabase.co", serviceKey: "sb_secret_a", fetchFn: m.fn });
    const g = await d.findPaidGift(CHURCH, "MZ-AAAA-0001");
    expect(m.calls[0]!.url).toContain(`church_id=eq.${CHURCH}`);
    expect(m.calls[0]!.url).toContain("reference=eq.MZ-AAAA-0001");
    expect(g?.giverName).toBeNull();
  });
});

describe("church data: totals", () => {
  const now = Date.parse("2026-10-10T15:00:00Z");

  it("takes refunds off, never more than the gift", () => {
    expect(netPesewas(gift({ refundedPesewas: 2_500 }))).toBe(7_500);
    expect(netPesewas(gift({ refundedPesewas: 99_999 }))).toBe(0);
  });

  it("adds up the week, the month, all time and each day", () => {
    const s = summarise(
      [
        gift({ createdAt: "2026-10-10T09:00:00Z", amountPesewas: 10_000 }),
        gift({ createdAt: "2026-10-09T09:00:00Z", amountPesewas: 5_000, giftType: "offering" }),
        gift({ createdAt: "2026-10-02T09:00:00Z", amountPesewas: 7_000, giftType: "offering" }),
        gift({ createdAt: "2026-09-20T09:00:00Z", amountPesewas: 20_000 }),
        gift({ createdAt: "2026-10-10T08:00:00Z", amountPesewas: 3_000, refundedPesewas: 3_000, status: "refunded" }),
      ],
      now,
    );
    expect(s.weekPesewas).toBe(15_000);
    expect(s.monthPesewas).toBe(22_000);
    expect(s.totalPesewas).toBe(42_000);
    expect(s.giftCount).toBe(5);
    expect(s.days).toHaveLength(7);
    expect(s.days.at(-1)).toEqual({ label: "Sat", pesewas: 10_000 });
    expect(s.days.at(-2)).toEqual({ label: "Fri", pesewas: 5_000 });
    expect(s.byType).toEqual([
      { type: "offering", pesewas: 12_000 },
      { type: "tithe", pesewas: 10_000 },
    ]);
  });

  it("is all zeros with no gifts", () => {
    const s = summarise([], now);
    expect([s.weekPesewas, s.monthPesewas, s.totalPesewas, s.giftCount]).toEqual([0, 0, 0, 0]);
  });
});

describe("church data: CSV download", () => {
  const label = (t: string) => t.toUpperCase();

  it("lists gifts with Anonymous for anonymous givers and no phone column", () => {
    const csv = giftsToCsv([gift(), gift({ reference: "MZ-AAAA-0002", giverName: null, refundedPesewas: 500, status: "refunded" })], label);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("Reference,Date (UTC),Gift type,Gift (GHS),Refunded (GHS),Status,Giver");
    expect(lines[1]).toBe("MZ-AAAA-0001,2026-10-10 10:00:00,TITHE,100.00,0.00,Paid,Ama Boateng");
    expect(lines[2]).toBe("MZ-AAAA-0002,2026-10-10 10:00:00,TITHE,100.00,5.00,Refunded,Anonymous");
    expect(csv.toLowerCase()).not.toContain("phone");
  });

  it("defuses spreadsheet formulas and quotes commas", () => {
    const csv = giftsToCsv([gift({ giverName: '=HYPERLINK("http://evil")' }), gift({ giverName: "Doe, John" }), gift({ giverName: "+233" })], label);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain('"Doe, John"');
    expect(csv).toContain("'+233");
  });
});
