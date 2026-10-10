import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// These tests run the real ledger file against a real Postgres (PGlite), so the
// rules are proven in the database itself, not just in our own code.

const migration = readFileSync(
  fileURLToPath(new URL("../supabase/migrations/0001_ledger.sql", import.meta.url)),
  "utf8",
);

const statusRules = readFileSync(
  fileURLToPath(new URL("../supabase/migrations/0004_status_rules.sql", import.meta.url)),
  "utf8",
);

let db: PGlite;
let counter = 0;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(migration);
  await db.exec(statusRules);
}, 60_000);

afterAll(async () => {
  await db.close();
});

async function newChurch(): Promise<string> {
  counter += 1;
  const res = await db.query<{ id: string }>(
    "insert into churches (name, slug) values ($1, $2) returning id",
    [`Test Church ${counter}`, `test-church-${counter}`],
  );
  return res.rows[0]!.id;
}

async function newGiver(): Promise<string> {
  const res = await db.query<{ id: string }>(
    "insert into givers (full_name, phone) values ('Ama Mensah', '0240000000') returning id",
  );
  return res.rows[0]!.id;
}

async function newGift(
  churchId: string,
  opts: { amount?: number; fee?: number; giverId?: string | null; type?: string } = {},
): Promise<string> {
  counter += 1;
  const amount = opts.amount ?? 10_000;
  const fee = opts.fee ?? 0;
  const res = await db.query<{ id: string }>(
    `insert into gifts (reference, church_id, giver_id, gift_type, amount_pesewas, fee_pesewas, total_pesewas)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [`mz_test_${counter}_ref`, churchId, opts.giverId ?? null, opts.type ?? "tithe", amount, fee, amount + fee],
  );
  return res.rows[0]!.id;
}

async function addEvent(giftId: string, status: string, amount?: number, providerEventId?: string) {
  await db.query(
    "insert into gift_events (gift_id, status, amount_pesewas, provider_event_id) values ($1, $2, $3, $4)",
    [giftId, status, amount ?? null, providerEventId ?? null],
  );
}

describe("adding records", () => {
  it("stores a gift in whole pesewas with the fee kept separate", async () => {
    const church = await newChurch();
    const giver = await newGiver();
    const gift = await newGift(church, { amount: 10_000, fee: 150, giverId: giver });
    const res = await db.query<{ amount_pesewas: string; fee_pesewas: string; total_pesewas: string; currency: string }>(
      "select amount_pesewas, fee_pesewas, total_pesewas, currency from gifts where id = $1",
      [gift],
    );
    expect(Number(res.rows[0]!.amount_pesewas)).toBe(10_000);
    expect(Number(res.rows[0]!.fee_pesewas)).toBe(150);
    expect(Number(res.rows[0]!.total_pesewas)).toBe(10_150);
    expect(res.rows[0]!.currency).toBe("GHS");
  });

  it("accepts every gift type we planned for", async () => {
    const church = await newChurch();
    for (const type of ["tithe", "offering", "thanksgiving", "project", "other"]) {
      await expect(newGift(church, { type })).resolves.toBeTruthy();
    }
  });
});

describe("money rules enforced by the database", () => {
  it("rejects a zero or negative gift", async () => {
    const church = await newChurch();
    await expect(newGift(church, { amount: 0 })).rejects.toThrow();
    await expect(newGift(church, { amount: -500 })).rejects.toThrow();
  });

  it("rejects a negative fee", async () => {
    const church = await newChurch();
    await expect(newGift(church, { fee: -1 })).rejects.toThrow();
  });

  it("rejects a total that is not amount plus fee", async () => {
    const church = await newChurch();
    counter += 1;
    await expect(
      db.query(
        `insert into gifts (reference, church_id, gift_type, amount_pesewas, fee_pesewas, total_pesewas)
         values ($1, $2, 'tithe', 10000, 150, 10000)`,
        [`mz_test_${counter}_bad`, church],
      ),
    ).rejects.toThrow(/gifts_total_matches/);
  });

  it("rejects decimal amounts", async () => {
    const church = await newChurch();
    counter += 1;
    await expect(
      db.query(
        `insert into gifts (reference, church_id, gift_type, amount_pesewas, total_pesewas)
         values ($1, $2, 'tithe', $3, $3)`,
        [`mz_test_${counter}_dec`, church, "12.5"],
      ),
    ).rejects.toThrow();
  });

  it("rejects a currency other than GHS", async () => {
    const church = await newChurch();
    counter += 1;
    await expect(
      db.query(
        `insert into gifts (reference, church_id, gift_type, amount_pesewas, total_pesewas, currency)
         values ($1, $2, 'tithe', 100, 100, 'USD')`,
        [`mz_test_${counter}_usd`, church],
      ),
    ).rejects.toThrow();
  });

  it("rejects an unknown gift type, status or church", async () => {
    const church = await newChurch();
    await expect(newGift(church, { type: "lottery" })).rejects.toThrow();
    const gift = await newGift(church);
    await expect(addEvent(gift, "teleported")).rejects.toThrow();
    await expect(newGift("00000000-0000-0000-0000-000000000000")).rejects.toThrow();
  });

  it("rejects a refund with no amount", async () => {
    const church = await newChurch();
    const gift = await newGift(church);
    await expect(addEvent(gift, "refunded")).rejects.toThrow();
  });

  it("rejects the same gift reference twice", async () => {
    const church = await newChurch();
    await db.query(
      "insert into gifts (reference, church_id, gift_type, amount_pesewas, total_pesewas) values ('mz_dupe_ref_1', $1, 'tithe', 100, 100)",
      [church],
    );
    await expect(
      db.query(
        "insert into gifts (reference, church_id, gift_type, amount_pesewas, total_pesewas) values ('mz_dupe_ref_1', $1, 'tithe', 100, 100)",
        [church],
      ),
    ).rejects.toThrow();
  });

  it("rejects a repeated provider event, so a duplicate notice is never recorded twice", async () => {
    const church = await newChurch();
    const gift = await newGift(church);
    await addEvent(gift, "succeeded", undefined, "evt_same_1");
    await expect(addEvent(gift, "succeeded", undefined, "evt_same_1")).rejects.toThrow();
  });
});

describe("append-only: nothing is edited or deleted", () => {
  it("blocks editing a gift", async () => {
    const church = await newChurch();
    const gift = await newGift(church, { amount: 5000 });
    await expect(db.query("update gifts set amount_pesewas = 999999, total_pesewas = 999999 where id = $1", [gift])).rejects.toThrow(/append-only/);
    const res = await db.query<{ amount_pesewas: string }>("select amount_pesewas from gifts where id = $1", [gift]);
    expect(Number(res.rows[0]!.amount_pesewas)).toBe(5000);
  });

  it("blocks deleting a gift", async () => {
    const church = await newChurch();
    const gift = await newGift(church);
    await expect(db.query("delete from gifts where id = $1", [gift])).rejects.toThrow(/append-only/);
    const res = await db.query("select 1 from gifts where id = $1", [gift]);
    expect(res.rows).toHaveLength(1);
  });

  it("blocks editing and deleting a gift event", async () => {
    const church = await newChurch();
    const gift = await newGift(church);
    await addEvent(gift, "succeeded");
    await expect(db.query("update gift_events set status = 'failed' where gift_id = $1", [gift])).rejects.toThrow(/append-only/);
    await expect(db.query("delete from gift_events where gift_id = $1", [gift])).rejects.toThrow(/append-only/);
  });

  it("blocks truncating the ledger tables", async () => {
    await expect(db.exec("truncate gifts cascade")).rejects.toThrow(/append-only/);
    await expect(db.exec("truncate gift_events")).rejects.toThrow(/append-only/);
    await expect(db.exec("truncate churches cascade")).rejects.toThrow(/append-only/);
    await expect(db.exec("truncate givers cascade")).rejects.toThrow(/append-only/);
  });

  it("blocks deleting churches and givers", async () => {
    const church = await newChurch();
    const giver = await newGiver();
    await expect(db.query("delete from churches where id = $1", [church])).rejects.toThrow(/append-only/);
    await expect(db.query("delete from givers where id = $1", [giver])).rejects.toThrow(/append-only/);
  });

  it("still lets a giver's personal details be anonymised, without touching any gift", async () => {
    const church = await newChurch();
    const giver = await newGiver();
    const gift = await newGift(church, { amount: 7000, giverId: giver });
    await db.query(
      "update givers set full_name = null, phone = null, email = null, anonymised_at = now() where id = $1",
      [giver],
    );
    const g = await db.query<{ full_name: string | null; anonymised_at: string | null }>(
      "select full_name, anonymised_at from givers where id = $1",
      [giver],
    );
    expect(g.rows[0]!.full_name).toBeNull();
    expect(g.rows[0]!.anonymised_at).not.toBeNull();
    const s = await db.query<{ amount_pesewas: string }>("select amount_pesewas from gifts where id = $1", [gift]);
    expect(Number(s.rows[0]!.amount_pesewas)).toBe(7000);
  });
});

describe("status and totals", () => {
  it("shows a new gift as pending", async () => {
    const church = await newChurch();
    const gift = await newGift(church);
    const res = await db.query<{ status: string; was_paid: boolean }>(
      "select status, was_paid from gift_status where gift_id = $1",
      [gift],
    );
    expect(res.rows[0]).toEqual({ status: "pending", was_paid: false });
  });

  it("follows the latest event", async () => {
    const church = await newChurch();
    const gift = await newGift(church);
    await addEvent(gift, "pending");
    await addEvent(gift, "succeeded");
    const res = await db.query<{ status: string; was_paid: boolean }>(
      "select status, was_paid from gift_status where gift_id = $1",
      [gift],
    );
    expect(res.rows[0]).toEqual({ status: "succeeded", was_paid: true });
  });

  it("counts only paid gifts in a church's total, and the church gets the exact gift, not the fee", async () => {
    const church = await newChurch();
    const paid = await newGift(church, { amount: 10_000, fee: 150 });
    const failed = await newGift(church, { amount: 5_000, fee: 75 });
    await newGift(church, { amount: 2_000 }); // still pending
    await addEvent(paid, "pending");
    await addEvent(paid, "succeeded");
    await addEvent(failed, "pending");
    await addEvent(failed, "failed");

    const res = await db.query<{ received_pesewas: string; paid_gift_count: string }>(
      "select received_pesewas, paid_gift_count from church_totals where church_id = $1",
      [church],
    );
    expect(Number(res.rows[0]!.received_pesewas)).toBe(10_000);
    expect(Number(res.rows[0]!.paid_gift_count)).toBe(1);
  });

  it("subtracts refunds from a church's total", async () => {
    const church = await newChurch();
    const gift = await newGift(church, { amount: 10_000 });
    await addEvent(gift, "succeeded");
    await addEvent(gift, "refunded", 4_000);
    const res = await db.query<{ received_pesewas: string }>(
      "select received_pesewas from church_totals where church_id = $1",
      [church],
    );
    expect(Number(res.rows[0]!.received_pesewas)).toBe(6_000);
    const status = await db.query<{ status: string }>("select status from gift_status where gift_id = $1", [gift]);
    expect(status.rows[0]!.status).toBe("refunded");
  });

  it("shows zero for a church with no gifts", async () => {
    const church = await newChurch();
    const res = await db.query<{ received_pesewas: string; paid_gift_count: string }>(
      "select received_pesewas, paid_gift_count from church_totals where church_id = $1",
      [church],
    );
    expect(Number(res.rows[0]!.received_pesewas)).toBe(0);
    expect(Number(res.rows[0]!.paid_gift_count)).toBe(0);
  });

  it("keeps one church's money separate from another's", async () => {
    const a = await newChurch();
    const b = await newChurch();
    const giftA = await newGift(a, { amount: 3_000 });
    const giftB = await newGift(b, { amount: 9_000 });
    await addEvent(giftA, "succeeded");
    await addEvent(giftB, "succeeded");
    const res = await db.query<{ church_id: string; received_pesewas: string }>(
      "select church_id, received_pesewas from church_totals where church_id in ($1, $2)",
      [a, b],
    );
    const byChurch = Object.fromEntries(res.rows.map((r) => [r.church_id, Number(r.received_pesewas)]));
    expect(byChurch[a]).toBe(3_000);
    expect(byChurch[b]).toBe(9_000);
  });
});

describe("late and out-of-order notices (0004)", () => {
  const statusOf = async (gift: string) =>
    (await db.query<{ status: string; was_paid: boolean }>("select status, was_paid from gift_status where gift_id = $1", [gift])).rows[0];

  it("keeps a paid gift paid when a pending notice arrives after it", async () => {
    const gift = await newGift(await newChurch());
    await addEvent(gift, "succeeded");
    await addEvent(gift, "pending");
    expect(await statusOf(gift)).toEqual({ status: "succeeded", was_paid: true });
  });

  it("keeps a paid gift paid after a late failed or abandoned notice", async () => {
    const gift = await newGift(await newChurch());
    await addEvent(gift, "succeeded");
    await addEvent(gift, "failed");
    await addEvent(gift, "abandoned");
    expect(await statusOf(gift)).toEqual({ status: "succeeded", was_paid: true });
  });

  it("lets an unpaid gift follow its latest notice", async () => {
    const gift = await newGift(await newChurch());
    await addEvent(gift, "pending");
    await addEvent(gift, "abandoned");
    expect(await statusOf(gift)).toEqual({ status: "abandoned", was_paid: false });
    await addEvent(gift, "succeeded");
    expect(await statusOf(gift)).toEqual({ status: "succeeded", was_paid: true });
  });

  it("shows a refund even if other notices come after it", async () => {
    const gift = await newGift(await newChurch(), { amount: 10_000, fee: 199 });
    await addEvent(gift, "succeeded");
    await addEvent(gift, "refunded", 500);
    await addEvent(gift, "pending");
    expect((await statusOf(gift))!.status).toBe("refunded");
  });

  it("takes a full refund (gift plus fee) out of the church total as exactly the gift", async () => {
    const church = await newChurch();
    const gift = await newGift(church, { amount: 10_000, fee: 199 });
    await addEvent(gift, "succeeded");
    await addEvent(gift, "refunded", 10_199);
    const res = await db.query<{ received_pesewas: string }>("select received_pesewas from church_totals where church_id = $1", [church]);
    expect(Number(res.rows[0]!.received_pesewas)).toBe(0);
  });

  it("does not count an unpaid gift's refund as money", async () => {
    const church = await newChurch();
    const gift = await newGift(church, { amount: 10_000 });
    await addEvent(gift, "failed");
    const res = await db.query<{ received_pesewas: string }>("select received_pesewas from church_totals where church_id = $1", [church]);
    expect(Number(res.rows[0]!.received_pesewas)).toBe(0);
  });
});
