import { createHmac } from "node:crypto";
import type { AuditEntry, AuditLog } from "../src/lib/audit";
import { StaffError, type StaffStore, type StaffToken, type StaffUser, type TokenKind } from "../src/lib/staff";
import type { ChurchRecord, ChurchStatus, EventStatus, GiftRecord, Ledger, NewEvent, NewGift, NewGiver, NewPayout, ReceiptInfo } from "../src/lib/ledger";

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

export function makeChurch(over: Partial<ChurchRecord> & { id: string; slug: string; name: string }): ChurchRecord {
  return {
    status: "active",
    subaccountCode: null,
    payoutBankName: null,
    payoutAccountLast4: null,
    payoutAccountName: null,
    paused: false,
    ...over,
  };
}

/** An in-memory ledger that behaves like the real one, including refusing repeated provider events. */
export class FakeLedger implements Ledger {
  gifts: GiftRecord[] = [];
  events: (NewEvent & { id: number })[] = [];
  failNext = false;
  /** Overridable clock so tests can age gifts. */
  now: () => number = () => Date.now();

  async getOrCreateChurch(slug: string): Promise<string> {
    return `church-${slug}`;
  }

  churches = new Map<string, ChurchRecord>();
  maizzFees = new Map<string, number>();
  giftGivers = new Map<string, string | undefined>();
  givers: { id: string; fullName: string; phone: string; email?: string; removed?: boolean }[] = [];
  giftTypes = new Map<string, string>();

  async findChurch(slug: string): Promise<ChurchRecord | null> {
    return this.churches.get(slug) ?? null;
  }

  async createChurch(c: { slug: string; name: string }): Promise<ChurchRecord> {
    if (this.churches.has(c.slug)) throw new Error("A church with that web address already exists");
    const church = makeChurch({ id: `church-${this.churches.size + 1}`, slug: c.slug, name: c.name, status: "pending" });
    this.churches.set(c.slug, church);
    return church;
  }

  async hasTestGifts(): Promise<boolean> {
    return this.gifts.some((g) => g.reference.startsWith("mz_test_"));
  }

  async getChurchById(id: string): Promise<ChurchRecord | null> {
    return [...this.churches.values()].find((c) => c.id === id) ?? null;
  }

  async listChurches(): Promise<ChurchRecord[]> {
    return [...this.churches.values()];
  }

  async setChurchPayout(churchId: string, p: NewPayout): Promise<void> {
    const c = [...this.churches.values()].find((x) => x.id === churchId);
    if (!c) throw new Error("That church was not found");
    c.subaccountCode = p.subaccountCode;
    c.payoutBankName = p.bankName;
    c.payoutAccountLast4 = p.accountLast4;
    c.payoutAccountName = p.accountName;
  }

  async setChurchStatus(churchId: string, status: ChurchStatus): Promise<void> {
    const c = [...this.churches.values()].find((x) => x.id === churchId);
    if (!c) throw new Error("That church was not found");
    c.status = status;
  }

  async setChurchPaused(churchId: string, paused: boolean): Promise<void> {
    const c = [...this.churches.values()].find((x) => x.id === churchId);
    if (!c) throw new Error("That church was not found");
    c.paused = paused;
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
      createdAt: new Date(this.now()).toISOString(),
    };
    this.giftGivers.set(g.reference, g.giverId);
    this.giftTypes.set(g.reference, g.giftType);
    this.maizzFees.set(g.reference, g.maizzFeePesewas ?? 0);
    this.gifts.push(gift);
    return gift;
  }

  async findReceiptInfo(reference: string): Promise<ReceiptInfo | null> {
    const gift = this.gifts.find((g) => g.reference === reference);
    if (!gift) return null;
    const giverId = this.giftGivers.get(reference);
    const church = [...this.churches.values()].find((c) => c.id === gift.churchId);
    return {
      email: this.givers.find((v) => v.id === giverId)?.email ?? null,
      churchName: church?.name ?? "Test Church",
      giftType: this.giftTypes.get(reference) ?? "tithe",
      amountPesewas: gift.amountPesewas,
      feePesewas: gift.feePesewas,
      totalPesewas: gift.totalPesewas,
      createdAt: gift.createdAt,
    };
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

  async currentStatus(
    reference: string,
  ): Promise<{ status: EventStatus; wasPaid: boolean; refundedPesewas: number } | null> {
    const gift = this.gifts.find((g) => g.reference === reference);
    if (!gift) return null;
    const mine = this.events.filter((e) => e.giftId === gift.id);
    const last = mine[mine.length - 1];
    const wasPaid = mine.some((e) => e.status === "succeeded");
    const refundedPesewas = mine.filter((e) => e.status === "refunded").reduce((n, e) => n + (e.amountPesewas ?? 0), 0);
    // Same rules as the database view (0004): once paid, later notices never un-pay a gift.
    const status: EventStatus = wasPaid ? (refundedPesewas > 0 ? "refunded" : "succeeded") : (last?.status ?? "pending");
    return { status, wasPaid, refundedPesewas };
  }

  async listUnsettled(o: { olderThanMinutes: number; newerThanDays: number; limit: number }): Promise<GiftRecord[]> {
    const out: GiftRecord[] = [];
    for (const g of this.gifts) {
      const age = this.now() - Date.parse(g.createdAt);
      if (age < o.olderThanMinutes * 60_000 || age > o.newerThanDays * 86_400_000) continue;
      const s = await this.currentStatus(g.reference);
      if (s && s.status === "pending") out.push(g);
    }
    return out.slice(0, o.limit);
  }

  async listClosedUnpaid(o: { sinceDays: number; limit: number }): Promise<GiftRecord[]> {
    const out: GiftRecord[] = [];
    for (const g of [...this.gifts].reverse()) {
      if (this.now() - Date.parse(g.createdAt) > o.sinceDays * 86_400_000) continue;
      const s = await this.currentStatus(g.reference);
      if (s && !s.wasPaid && (s.status === "abandoned" || s.status === "failed")) out.push(g);
    }
    return out.slice(0, o.limit);
  }

  async anonymiseGiver(giverId: string): Promise<boolean> {
    const g = this.givers.find((x) => x.id === giverId);
    if (!g || g.removed) return false;
    g.removed = true;
    g.fullName = "";
    g.phone = "";
    delete g.email;
    return true;
  }

  async anonymiseGiverOfGift(reference: string): Promise<"done" | "already" | "no_giver" | "not_found"> {
    if (!this.gifts.some((g) => g.reference === reference)) return "not_found";
    const id = this.giftGivers.get(reference);
    if (!id) return "no_giver";
    return (await this.anonymiseGiver(id)) ? "done" : "already";
  }

  cleanUps: { giverDays: number; applicationDays: number }[] = [];
  async cleanUpOldDetails(p: { giverDays: number; applicationDays: number }) {
    this.cleanUps.push(p);
    return { givers: 0, applications: 0 };
  }

  async listRecentPaid(o: { sinceDays: number; limit: number }): Promise<GiftRecord[]> {
    const out: GiftRecord[] = [];
    for (const g of this.gifts) {
      if (this.now() - Date.parse(g.createdAt) > o.sinceDays * 86_400_000) continue;
      const s = await this.currentStatus(g.reference);
      if (s?.wasPaid) out.push(g);
    }
    return out.slice(0, o.limit);
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

  async hit(a: { action: string; sourceKey: string; minutes: number; outcome?: AuditEntry["outcome"]; target?: string; actor?: string }): Promise<number> {
    if (this.failWrites) throw new Error("audit down");
    this.entries.push({ actor: a.actor ?? "system", action: a.action, target: a.target, outcome: a.outcome ?? "ok", sourceKey: a.sourceKey, at: Date.now() });
    const cutoff = Date.now() - a.minutes * 60_000;
    return this.entries.filter((e) => e.action === a.action && e.sourceKey === a.sourceKey && e.at >= cutoff).length;
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

/** An in-memory sign-in store (people and one-use tokens). */
export class FakeStaffStore implements StaffStore {
  users: StaffUser[] = [];
  tokens: StaffToken[] = [];
  n = 0;
  async findUserByEmail(email: string) {
    return this.users.find((u) => u.email === email) ?? null;
  }
  async getUser(id: string) {
    return this.users.find((u) => u.id === id) ?? null;
  }
  async listUsers(churchId: string) {
    return this.users.filter((u) => u.churchId === churchId);
  }
  async createUser(u: { churchId: string; email: string; fullName: string; role: StaffUser["role"] }) {
    if (this.users.some((x) => x.email === u.email)) throw new StaffError("exists", "exists");
    const user: StaffUser = { id: `00000000-0000-0000-0000-${String(++this.n).padStart(12, "0")}`, ...u, status: "invited", passwordHash: null, failedAttempts: 0, lockedUntil: null };
    this.users.push(user);
    return user;
  }
  async updateUser(id: string, patch: Parameters<StaffStore["updateUser"]>[1]) {
    Object.assign(this.users.find((u) => u.id === id)!, patch);
  }
  async createToken(t: { userId: string; kind: TokenKind; tokenHash: string; expiresAt: number }) {
    const token: StaffToken = { id: `10000000-0000-0000-0000-${String(++this.n).padStart(12, "0")}`, ...t, attempts: 0, usedAt: null };
    this.tokens.push(token);
    return token.id;
  }
  async findTokenByHash(kind: TokenKind, tokenHash: string) {
    return this.tokens.find((t) => t.kind === kind && t.tokenHash === tokenHash) ?? null;
  }
  async getToken(id: string) {
    return this.tokens.find((t) => t.id === id) ?? null;
  }
  async consumeToken(id: string) {
    const t = this.tokens.find((x) => x.id === id)!;
    if (t.usedAt !== null) return false;
    t.usedAt = 1;
    return true;
  }
  async incrementTokenAttempts(id: string) {
    const t = this.tokens.find((x) => x.id === id)!;
    t.attempts += 1;
    return t.attempts;
  }
  async incrementFailures(userId: string) {
    const u = this.users.find((x) => x.id === userId)!;
    u.failedAttempts += 1;
    return u.failedAttempts;
  }
  async revokeTokens(userId: string, kind: TokenKind) {
    for (const t of this.tokens) if (t.userId === userId && t.kind === kind && t.usedAt === null) t.usedAt = 1;
  }
}

