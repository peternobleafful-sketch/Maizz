import { assertPesewas } from "./money";

// The only code that writes to the ledger. It talks to Supabase using the server's secret key.
// The database itself refuses edits and deletes (see supabase/migrations/0001_ledger.sql).

export const GIFT_TYPES = ["tithe", "offering", "thanksgiving", "seed", "building", "missions", "other"] as const;
// "project" is an older value that stays valid in the database but is no longer offered.
export type GiftType = (typeof GIFT_TYPES)[number] | "project";
export type EventStatus = "pending" | "succeeded" | "failed" | "abandoned" | "refunded";

export interface GiftRecord {
  id: string;
  reference: string;
  churchId: string;
  amountPesewas: number;
  feePesewas: number;
  totalPesewas: number;
  /** When the gift was started (ISO text). */
  createdAt: string;
}

export interface NewGift {
  reference: string;
  churchId: string;
  giftType: GiftType;
  amountPesewas: number;
  feePesewas: number;
  /** Maizz's own part of the fee (the rest covers the payment provider). */
  maizzFeePesewas?: number;
  /** Leave out for an anonymous gift: nothing about the giver is stored. */
  giverId?: string;
}

export type ChurchStatus = "pending" | "active" | "suspended";

export interface ChurchRecord {
  id: string;
  slug: string;
  name: string;
  status: ChurchStatus;
  /** The payment provider's code for the church's payout account. Null until payout is set up. */
  subaccountCode: string | null;
  payoutBankName: string | null;
  /** Only the last 4 digits are kept. The provider holds the rest. */
  payoutAccountLast4: string | null;
  /** The account holder's name as the provider found it. */
  payoutAccountName: string | null;
}

export interface NewPayout {
  subaccountCode: string;
  bankCode: string;
  bankName: string;
  accountLast4: string;
  accountName: string;
}

export interface NewGiver {
  fullName: string;
  phone: string;
}

export interface NewEvent {
  giftId: string;
  status: EventStatus;
  amountPesewas?: number;
  providerEventId?: string;
  detail?: Record<string, unknown>;
}

export interface Ledger {
  getOrCreateChurch(slug: string, name: string): Promise<string>;
  /** Looks a church up without ever creating one. */
  findChurch(slug: string): Promise<ChurchRecord | null>;
  /** New churches start as "pending" and cannot receive gifts. Throws if the slug is taken. */
  createChurch(church: { slug: string; name: string }): Promise<ChurchRecord>;
  listChurches(): Promise<ChurchRecord[]>;
  setChurchPayout(churchId: string, payout: NewPayout): Promise<void>;
  setChurchStatus(churchId: string, status: ChurchStatus): Promise<void>;
  createGiver(giver: NewGiver): Promise<string>;
  createGift(gift: NewGift): Promise<GiftRecord>;
  findGiftByReference(reference: string): Promise<GiftRecord | null>;
  /** "duplicate" means this provider event was already recorded, which is fine. */
  addEvent(event: NewEvent): Promise<"added" | "duplicate">;
  currentStatus(
    reference: string,
  ): Promise<{ status: EventStatus; wasPaid: boolean; refundedPesewas: number } | null>;
  /** Gifts still waiting for an answer (never paid), started between the two limits. Oldest first. */
  listUnsettled(opts: { olderThanMinutes: number; newerThanDays: number; limit: number }): Promise<GiftRecord[]>;
  /** Gifts marked paid in the last few days, newest first. Used to double-check the books. */
  listRecentPaid(opts: { sinceDays: number; limit: number }): Promise<GiftRecord[]>;
}

export class LedgerError extends Error {}

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pesewas(v: unknown, label: string): number {
  const n = typeof v === "string" ? Number(v) : v;
  assertPesewas(n, label);
  return n;
}

function toGift(row: unknown): GiftRecord {
  if (!isRec(row) || typeof row.id !== "string" || typeof row.reference !== "string" || typeof row.church_id !== "string") {
    throw new LedgerError("Unexpected gift row from the database");
  }
  return {
    id: row.id,
    reference: row.reference,
    churchId: row.church_id,
    amountPesewas: pesewas(row.amount_pesewas, "amount"),
    feePesewas: pesewas(row.fee_pesewas, "fee"),
    totalPesewas: pesewas(row.total_pesewas, "total"),
    createdAt: typeof row.created_at === "string" ? row.created_at : "",
  };
}

const CHURCH_COLUMNS =
  "id,slug,name,status,provider_subaccount_code,payout_bank_name,payout_account_last4,payout_account_name";

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function toChurch(row: unknown): ChurchRecord {
  if (
    !isRec(row) ||
    typeof row.id !== "string" ||
    typeof row.slug !== "string" ||
    typeof row.name !== "string" ||
    (row.status !== "pending" && row.status !== "active" && row.status !== "suspended")
  ) {
    throw new LedgerError("Unexpected church row from the database");
  }
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    subaccountCode: str(row.provider_subaccount_code),
    payoutBankName: str(row.payout_bank_name),
    payoutAccountLast4: str(row.payout_account_last4),
    payoutAccountName: str(row.payout_account_name),
  };
}

export function createSupabaseLedger(opts: {
  url: string;
  serviceKey: string;
  fetchFn?: typeof fetch;
}): Ledger {
  const base = `${opts.url.replace(/\/+$/, "")}/rest/v1`;
  const fetchFn = opts.fetchFn ?? fetch;

  const headers: Record<string, string> = { apikey: opts.serviceKey, "Content-Type": "application/json" };
  // Legacy keys are JWTs and go in Authorization too. New sb_secret_ keys use apikey only.
  if (opts.serviceKey.startsWith("eyJ")) headers.Authorization = `Bearer ${opts.serviceKey}`;

  async function request(method: "GET" | "POST" | "PATCH", path: string, body?: unknown, prefer?: string): Promise<Response> {
    try {
      return await fetchFn(`${base}/${path}`, {
        method,
        headers: prefer ? { ...headers, Prefer: prefer } : headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new LedgerError("Could not reach the database");
    }
  }

  async function isUniqueViolation(res: Response): Promise<boolean> {
    if (res.status !== 409) return false;
    try {
      const j: unknown = await res.json();
      return isRec(j) && j.code === "23505";
    } catch {
      return false;
    }
  }

  async function rows(res: Response, what: string): Promise<unknown[]> {
    if (!res.ok) throw new LedgerError(`Database refused ${what} (${res.status})`);
    const j: unknown = await res.json();
    if (!Array.isArray(j)) throw new LedgerError(`Unexpected reply for ${what}`);
    return j;
  }

  async function churchId(slug: string): Promise<string | null> {
    const res = await request("GET", `churches?slug=eq.${encodeURIComponent(slug)}&select=id&limit=1`);
    const found = (await rows(res, "church lookup"))[0];
    return isRec(found) && typeof found.id === "string" ? found.id : null;
  }

  return {
    async findChurch(slug) {
      const res = await request("GET", `churches?slug=eq.${encodeURIComponent(slug)}&select=${CHURCH_COLUMNS}&limit=1`);
      const found = (await rows(res, "church lookup"))[0];
      return found === undefined ? null : toChurch(found);
    },

    async createChurch(church) {
      const res = await request("POST", "churches", { slug: church.slug, name: church.name }, "return=representation");
      if (await isUniqueViolation(res)) throw new LedgerError("A church with that web address already exists");
      return toChurch((await rows(res, "church creation"))[0]);
    },

    async listChurches() {
      const res = await request("GET", `churches?select=${CHURCH_COLUMNS}&order=created_at.asc&limit=500`);
      return (await rows(res, "church list")).map(toChurch);
    },

    async setChurchPayout(churchId, payout) {
      const res = await request(
        "PATCH",
        `churches?id=eq.${encodeURIComponent(churchId)}`,
        {
          provider_subaccount_code: payout.subaccountCode,
          payout_bank_code: payout.bankCode,
          payout_bank_name: payout.bankName,
          payout_account_last4: payout.accountLast4,
          payout_account_name: payout.accountName,
        },
        "return=representation",
      );
      if ((await rows(res, "payout setup")).length !== 1) throw new LedgerError("That church was not found");
    },

    async setChurchStatus(churchId, status) {
      const res = await request("PATCH", `churches?id=eq.${encodeURIComponent(churchId)}`, { status }, "return=representation");
      if ((await rows(res, "status change")).length !== 1) throw new LedgerError("That church was not found");
    },

    async createGiver(giver) {
      const res = await request("POST", "givers", { full_name: giver.fullName, phone: giver.phone }, "return=representation");
      const created = (await rows(res, "giver creation"))[0];
      if (!isRec(created) || typeof created.id !== "string") throw new LedgerError("Giver was not created");
      return created.id;
    },

    async getOrCreateChurch(slug, name) {
      const existing = await churchId(slug);
      if (existing) return existing;
      const res = await request("POST", "churches", { slug, name }, "return=representation");
      if (await isUniqueViolation(res)) {
        const again = await churchId(slug);
        if (again) return again;
      }
      const created = (await rows(res, "church creation"))[0];
      if (!isRec(created) || typeof created.id !== "string") throw new LedgerError("Church was not created");
      return created.id;
    },

    async createGift(gift) {
      assertPesewas(gift.amountPesewas, "amount");
      assertPesewas(gift.feePesewas, "fee");
      assertPesewas(gift.maizzFeePesewas ?? 0, "Maizz fee");
      const res = await request(
        "POST",
        "gifts",
        {
          reference: gift.reference,
          church_id: gift.churchId,
          giver_id: gift.giverId ?? null,
          gift_type: gift.giftType,
          amount_pesewas: gift.amountPesewas,
          fee_pesewas: gift.feePesewas,
          maizz_fee_pesewas: gift.maizzFeePesewas ?? 0,
          total_pesewas: gift.amountPesewas + gift.feePesewas,
        },
        "return=representation",
      );
      return toGift((await rows(res, "gift creation"))[0]);
    },

    async findGiftByReference(reference) {
      const res = await request(
        "GET",
        `gifts?reference=eq.${encodeURIComponent(reference)}&select=id,reference,church_id,amount_pesewas,fee_pesewas,total_pesewas,created_at&limit=1`,
      );
      const row = (await rows(res, "gift lookup"))[0];
      return row === undefined ? null : toGift(row);
    },

    async addEvent(event) {
      if (event.amountPesewas !== undefined) assertPesewas(event.amountPesewas, "event amount");
      const res = await request(
        "POST",
        "gift_events",
        {
          gift_id: event.giftId,
          status: event.status,
          amount_pesewas: event.amountPesewas ?? null,
          provider_event_id: event.providerEventId ?? null,
          detail: event.detail ?? {},
        },
        "return=minimal",
      );
      if (res.status === 201) return "added";
      if (await isUniqueViolation(res)) return "duplicate";
      throw new LedgerError(`Database refused the event (${res.status})`);
    },

    async currentStatus(reference) {
      const res = await request(
        "GET",
        `gift_status?reference=eq.${encodeURIComponent(reference)}&select=status,was_paid,refunded_pesewas&limit=1`,
      );
      const row = (await rows(res, "status lookup"))[0];
      if (!isRec(row) || typeof row.status !== "string") return null;
      return {
        status: row.status as EventStatus,
        wasPaid: row.was_paid === true,
        refundedPesewas: pesewas(row.refunded_pesewas ?? 0, "refunded"),
      };
    },

    async listUnsettled({ olderThanMinutes, newerThanDays, limit }) {
      const older = new Date(Date.now() - olderThanMinutes * 60_000).toISOString();
      const newer = new Date(Date.now() - newerThanDays * 86_400_000).toISOString();
      const res = await request(
        "GET",
        `gift_status?status=eq.pending&created_at=lt.${encodeURIComponent(older)}&created_at=gt.${encodeURIComponent(newer)}&select=id:gift_id,reference,church_id,amount_pesewas,fee_pesewas,total_pesewas,created_at&order=created_at.asc&limit=${Math.max(1, Math.floor(limit))}`,
      );
      return (await rows(res, "unsettled gifts")).map(toGift);
    },

    async listRecentPaid({ sinceDays, limit }) {
      const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
      const res = await request(
        "GET",
        `gift_status?was_paid=eq.true&created_at=gt.${encodeURIComponent(since)}&select=id:gift_id,reference,church_id,amount_pesewas,fee_pesewas,total_pesewas,created_at&order=created_at.desc&limit=${Math.max(1, Math.floor(limit))}`,
      );
      return (await rows(res, "recent paid gifts")).map(toGift);
    },
  };
}
