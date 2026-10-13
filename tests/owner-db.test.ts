import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../supabase/migrations/${name}`, import.meta.url)), "utf8");

let db: PGlite;
let churchId: string;

beforeAll(async () => {
  db = new PGlite();
  for (const f of [
    "0001_ledger.sql", "0002_audit.sql", "0003_gift_types.sql", "0004_status_rules.sql",
    "0005_church_accounts.sql", "0006_church_staff.sql", "0007_password_reset.sql", "0008_owner_signup_pause.sql", "0009_owner_payout_code.sql",
  ]) {
    await db.exec(read(f));
  }
  churchId = (await db.query<{ id: string }>("insert into churches (name, slug, status) values ('C', 'c', 'active') returning id")).rows[0]!.id;
}, 60_000);

afterAll(async () => {
  await db.close();
});

const addOwner = (email: string) =>
  db.query<{ id: string }>("insert into owner_users (email, full_name) values ($1, 'Isaac') returning id", [email]);

describe("0008 owner sign-in", () => {
  it("starts owners as invited, one per email, and rejects bad emails", async () => {
    const r = await addOwner("isaac@maizz.test");
    const row = await db.query<{ status: string }>("select status from owner_users where id = $1", [r.rows[0]!.id]);
    expect(row.rows[0]!.status).toBe("invited");
    await expect(addOwner("Isaac@Maizz.test")).rejects.toThrow();
    await expect(addOwner("isaac@maizz.test")).rejects.toThrow();
    await expect(addOwner("nope")).rejects.toThrow();
  });

  it("keeps owner people apart from church people", async () => {
    const owners = await db.query("select * from owner_users");
    expect(owners.fields.map((f) => f.name)).not.toContain("church_id");
    const churchPeople = await db.query("select count(*)::int as n from church_users");
    expect((churchPeople.rows[0] as { n: number }).n).toBe(0);
  });

  it("records new owners and changes without emails, names or hashes", async () => {
    const id = (await addOwner("kofi@maizz.test")).rows[0]!.id;
    await db.query("update owner_users set password_hash = 'scrypt$secret', status = 'active' where id = $1", [id]);
    const log = await db.query<{ action: string; detail: Record<string, unknown> }>("select action, detail from audit_log where target = $1 order by id", [id]);
    expect(log.rows.map((x) => x.action)).toEqual(["owner.user_created", "owner.user_changed"]);
    expect(log.rows[1]!.detail.changed_fields).toEqual(["status", "password"]);
    const dump = JSON.stringify(log.rows);
    expect(dump).not.toContain("kofi");
    expect(dump).not.toContain("secret");
  });

  it("has its own tokens: unique links and sessions, allowed kinds only, removed with the person", async () => {
    const id = (await addOwner("t@maizz.test")).rows[0]!.id;
    const exp = new Date(Date.now() + 60_000).toISOString();
    const ins = (kind: string, hash: string) =>
      db.query("insert into owner_tokens (user_id, kind, token_hash, expires_at) values ($1, $2, $3, $4)", [id, kind, hash, exp]);
    await ins("session", "h1");
    await expect(ins("invite", "h1")).rejects.toThrow();
    await expect(ins("other", "h2")).rejects.toThrow();
    await ins("reset", "h3");
    await ins("code", "h4");
    await ins("code", "h4"); // codes are looked up by id, so two may share a hash
    await ins("payout", "h5"); // the fresh code for a payout change (0009)
    await ins("payout", "h5");
    await db.query("delete from owner_users where id = $1", [id]);
    const left = await db.query("select 1 from owner_tokens where user_id = $1", [id]);
    expect(left.rows).toHaveLength(0);
  });

  it("church sessions can never be found in the owner tokens", async () => {
    const churchUser = (
      await db.query<{ id: string }>("insert into church_users (church_id, email, full_name, role) values ($1, 'x@c.org', 'X', 'owner') returning id", [churchId])
    ).rows[0]!.id;
    await db.query("insert into staff_tokens (user_id, kind, token_hash, expires_at) values ($1, 'session', 'church-session', now() + interval '1 hour')", [churchUser]);
    const found = await db.query("select 1 from owner_tokens where token_hash = 'church-session'");
    expect(found.rows).toHaveLength(0);
  });
});

describe("0008 church applications", () => {
  const apply = (over: Record<string, unknown> = {}) => {
    const v = { name: "Grace Chapel", email: "ama@grace.org", phone: "0551234987", ...over };
    return db.query<{ id: string }>(
      "insert into church_applications (church_name, contact_name, contact_email, contact_phone) values ($1, 'Ama', $2, $3) returning id",
      [v.name, v.email, v.phone],
    );
  };

  it("starts as new and refuses bad details", async () => {
    const r = await apply();
    const row = await db.query<{ status: string }>("select status from church_applications where id = $1", [r.rows[0]!.id]);
    expect(row.rows[0]!.status).toBe("new");
    await expect(apply({ name: "A" })).rejects.toThrow();
    await expect(apply({ email: "Ama@Grace.org" })).rejects.toThrow();
    await expect(apply({ email: "bad" })).rejects.toThrow();
    await expect(apply({ phone: "call me maybe" })).rejects.toThrow();
  });

  it("records the application and the decision without any personal details", async () => {
    const id = (await apply({ name: "Zion Temple", email: "zion@zion.org" })).rows[0]!.id;
    await db.query("update church_applications set status = 'accepted', decided_at = now() where id = $1", [id]);
    const log = await db.query<{ action: string; detail: Record<string, unknown> }>("select action, detail from audit_log where target = $1 order by id", [id]);
    expect(log.rows.map((x) => x.action)).toEqual(["church.application_received", "church.application_decided"]);
    expect(log.rows[1]!.detail).toEqual({ from: "new", to: "accepted" });
    const dump = JSON.stringify(log.rows);
    expect(dump).not.toContain("zion");
    expect(dump).not.toContain("0551234987");
  });

  it("refuses a status that is not allowed", async () => {
    const id = (await apply()).rows[0]!.id;
    await expect(db.query("update church_applications set status = 'maybe' where id = $1", [id])).rejects.toThrow();
  });
});

describe("0008 pause giving", () => {
  it("is off by default and every switch is recorded", async () => {
    const before = await db.query<{ giving_paused: boolean }>("select giving_paused from churches where id = $1", [churchId]);
    expect(before.rows[0]!.giving_paused).toBe(false);
    await db.query("update churches set giving_paused = true where id = $1", [churchId]);
    await db.query("update churches set giving_paused = false where id = $1", [churchId]);
    const log = await db.query<{ action: string }>(
      "select action from audit_log where target = $1 and action like 'church.giving_%' order by id",
      [churchId],
    );
    expect(log.rows.map((x) => x.action)).toEqual(["church.giving_paused", "church.giving_resumed"]);
  });

  it("does not change the church's status and still records other changes", async () => {
    await db.query("update churches set giving_paused = true where id = $1", [churchId]);
    const s = await db.query<{ status: string }>("select status from churches where id = $1", [churchId]);
    expect(s.rows[0]!.status).toBe("active");
    const log = await db.query<{ detail: { changed_fields: string[] } }>(
      "select detail from audit_log where target = $1 and action = 'church.updated' order by id desc limit 1",
      [churchId],
    );
    expect(log.rows[0]!.detail.changed_fields).toEqual(["giving_paused"]);
    await db.query("update churches set giving_paused = false where id = $1", [churchId]);
  });
});

describe("0008 gift view", () => {
  it("shows Maizz's own fee and keeps every other column", async () => {
    const giftId = (
      await db.query<{ id: string }>(
        "insert into gifts (reference, church_id, gift_type, amount_pesewas, fee_pesewas, total_pesewas, maizz_fee_pesewas) values ('MZ-test-0001', $1, 'tithe', 10000, 301, 10301, 100) returning id",
        [churchId],
      )
    ).rows[0]!.id;
    await db.query("insert into gift_events (gift_id, status, provider_event_id) values ($1, 'succeeded', 'e1')", [giftId]);
    const v = await db.query<Record<string, unknown>>("select * from gift_status where reference = 'MZ-test-0001'");
    expect(v.rows[0]).toMatchObject({ status: "succeeded", was_paid: true, amount_pesewas: 10000, maizz_fee_pesewas: 100 });
    const totals = await db.query<{ received_pesewas: number }>("select received_pesewas from church_totals where church_id = $1", [churchId]);
    expect(Number(totals.rows[0]!.received_pesewas)).toBe(10000);
  });
});
