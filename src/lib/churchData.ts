import { assertPesewas } from "./money";

// What a church's own team may see: its paid gifts. Every query is scoped to one church id taken from the signed-in session,
// never from the request. Phone numbers are never read. Anonymous gifts have no giver at all.

export interface DashGift {
  reference: string;
  giftType: string;
  amountPesewas: number;
  refundedPesewas: number;
  status: "succeeded" | "refunded";
  createdAt: string;
  /** Null for an anonymous gift (or one whose giver was anonymised later). */
  giverName: string | null;
}

export interface ChurchData {
  /** Paid gifts, newest first. At most `limit`. */
  listPaidGifts(churchId: string, opts: { sinceIso?: string; limit: number }): Promise<DashGift[]>;
  findPaidGift(churchId: string, reference: string): Promise<DashGift | null>;
}

export class ChurchDataError extends Error {}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function createSupabaseChurchData(opts: { url: string; serviceKey: string; fetchFn?: typeof fetch }): ChurchData {
  const base = `${opts.url.replace(/\/+$/, "")}/rest/v1`;
  const fetchFn = opts.fetchFn ?? fetch;
  const headers: Record<string, string> = { apikey: opts.serviceKey };
  if (opts.serviceKey.startsWith("eyJ")) headers.Authorization = `Bearer ${opts.serviceKey}`;
  const q = encodeURIComponent;

  async function get(path: string): Promise<unknown[]> {
    let res: Response;
    try {
      res = await fetchFn(`${base}/${path}`, { headers, signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new ChurchDataError("Could not reach the database");
    }
    if (!res.ok) throw new ChurchDataError(`Database refused the request (${res.status})`);
    const j: unknown = await res.json();
    if (!Array.isArray(j)) throw new ChurchDataError("Unexpected reply from the database");
    return j;
  }

  async function names(giverIds: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(giverIds)].filter((id) => UUID.test(id));
    const out = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const rows = await get(`givers?id=in.(${chunk.join(",")})&select=id,full_name,anonymised_at`);
      for (const r of rows) {
        if (isRec(r) && typeof r.id === "string" && typeof r.full_name === "string" && r.full_name.trim() && !r.anonymised_at) {
          out.set(r.id, r.full_name.trim());
        }
      }
    }
    return out;
  }

  async function build(rows: unknown[]): Promise<DashGift[]> {
    const parsed = rows.filter(isRec);
    const byGiver = await names(parsed.map((r) => (typeof r.giver_id === "string" ? r.giver_id : "")).filter(Boolean));
    return parsed.map((r) => {
      const amount = Number(r.amount_pesewas);
      const refunded = Number(r.refunded_pesewas ?? 0);
      assertPesewas(amount, "amount");
      assertPesewas(refunded, "refunded");
      return {
        reference: String(r.reference),
        giftType: String(r.gift_type),
        amountPesewas: amount,
        refundedPesewas: refunded,
        status: r.status === "refunded" ? "refunded" : "succeeded",
        createdAt: String(r.created_at),
        giverName: typeof r.giver_id === "string" ? (byGiver.get(r.giver_id) ?? null) : null,
      };
    });
  }

  const COLUMNS = "reference,gift_type,amount_pesewas,refunded_pesewas,status,created_at,giver_id";

  return {
    async listPaidGifts(churchId, o) {
      if (!UUID.test(churchId)) throw new ChurchDataError("Bad church id");
      const since = o.sinceIso ? `&created_at=gte.${q(o.sinceIso)}` : "";
      const limit = Math.max(1, Math.min(o.limit, 5000));
      const rows = await get(
        `gift_status?church_id=eq.${churchId}&was_paid=is.true${since}&select=${COLUMNS}&order=created_at.desc&limit=${limit}`,
      );
      return build(rows);
    },
    async findPaidGift(churchId, reference) {
      if (!UUID.test(churchId) || !/^[A-Za-z0-9_.-]{8,100}$/.test(reference)) return null;
      const rows = await get(`gift_status?church_id=eq.${churchId}&reference=eq.${q(reference)}&was_paid=is.true&select=${COLUMNS}&limit=1`);
      return (await build(rows))[0] ?? null;
    },
  };
}

/** What the church actually keeps from a gift after any refund. */
export function netPesewas(g: DashGift): number {
  return g.amountPesewas - Math.min(g.refundedPesewas, g.amountPesewas);
}

const DAY = 86_400_000;

export interface Summary {
  weekPesewas: number;
  monthPesewas: number;
  totalPesewas: number;
  giftCount: number;
  /** Seven days ending today, oldest first. */
  days: { label: string; pesewas: number }[];
  byType: { type: string; pesewas: number }[];
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Ghana is on UTC all year, so UTC days are Ghana days. */
export function summarise(gifts: DashGift[], nowMs: number): Summary {
  const now = new Date(nowMs);
  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const days = Array.from({ length: 7 }, (_, i) => {
    const start = startOfToday - (6 - i) * DAY;
    return { start, label: WEEKDAY[new Date(start).getUTCDay()]!, pesewas: 0 };
  });
  const types = new Map<string, number>();
  let week = 0;
  let month = 0;
  let total = 0;
  for (const g of gifts) {
    const net = netPesewas(g);
    const at = Date.parse(g.createdAt);
    total += net;
    if (at >= startOfToday - 6 * DAY) {
      week += net;
      const d = days.find((x) => at >= x.start && at < x.start + DAY);
      if (d) d.pesewas += net;
    }
    if (at >= monthStart) {
      month += net;
      types.set(g.giftType, (types.get(g.giftType) ?? 0) + net);
    }
  }
  return {
    weekPesewas: week,
    monthPesewas: month,
    totalPesewas: total,
    giftCount: gifts.length,
    days: days.map(({ label, pesewas }) => ({ label, pesewas })),
    byType: [...types.entries()].map(([type, pesewas]) => ({ type, pesewas })).sort((a, b) => b.pesewas - a.pesewas),
  };
}

function csvCell(v: string): string {
  // A leading = + - @ can run as a formula when the file is opened in a spreadsheet, so it is defused.
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function giftsToCsv(gifts: DashGift[], typeLabel: (t: string) => string): string {
  const rows = [["Reference", "Date (UTC)", "Gift type", "Gift (GHS)", "Refunded (GHS)", "Status", "Giver"]];
  const cedis = (p: number) => `${Math.floor(p / 100)}.${String(p % 100).padStart(2, "0")}`;
  for (const g of gifts) {
    rows.push([
      g.reference,
      g.createdAt.slice(0, 19).replace("T", " "),
      typeLabel(g.giftType),
      cedis(g.amountPesewas),
      cedis(Math.min(g.refundedPesewas, g.amountPesewas)),
      g.status === "refunded" ? "Refunded" : "Paid",
      g.giverName ?? "Anonymous",
    ]);
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
