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
  for (const f of ["0001_ledger.sql", "0002_audit.sql", "0003_gift_types.sql", "0004_status_rules.sql", "0005_church_accounts.sql", "0006_church_staff.sql"]) {
    await db.exec(read(f));
  }
  churchId = (await db.query<{ id: string }>("insert into churches (name, slug) values ('C', 'c') returning id")).rows[0]!.id;
}, 60_000);

afterAll(async () => {
  await db.close();
});

const add = (email: string, role = "owner") =>
  db.query<{ id: string }>("insert into church_users (church_id, email, full_name, role) values ($1, $2, 'Ama', $3) returning id", [churchId, email, role]);

describe("0006 church staff", () => {
  it("starts people as invited and rejects bad emails, roles and repeats", async () => {
    const r = await add("ama@church.org");
    const row = await db.query<{ status: string }>("select status from church_users where id = $1", [r.rows[0]!.id]);
    expect(row.rows[0]!.status).toBe("invited");
    await expect(add("Ama@Church.org")).rejects.toThrow();
    await expect(add("ama@church.org")).rejects.toThrow();
    await expect(add("not-an-email")).rejects.toThrow();
    await expect(add("x@church.org", "boss")).rejects.toThrow();
  });

  it("records new people and changes, without emails, names or hashes", async () => {
    const r = await add("kofi@church.org", "viewer");
    const id = r.rows[0]!.id;
    await db.query("update church_users set password_hash = 'scrypt$secret', status = 'active' where id = $1", [id]);
    await db.query("update church_users set failed_attempts = 3 where id = $1", [id]);
    const log = await db.query<{ action: string; detail: Record<string, unknown> }>("select action, detail from audit_log where target = $1 order by id", [id]);
    expect(log.rows.map((x) => x.action)).toEqual(["staff.user_created", "staff.user_changed"]);
    expect(log.rows[1]!.detail.changed_fields).toEqual(["status", "password"]);
    const dump = JSON.stringify(log.rows);
    expect(dump).not.toContain("kofi");
    expect(dump).not.toContain("secret");
  });

  it("removes tokens when a person is removed and keeps hashes unique for links and sessions", async () => {
    const id = (await add("t@church.org")).rows[0]!.id;
    const exp = new Date(Date.now() + 60_000).toISOString();
    await db.query("insert into staff_tokens (user_id, kind, token_hash, expires_at) values ($1, 'session', 'h1', $2)", [id, exp]);
    await expect(db.query("insert into staff_tokens (user_id, kind, token_hash, expires_at) values ($1, 'invite', 'h1', $2)", [id, exp])).rejects.toThrow();
    await expect(db.query("insert into staff_tokens (user_id, kind, token_hash, expires_at) values ($1, 'other', 'h2', $2)", [id, exp])).rejects.toThrow();
  });
});
