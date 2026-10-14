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
    await db.query("insert into limit_hits (at, action, source_key) values (now() - interval '2 hours', 'test.old', 'k')");
    expect(await hit("test.old", "k", 60)).toBe(1);
    expect(await hit("test.old", "k", 24 * 60)).toBe(3); // the old one, the first hit, and this one
  });

  it("keeps counters out of the permanent audit log", async () => {
    await db.query("select maizz_hit('test.rec', 'k', 15)");
    expect((await db.query("select 1 from audit_log where action = 'test.rec'")).rows).toHaveLength(0);
    expect((await db.query("select 1 from limit_hits where action = 'test.rec'")).rows).toHaveLength(1);
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

describe("0011: refunds can never add up to more than the gift amount", () => {
  const paidGift = async (amount = 10_000) => {
    const ref = `mz_test_${Math.random().toString(36).slice(2, 12)}`;
    const id = (await db.query<{ id: string }>("insert into gifts (reference, church_id, gift_type, amount_pesewas, fee_pesewas, total_pesewas) values ($1, $2, 'tithe', $3, 301, $4) returning id", [ref, churchId, amount, amount + 301])).rows[0]!.id;
    await db.query("insert into gift_events (gift_id, status) values ($1, 'succeeded')", [id]);
    return id;
  };
  const refund = (id: string, amount: number) => db.query("insert into gift_events (gift_id, status, amount_pesewas) values ($1, 'refunded', $2)", [id, amount]);

  it("accepts refunds up to the gift amount, then refuses more", async () => {
    const id = await paidGift();
    await refund(id, 4_000);
    await refund(id, 6_000);
    await expect(refund(id, 1)).rejects.toThrow(/maizz_refund_exceeds_gift/);
  });

  it("refuses a refund above the gift amount at once, including the fee", async () => {
    const id = await paidGift();
    await expect(refund(id, 10_301)).rejects.toThrow(/maizz_refund_exceeds_gift/);
  });

  it("refuses a refund on a gift that was never paid", async () => {
    const ref = `mz_test_${Math.random().toString(36).slice(2, 12)}`;
    const id = (await db.query<{ id: string }>("insert into gifts (reference, church_id, gift_type, amount_pesewas, fee_pesewas, total_pesewas) values ($1, $2, 'tithe', 5000, 150, 5150) returning id", [ref, churchId])).rows[0]!.id;
    await expect(refund(id, 100)).rejects.toThrow(/maizz_refund_exceeds_gift/);
  });

  it("lets only enough of 20 simultaneous refunds through", async () => {
    const id = await paidGift(10_000);
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => refund(id, 1_000)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(10);
    const total = (await db.query<{ n: string }>("select sum(amount_pesewas)::text as n from gift_events where gift_id = $1 and status = 'refunded'", [id])).rows[0]!.n;
    expect(total).toBe("10000");
  });

  it("does not disturb other events", async () => {
    const id = await paidGift();
    await db.query("insert into gift_events (gift_id, status) values ($1, 'pending')", [id]);
  });
});

describe("0012: owner authenticator columns and recovery codes", () => {
  it("lets a code be used only once (the step moves forward in one atomic update)", async () => {
    const id = (await db.query<{ id: string }>("insert into owner_users (email, full_name) values ('t@m.test', 'T') returning id")).rows[0]!.id;
    const claim = async (step: number) => (await db.query("update owner_users set totp_last_step = $2 where id = $1 and totp_last_step < $2 returning id", [id, step])).rows.length;
    const results = await Promise.all(Array.from({ length: 10 }, () => claim(5_000)));
    expect(results.reduce((a, b) => a + b, 0)).toBe(1);
    expect(await claim(4_999)).toBe(0);
    expect(await claim(5_001)).toBe(1);
  });

  it("records switching the app on and off in the audit log, without any secret", async () => {
    const id = (await db.query<{ id: string }>("insert into owner_users (email, full_name) values ('u@m.test', 'U') returning id")).rows[0]!.id;
    await db.query("update owner_users set totp_secret = 'ENCRYPTED' where id = $1", [id]);
    expect((await db.query("select 1 from audit_log where target = $1 and action like 'owner.authenticator_%'", [id])).rows).toHaveLength(0);
    await db.query("update owner_users set totp_enabled_at = now() where id = $1", [id]);
    await db.query("update owner_users set totp_enabled_at = null where id = $1", [id]);
    const actions = (await db.query<{ action: string; detail: unknown }>("select action, detail from audit_log where target = $1 and action like 'owner.authenticator_%' order by id", [id])).rows;
    expect(actions.map((a) => a.action)).toEqual(["owner.authenticator_on", "owner.authenticator_off"]);
    expect(JSON.stringify(actions)).not.toContain("ENCRYPTED");
  });

  it("uses a recovery code once", async () => {
    const id = (await db.query<{ id: string }>("insert into owner_users (email, full_name) values ('v@m.test', 'V') returning id")).rows[0]!.id;
    const hash = "a".repeat(64);
    await db.query("insert into owner_recovery_codes (user_id, code_hash) values ($1, $2)", [id, hash]);
    const use = async () => (await db.query("update owner_recovery_codes set used_at = now() where user_id = $1 and code_hash = $2 and used_at is null returning id", [id, hash])).rows.length;
    expect((await Promise.all([use(), use(), use()])).reduce((a, b) => a + b, 0)).toBe(1);
    await expect(db.query("insert into owner_recovery_codes (user_id, code_hash) values ($1, $2)", [id, hash])).rejects.toThrow();
    await expect(db.query("insert into owner_recovery_codes (user_id, code_hash) values ($1, 'short')", [id])).rejects.toThrow();
  });
});

describe("0012: safety wait after a payout account is changed", () => {
  const church = async (slug: string) => (await db.query<{ id: string }>("insert into churches (name, slug, status) values ($1, $2, 'pending') returning id", [slug, slug])).rows[0]!.id;
  const setAccount = (id: string, code: string) => db.query("update churches set provider_subaccount_code = $2 where id = $1", [id, code]);
  const open = (id: string) => db.query("update churches set status = 'active' where id = $1", [id]);
  const changedAt = async (id: string) => (await db.query<{ payout_changed_at: Date | null }>("select payout_changed_at from churches where id = $1", [id])).rows[0]!.payout_changed_at;

  it("does not delay the first time an account is set", async () => {
    const id = await church("first-time");
    await setAccount(id, "ACCT_FIRST_1");
    expect(await changedAt(id)).toBeNull();
    await open(id);
  });

  it("holds a church closed for 24 hours after the account is CHANGED", async () => {
    const id = await church("changed");
    await setAccount(id, "ACCT_CHG_1");
    await open(id);
    await db.query("update churches set status = 'suspended' where id = $1", [id]);
    await setAccount(id, "ACCT_CHG_2");
    expect(await changedAt(id)).not.toBeNull();
    await expect(open(id)).rejects.toThrow(/maizz_payout_cooldown/);
    await db.query("update churches set status = 'pending' where id = $1", [id]); // staying closed is always allowed
    await db.query("update churches set payout_changed_at = now() - interval '25 hours' where id = $1", [id]);
    await open(id);
  });

  it("does not touch other changes, such as the name or the pause switch", async () => {
    const id = await church("other");
    await setAccount(id, "ACCT_OTHER_1");
    await db.query("update churches set giving_paused = true where id = $1", [id]);
    expect(await changedAt(id)).toBeNull();
  });
});

describe("0013: the database refuses a payout change while a church is open", () => {
  const mk = async (slug: string, code: string) =>
    (await db.query<{ id: string }>("insert into churches (name, slug, status, provider_subaccount_code) values ($1, $1, 'pending', $2) returning id", [slug, code])).rows[0]!.id;

  it("refuses to change the account of an active church, however the update is made", async () => {
    const id = await mk("act-1", "ACCT_ACT_1");
    await db.query("update churches set status = 'active' where id = $1", [id]);
    await expect(db.query("update churches set provider_subaccount_code = 'ACCT_ACT_X' where id = $1", [id])).rejects.toThrow(/maizz_payout_active/);
    // Suspending and changing in one update does not get round it either.
    await expect(db.query("update churches set status = 'suspended', provider_subaccount_code = 'ACCT_ACT_Y' where id = $1", [id])).rejects.toThrow(/maizz_payout_active/);
    expect((await db.query<{ c: string }>("select provider_subaccount_code c from churches where id = $1", [id])).rows[0]!.c).toBe("ACCT_ACT_1");
  });

  it("still allows the change once the church is suspended, with the 24 hour wait", async () => {
    const id = await mk("act-2", "ACCT_ACT_2");
    await db.query("update churches set status = 'active' where id = $1", [id]);
    await db.query("update churches set status = 'suspended' where id = $1", [id]);
    await db.query("update churches set provider_subaccount_code = 'ACCT_ACT_2B' where id = $1", [id]);
    await expect(db.query("update churches set status = 'active' where id = $1", [id])).rejects.toThrow(/maizz_payout_cooldown/);
  });

  it("leaves other edits of an active church alone", async () => {
    const id = await mk("act-3", "ACCT_ACT_3");
    await db.query("update churches set status = 'active' where id = $1", [id]);
    await db.query("update churches set giving_paused = true where id = $1", [id]);
  });
});

describe("0013: recovery codes are replaced in one step", () => {
  const owner = async (email: string) => (await db.query<{ id: string }>("insert into owner_users (email, full_name) values ($1, 'O') returning id", [email])).rows[0]!.id;
  const hashes = (n: number, seed: string) => Array.from({ length: n }, (_, i) => `${seed}${String(i).padStart(2, "0")}`.padEnd(64, "a"));

  it("swaps all codes together", async () => {
    const id = await owner("rc1@m.test");
    await db.query("select maizz_replace_recovery_codes($1, $2)", [id, hashes(8, "a")]);
    const r = await db.query<{ maizz_replace_recovery_codes: number }>("select maizz_replace_recovery_codes($1, $2)", [id, hashes(8, "b")]);
    expect(r.rows[0]!.maizz_replace_recovery_codes).toBe(8);
    expect((await db.query("select 1 from owner_recovery_codes where user_id = $1 and code_hash like 'a%'", [id])).rows).toHaveLength(0);
  });

  it("a failed swap changes nothing, so the owner is never left with no codes", async () => {
    const id = await owner("rc2@m.test");
    await db.query("select maizz_replace_recovery_codes($1, $2)", [id, hashes(8, "c")]);
    // Two identical hashes break the unique rule halfway through; the old codes must survive.
    await expect(db.query("select maizz_replace_recovery_codes($1, $2)", [id, [hashes(1, "d")[0], hashes(1, "d")[0]]])).rejects.toThrow();
    expect((await db.query("select 1 from owner_recovery_codes where user_id = $1", [id])).rows).toHaveLength(8);
    await expect(db.query("select maizz_replace_recovery_codes($1, $2)", [id, []])).rejects.toThrow();
    expect((await db.query("select 1 from owner_recovery_codes where user_id = $1", [id])).rows).toHaveLength(8);
  });
});

describe("0013: the nightly clean-up empties old counters", () => {
  it("removes counters older than two days and keeps newer ones", async () => {
    await db.query("insert into limit_hits (at, action, source_key) values (now() - interval '3 days', 'test.cc', 'k'), (now() - interval '1 hour', 'test.cc', 'k')");
    const r = await db.query<{ maizz_clean_up: { counters: number } }>("select maizz_clean_up(30, 90)");
    expect(r.rows[0]!.maizz_clean_up.counters).toBeGreaterThanOrEqual(1);
    expect((await db.query("select 1 from limit_hits where action = 'test.cc'")).rows).toHaveLength(1);
  });
});
