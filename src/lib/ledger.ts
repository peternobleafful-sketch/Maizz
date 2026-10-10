import { assertPesewas } from "./money";

// The only code that writes to the ledger. It talks to Supabase using the server's secret key.
// The database itself refuses edits and deletes (see supabase/migrations/0001_ledger.sql).

export type GiftType = "tithe" | "offering" | "thanksgiving" | "project" | "other";
export type EventStatus = "pending" | "succeeded" | "failed" | "abandoned" | "refunded";

export interface GiftRecord {
  id: string;
  reference: string;
  churchId: string;
  amountPesewas: number;
  feePesewas: number;
  totalPesewas: number;
}

export interface NewGift {
  reference: string;
  churchId: string;
  giftType: GiftType;
  amountPesewas: number;
  feePesewas: number;
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
  createGift(gift: NewGift): Promise<GiftRecord>;
  findGiftByReference(reference: string): Promise<GiftRecord | null>;
  /** "duplicate" means this provider event was already recorded, which is fine. */
  addEvent(event: NewEvent): Promise<"added" | "duplicate">;
  currentStatus(reference: string): Promise<{ status: EventStatus; wasPaid: boolean } | null>;
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

  async function request(method: "GET" | "POST", path: string, body?: unknown, prefer?: string): Promise<Response> {
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
      const res = await request(
        "POST",
        "gifts",
        {
          reference: gift.reference,
          church_id: gift.churchId,
          gift_type: gift.giftType,
          amount_pesewas: gift.amountPesewas,
          fee_pesewas: gift.feePesewas,
          total_pesewas: gift.amountPesewas + gift.feePesewas,
        },
        "return=representation",
      );
      return toGift((await rows(res, "gift creation"))[0]);
    },

    async findGiftByReference(reference) {
      const res = await request(
        "GET",
        `gifts?reference=eq.${encodeURIComponent(reference)}&select=id,reference,church_id,amount_pesewas,fee_pesewas,total_pesewas&limit=1`,
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
        `gift_status?reference=eq.${encodeURIComponent(reference)}&select=status,was_paid&limit=1`,
      );
      const row = (await rows(res, "status lookup"))[0];
      if (!isRec(row) || typeof row.status !== "string") return null;
      return { status: row.status as EventStatus, wasPaid: row.was_paid === true };
    },
  };
}
