import { createHmac } from "node:crypto";
import type { AuditEntry, AuditLog } from "../src/lib/audit";
import type { EventStatus, GiftRecord, Ledger, NewEvent, NewGift, NewGiver } from "../src/lib/ledger";

export interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

type Reply = { status?: number; json: unknown } | ((call: Call) => { status?: number; json: unknown });

/** A pretend fetch that answers from a list, in order, and remembers what it was asked. */
export function mockFetch(replies: Reply[]) {
  const calls: Call[] = [];
  let i = 0;
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const next = replies[i++];
    if (!next) throw new Error(`Unexpected extra request to ${call.url}`);
    const r = typeof next === "function" ? next(call) : next;
    return new Response(JSON.stringify(r.json), {
      status: r.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return { fn, calls };
}

export function sign(body: string, secret: string): string {
  return createHmac("sha512", secret).update(body).digest("hex");
}

/** An in-memory ledger that behaves like the real one, including refusing repeated provider events. */
export class FakeLedger implements Ledger {
  gifts: GiftRecord[] = [];
  events: (NewEvent & { id: number })[] = [];
  failNext = false;

  async getOrCreateChurch(slug: string): Promise<string> {
    return `church-${slug}`;
  }

  churches = new Map<string, { id: string; name: string }>();
  giftGivers = new Map<string, string | undefined>();
  givers: { id: string; fullName: string; phone: string }[] = [];

  async findChurch(slug: string): Promise<{ id: string; name: string } | null> {
    return this.churches.get(slug) ?? null;
  }

  async createGiver(g: NewGiver): Promise<string> {
    const id = `giver-${this.givers.length + 1}`;
    this.givers.push({ id, ...g });
    return id;
  }

  async createGift(g: NewGift): Promise<GiftRecord> {
    const gift: GiftRecord = {
      id: `gift-${this.gifts.length + 1}`,
      reference: g.reference,
      churchId: g.churchId,
      amountPesewas: g.amountPesewas,
      feePesewas: g.feePesewas,
      totalPesewas: g.amountPesewas + g.feePesewas,
    };
    this.giftGivers.set(g.reference, g.giverId);
    this.gifts.push(gift);
    return gift;
  }

  async findGiftByReference(reference: string): Promise<GiftRecord | null> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("database down");
    }
    return this.gifts.find((g) => g.reference === reference) ?? null;
  }

  async addEvent(e: NewEvent): Promise<"added" | "duplicate"> {
    if (e.providerEventId && this.events.some((x) => x.providerEventId === e.providerEventId)) return "duplicate";
    this.events.push({ ...e, id: this.events.length + 1 });
    return "added";
  }

  async currentStatus(reference: string): Promise<{ status: EventStatus; wasPaid: boolean } | null> {
    const gift = this.gifts.find((g) => g.reference === reference);
    if (!gift) return null;
    const mine = this.events.filter((e) => e.giftId === gift.id);
    const last = mine[mine.length - 1];
    return { status: last?.status ?? "pending", wasPaid: mine.some((e) => e.status === "succeeded") };
  }
}

/** An in-memory audit log. shift(n) makes everything n minutes older, to test lock-outs wearing off. */
export class FakeAudit implements AuditLog {
  entries: (AuditEntry & { at: number })[] = [];
  failReads = false;
  failWrites = false;

  async record(entry: AuditEntry): Promise<void> {
    if (this.failWrites) throw new Error("audit down");
    this.entries.push({ ...entry, at: Date.now() });
  }

  async countSince(action: string, minutes: number, sourceKey?: string): Promise<number> {
    if (this.failReads) throw new Error("audit down");
    const cutoff = Date.now() - minutes * 60_000;
    return this.entries.filter(
      (e) => e.action === action && e.at >= cutoff && (sourceKey === undefined || e.sourceKey === sourceKey),
    ).length;
  }

  shift(minutes: number): void {
    for (const e of this.entries) e.at -= minutes * 60_000;
  }

  actions(): string[] {
    return this.entries.map((e) => e.action);
  }
}
