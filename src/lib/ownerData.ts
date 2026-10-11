import { assertPesewas } from "./money";

// What the Maizz owner sees across every church: totals, Maizz's own fee earnings, problem gifts, applications and recent alerts.
// Only the owner's signed-in pages read this. No giver names, phones or emails are read here.

export interface PlatformGift {
  churchId: string;
  createdAt: string;
  amountPesewas: number;
  feePesewas: number;
  maizzFeePesewas: number;
  refundedPesewas: number;
}

export interface Application {
  id: string;
  churchName: string;
  town: string | null;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  note: string | null;
  status: "new" | "accepted" | "declined";
  churchId: string | null;
  createdAt: string;
}

export interface NewApplication {
  churchName: string;
  town?: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  note?: string;
}

export interface ActivityRow {
  at: string;
  actor: string;
  action: string;
  outcome: string;
}

export interface ProblemCounts {
  /** Gifts that failed or were abandoned in the last 7 days. */
  failedWeek: number;
  /** Gifts still waiting for an answer for more than 30 minutes (last 7 days). */
  waiting: number;
  /** Gifts refunded in the last 7 days. */
  refundedWeek: number;
}

export interface OwnerData {
  /** Paid gifts, newest first, at most `limit`. */
  listPaidGifts(opts: { limit: number }): Promise<PlatformGift[]>;
  problemCounts(nowMs: number): Promise<ProblemCounts>;
  listApplications(): Promise<Application[]>;
  getApplication(id: string): Promise<Application | null>;
  createApplication(a: NewApplication): Promise<string>;
  /** Moves an application from "new" to its decision. True only for the one caller that wins. */
  claimApplication(id: string, to: "accepted" | "declined"): Promise<boolean>;
  /** Puts a claimed application back to "new" (used if the church could not be created). */
  releaseApplication(id: string): Promise<void>;
  attachChurch(applicationId: string, churchId: string): Promise<void>;
  recentActivity(limit: number): Promise<ActivityRow[]>;
  /** When the daily check last ran (ISO text), or null. */
  lastDailyCheck(): Promise<string | null>;
}

export class OwnerDataError extends Error {}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY = 86_400_000;

function toApplication(r: unknown): Application {
  if (!isRec(r) || typeof r.id !== "string" || typeof r.church_name !== "string") {
    throw new OwnerDataError("Unexpected application row from the database");
  }
  return {
    id: r.id,
    churchName: r.church_name,
    town: typeof r.town === "string" && r.town ? r.town : null,
    contactName: String(r.contact_name ?? ""),
    contactEmail: String(r.contact_email ?? ""),
    contactPhone: String(r.contact_phone ?? ""),
    note: typeof r.note === "string" && r.note ? r.note : null,
    status: r.status === "accepted" || r.status === "declined" ? r.status : "new",
    churchId: typeof r.church_id === "string" ? r.church_id : null,
    createdAt: String(r.created_at ?? ""),
  };
}

export function createSupabaseOwnerData(opts: { url: string; serviceKey: string; fetchFn?: typeof fetch }): OwnerData {
  const base = `${opts.url.replace(/\/+$/, "")}/rest/v1`;
  const fetchFn = opts.fetchFn ?? fetch;
  const headers: Record<string, string> = { apikey: opts.serviceKey, "Content-Type": "application/json" };
  if (opts.serviceKey.startsWith("eyJ")) headers.Authorization = `Bearer ${opts.serviceKey}`;
  const q = encodeURIComponent;

  async function call(method: "GET" | "POST" | "PATCH", path: string, body?: unknown, prefer?: string): Promise<Response> {
    try {
      return await fetchFn(`${base}/${path}`, {
        method,
        headers: prefer ? { ...headers, Prefer: prefer } : headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new OwnerDataError("Could not reach the database");
    }
  }

  async function rows(res: Response, what: string): Promise<unknown[]> {
    if (!res.ok) throw new OwnerDataError(`Database refused ${what} (${res.status})`);
    const j: unknown = await res.json();
    if (!Array.isArray(j)) throw new OwnerDataError(`Unexpected reply for ${what}`);
    return j;
  }

  const get = async (path: string, what: string) => rows(await call("GET", path), what);

  return {
    async listPaidGifts({ limit }) {
      const n = Math.max(1, Math.min(limit, 5000));
      const list = await get(
        `gift_status?was_paid=is.true&select=church_id,created_at,amount_pesewas,fee_pesewas,maizz_fee_pesewas,refunded_pesewas&order=created_at.desc&limit=${n}`,
        "gift list",
      );
      return list.filter(isRec).map((r) => {
        const amount = Number(r.amount_pesewas);
        const fee = Number(r.fee_pesewas);
        const maizz = Number(r.maizz_fee_pesewas ?? 0);
        const refunded = Number(r.refunded_pesewas ?? 0);
        assertPesewas(amount, "amount");
        assertPesewas(fee, "fee");
        assertPesewas(maizz, "Maizz fee");
        assertPesewas(refunded, "refunded");
        return {
          churchId: String(r.church_id),
          createdAt: String(r.created_at),
          amountPesewas: amount,
          feePesewas: fee,
          maizzFeePesewas: maizz,
          refundedPesewas: refunded,
        };
      });
    },

    async problemCounts(nowMs) {
      const week = q(new Date(nowMs - 7 * DAY).toISOString());
      const half = q(new Date(nowMs - 30 * 60_000).toISOString());
      const [failed, waiting, refunded] = await Promise.all([
        get(`gift_status?status=in.(failed,abandoned)&created_at=gte.${week}&select=gift_id&limit=1000`, "failed gifts"),
        get(`gift_status?status=eq.pending&created_at=gte.${week}&created_at=lt.${half}&select=gift_id&limit=1000`, "waiting gifts"),
        get(`gift_status?status=eq.refunded&created_at=gte.${week}&select=gift_id&limit=1000`, "refunded gifts"),
      ]);
      return { failedWeek: failed.length, waiting: waiting.length, refundedWeek: refunded.length };
    },

    async listApplications() {
      return (await get("church_applications?select=*&order=created_at.desc&limit=200", "application list")).map(toApplication);
    },

    async getApplication(id) {
      if (!UUID.test(id)) return null;
      const r = (await get(`church_applications?id=eq.${id}&select=*&limit=1`, "application lookup"))[0];
      return r === undefined ? null : toApplication(r);
    },

    async createApplication(a) {
      const res = await call(
        "POST",
        "church_applications",
        {
          church_name: a.churchName,
          town: a.town || null,
          contact_name: a.contactName,
          contact_email: a.contactEmail,
          contact_phone: a.contactPhone,
          note: a.note || null,
        },
        "return=representation",
      );
      const created = (await rows(res, "application"))[0];
      if (!isRec(created) || typeof created.id !== "string") throw new OwnerDataError("Application was not saved");
      return created.id;
    },

    async claimApplication(id, to) {
      if (!UUID.test(id)) return false;
      const res = await call(
        "PATCH",
        `church_applications?id=eq.${id}&status=eq.new`,
        { status: to, decided_at: new Date().toISOString() },
        "return=representation",
      );
      return (await rows(res, "application decision")).length === 1;
    },

    async releaseApplication(id) {
      if (!UUID.test(id)) return;
      await rows(
        await call("PATCH", `church_applications?id=eq.${id}&church_id=is.null`, { status: "new", decided_at: null }, "return=representation"),
        "application release",
      );
    },

    async attachChurch(applicationId, churchId) {
      if (!UUID.test(applicationId) || !UUID.test(churchId)) throw new OwnerDataError("Bad id");
      await rows(await call("PATCH", `church_applications?id=eq.${applicationId}`, { church_id: churchId }, "return=representation"), "application link");
    },

    async recentActivity(limit) {
      const n = Math.max(1, Math.min(limit, 100));
      // Alerts that were sent, and anything refused or failed. The audit log never holds names, phones, emails or keys.
      const list = await get(
        `audit_log?or=(action.like.alert.sent.*,outcome.in.(denied,failed))&select=at,actor,action,outcome&order=id.desc&limit=${n}`,
        "activity",
      );
      return list.filter(isRec).map((r) => ({
        at: String(r.at),
        actor: String(r.actor),
        action: String(r.action),
        outcome: String(r.outcome),
      }));
    },

    async lastDailyCheck() {
      const r = (await get("audit_log?action=eq.reconcile.run&select=at&order=id.desc&limit=1", "daily check"))[0];
      return isRec(r) && typeof r.at === "string" ? r.at : null;
    },
  };
}

export interface ChurchStat {
  weekPesewas: number;
  monthPesewas: number;
  totalPesewas: number;
  giftCount: number;
  lastGiftAt: string | null;
}

export interface PlatformSummary {
  todayPesewas: number;
  weekPesewas: number;
  monthPesewas: number;
  totalPesewas: number;
  giftCount: number;
  /** Everything givers paid in fees on paid gifts. */
  feesPesewas: number;
  /** Maizz's own part of those fees, this month and all time. */
  maizzFeeMonthPesewas: number;
  maizzFeeTotalPesewas: number;
  byChurch: Map<string, ChurchStat>;
}

const net = (g: PlatformGift) => g.amountPesewas - Math.min(g.refundedPesewas, g.amountPesewas);

/** Ghana is on UTC all year, so UTC days are Ghana days. Gifts are what the churches receive, less refunds. */
export function platformSummary(gifts: PlatformGift[], nowMs: number): PlatformSummary {
  const now = new Date(nowMs);
  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const out: PlatformSummary = {
    todayPesewas: 0,
    weekPesewas: 0,
    monthPesewas: 0,
    totalPesewas: 0,
    giftCount: gifts.length,
    feesPesewas: 0,
    maizzFeeMonthPesewas: 0,
    maizzFeeTotalPesewas: 0,
    byChurch: new Map(),
  };
  for (const g of gifts) {
    const at = Date.parse(g.createdAt);
    const n = net(g);
    out.totalPesewas += n;
    out.feesPesewas += g.feePesewas;
    out.maizzFeeTotalPesewas += g.maizzFeePesewas;
    const c = out.byChurch.get(g.churchId) ?? { weekPesewas: 0, monthPesewas: 0, totalPesewas: 0, giftCount: 0, lastGiftAt: null };
    c.totalPesewas += n;
    c.giftCount += 1;
    if (!c.lastGiftAt || at > Date.parse(c.lastGiftAt)) c.lastGiftAt = g.createdAt;
    if (at >= startOfToday) out.todayPesewas += n;
    if (at >= startOfToday - 6 * DAY) {
      out.weekPesewas += n;
      c.weekPesewas += n;
    }
    if (at >= monthStart) {
      out.monthPesewas += n;
      out.maizzFeeMonthPesewas += g.maizzFeePesewas;
      c.monthPesewas += n;
    }
    out.byChurch.set(g.churchId, c);
  }
  return out;
}
