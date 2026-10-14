import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dir = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
let db: PGlite;
let churchId: string;

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) await db.exec(readFileSync(`${dir}${f}`, "utf8"));
  churchId = (await db.query<{ id: string }>("insert into churches (name, slug, status) values ('C', 'c', 'active') returning id")).rows[0]!.id;
}, 60_000);

afterAll(async () => {
  await db.close();
});

const hit = async (action: string, key: string, minutes = 15) =>
  (await db.query<{ maizz_hit: number }>("select maizz_hit($1, $2, $3)", [action, key, minutes])).rows[0]!.maizz_hit;

describe("maizz_hit (0010): count and record in one step", () => {
  it("50 simultaneous attempts get the numbers 1 to 50, so exactly the limit are let through", async () => {
    const limit = 8;
    const results = await Promise.all(Array.from({ length: 50 }, () => hit("test.burst", "source-a")));
    expect([...results].sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(results.filter((n) => n <= limit)).toHaveLength(limit);
  });

  it("counts each action and source on its own", async () => {
    expect(await hit("test.a", "k1")).toBe(1);
    expect(await hit("test.a", "k1")).toBe(2);
    expect(await hit("test.a", "k2")).toBe(1);
    expect(await hit("test.b", "k1")).toBe(1);
  });

  it("forgets attempts older than the window", async () => {
    await db.query("insert into audit_log (at, actor, action, source_key) values (now() - interval '2 hours', 'system', 'test.old', 'k')");
    expect(await hit("test.old", "k", 60)).toBe(1);
    expect(await hit("test.old", "k", 24 * 60)).toBe(3); // the old one, the first hit, and this one
  });

  it("records who, what and the outcome, and nothing personal", async () => {
    await db.query("select maizz_hit('test.rec', 'k', 15, 'denied', 'target-1', 'unknown')");
    const row = (await db.query<{ actor: string; outcome: string; target: string }>("select actor, outcome, target from audit_log where action = 'test.rec'")).rows[0]!;
    expect(row).toEqual({ actor: "unknown", outcome: "denied", target: "target-1" });
  });

  it("refuses nonsense", async () => {
    await expect(hit("test.bad", "k", 0)).rejects.toThrow();
    await expect(hit("test.bad", "k", 5000)).rejects.toThrow();
    await expect(db.query("select maizz_hit(null, 'k', 5)")).rejects.toThrow();
  });
});

describe("maizz_staff_fail and maizz_code_attempt (0010): add one and return it, in one step", () => {
  it("count 50 simultaneous wrong attempts exactly, for church people and owners", async () => {
    const church = (await db.query<{ id: string }>("insert into church_users (church_id, email, full_name, role) values ($1, 'a@c.org', 'A', 'owner') returning id", [churchId])).rows[0]!.id;
    const owner = (await db.query<{ id: string }>("insert into owner_users (email, full_name) values ('o@m.test', 'O') returning id")).rows[0]!.id;
    const c = await Promise.all(Array.from({ length: 50 }, () => db.query<{ maizz_staff_fail: number }>("select maizz_staff_fail($1, 'church')", [church])));
    expect(c.map((r) => r.rows[0]!.maizz_staff_fail).sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    const o = await Promise.all(Array.from({ length: 20 }, () => db.query<{ maizz_staff_fail: number }>("select maizz_staff_fail($1, 'owner')", [owner])));
    expect(Math.max(...o.map((r) => r.rows[0]!.maizz_staff_fail))).toBe(20);
    expect((await db.query<{ failed_attempts: number }>("select failed_attempts from church_users where id = $1", [church])).rows[0]!.failed_attempts).toBe(50);
  });

  it("let only five of 40 simultaneous code guesses look at the code", async () => {
    const owner = (await db.query<{ id: string }>("insert into owner_users (email, full_name) values ('p@m.test', 'P') returning id")).rows[0]!.id;
    const token = (await db.query<{ id: string }>("insert into owner_tokens (user_id, kind, token_hash, expires_at) values ($1, 'code', 'h', now() + interval '10 minutes') returning id", [owner])).rows[0]!.id;
    const tries = await Promise.all(Array.from({ length: 40 }, () => db.query<{ maizz_code_attempt: number }>("select maizz_code_attempt($1, 'owner')", [token])));
    const numbers = tries.map((r) => r.rows[0]!.maizz_code_attempt);
    expect(numbers.filter((n) => n <= 5)).toHaveLength(5);
    expect(Math.max(...numbers)).toBe(40);
  });

  it("refuse an unknown area, and say nothing for a person who does not exist", async () => {
    await expect(db.query("select maizz_staff_fail(gen_random_uuid(), 'other')")).rejects.toThrow();
    await expect(db.query("select maizz_code_attempt(gen_random_uuid(), 'other')")).rejects.toThrow();
    expect((await db.query<{ maizz_staff_fail: number | null }>("select maizz_staff_fail(gen_random_uuid(), 'church')")).rows[0]!.maizz_staff_fail).toBeNull();
  });
});

describe("0010: declined applicants' contact details can be removed", () => {
  it("allows the contact fields to be emptied and marks when", async () => {
    const id = (
      await db.query<{ id: string }>(
        "insert into church_applications (church_name, contact_name, contact_email, contact_phone, status) values ('X Church', 'Ama', 'a@x.org', '0551234987', 'declined') returning id",
      )
    ).rows[0]!.id;
    await db.query("update church_applications set contact_name = null, contact_email = null, contact_phone = null, note = null, contact_removed_at = now() where id = $1", [id]);
    const row = (await db.query<{ contact_email: string | null; contact_removed_at: Date | null }>("select contact_email, contact_removed_at from church_applications where id = $1", [id])).rows[0]!;
    expect(row.contact_email).toBeNull();
    expect(row.contact_removed_at).not.toBeNull();
  });
});

describe("0010: maizz_clean_up removes old personal details and nothing else", () => {
  const giver = async (daysAgo: number) =>
    (await db.query<{ id: string }>("insert into givers (full_name, phone, email, created_at) values ('Kofi', '0551234567', 'k@x.org', now() - make_interval(days => $1)) returning id", [daysAgo])).rows[0]!.id;
  const gift = async (giverId: string, daysAgo: number, paid: boolean) => {
    const ref = `mz_test_${Math.random().toString(36).slice(2, 12)}`;
    const id = (
      await db.query<{ id: string }>(
        "insert into gifts (reference, church_id, giver_id, gift_type, amount_pesewas, fee_pesewas, total_pesewas, created_at) values ($1, $2, $3, 'tithe', 10000, 301, 10301, now() - make_interval(days => $4)) returning id",
        [ref, churchId, giverId, daysAgo],
      )
    ).rows[0]!.id;
    if (paid) await db.query("insert into gift_events (gift_id, status) values ($1, 'succeeded')", [id]);
    return id;
  };
  const clean = async () => (await db.query<{ maizz_clean_up: { givers: number; applications: number } }>("select maizz_clean_up(30, 90)")).rows[0]!.maizz_clean_up;
  const state = async (id: string) => (await db.query<{ full_name: string | null; phone: string | null; email: string | null; anonymised_at: Date | null }>("select full_name, phone, email, anonymised_at from givers where id = $1", [id])).rows[0]!;

  it("anonymises an old giver who never paid, and keeps a paid giver, a recent giver and a giver with a recent gift", async () => {
    const unpaid = await giver(40);
    await gift(unpaid, 40, false);
    const paid = await giver(40);
    await gift(paid, 40, true);
    const recent = await giver(5);
    await gift(recent, 5, false);
    const retry = await giver(60);
    await gift(retry, 60, false);
    await gift(retry, 3, false);
    const noGift = await giver(45);

    const before = (await db.query<{ n: string; total: string }>("select count(*)::text as n, coalesce(sum(total_pesewas), 0)::text as total from gift_status where was_paid")).rows[0]!;
    const out = await clean();
    expect(out.givers).toBeGreaterThanOrEqual(2);

    expect(await state(unpaid)).toMatchObject({ full_name: null, phone: null, email: null });
    expect((await state(unpaid)).anonymised_at).not.toBeNull();
    expect((await state(noGift)).anonymised_at).not.toBeNull();
    expect(await state(paid)).toMatchObject({ full_name: "Kofi", phone: "0551234567", email: "k@x.org", anonymised_at: null });
    expect((await state(recent)).full_name).toBe("Kofi");
    expect((await state(retry)).full_name).toBe("Kofi");

    const after = (await db.query<{ n: string; total: string }>("select count(*)::text as n, coalesce(sum(total_pesewas), 0)::text as total from gift_status where was_paid")).rows[0]!;
    expect(after).toEqual(before);
    expect((await db.query("select 1 from audit_log where action = 'giver.anonymised' and target = $1", [unpaid])).rows).toHaveLength(1);
  });

  it("is safe to run twice", async () => {
    const id = await giver(100);
    await clean();
    const second = await clean();
    expect(second.givers).toBe(0);
    expect((await state(id)).anonymised_at).not.toBeNull();
  });

  it("removes contact details of old declined applications only", async () => {
    const app = async (status: string, daysAgo: number, email: string) =>
      (
        await db.query<{ id: string }>(
          "insert into church_applications (church_name, contact_name, contact_email, contact_phone, note, status, created_at, decided_at) values ('Z Church', 'Ama', $1, '0551234987', 'hello', $2, now() - make_interval(days => $3), now() - make_interval(days => $3)) returning id",
          [email, status, daysAgo],
        )
      ).rows[0]!.id;
    const oldDeclined = await app("declined", 120, "old@x.org");
    const newDeclined = await app("declined", 10, "new@x.org");
    const oldAccepted = await app("accepted", 120, "acc@x.org");
    const out = await clean();
    expect(out.applications).toBe(1);
    const get = async (id: string) => (await db.query<{ contact_email: string | null; note: string | null; contact_removed_at: Date | null }>("select contact_email, note, contact_removed_at from church_applications where id = $1", [id])).rows[0]!;
    expect(await get(oldDeclined)).toMatchObject({ contact_email: null, note: null });
    expect((await get(oldDeclined)).contact_removed_at).not.toBeNull();
    expect((await get(newDeclined)).contact_email).toBe("new@x.org");
    expect((await get(oldAccepted)).contact_email).toBe("acc@x.org");
    expect((await db.query("select detail from audit_log where action = 'church.application_contact_removed' and target = $1", [oldDeclined])).rows).toHaveLength(1);
  });

  it("refuses nonsense periods", async () => {
    await expect(db.query("select maizz_clean_up(0, 90)")).rejects.toThrow();
    await expect(db.query("select maizz_clean_up(30, null)")).rejects.toThrow();
  });
});
