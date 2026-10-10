import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs 0001 then 0002 on a real Postgres (PGlite) and proves the audit rules in the database itself.

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../supabase/migrations/${name}`, import.meta.url)), "utf8");

let db: PGlite;
let n = 0;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(read("0001_ledger.sql"));
  await db.exec(read("0002_audit.sql"));
}, 60_000);

afterAll(async () => {
  await db.close();
});

async function audit(where: string, params: unknown[] = []) {
  const res = await db.query<{ actor: string; action: string; target: string | null; outcome: string; detail: Record<string, unknown> }>(
    `select actor, action, target, outcome, detail from audit_log where ${where} order by id`,
    params,
  );
  return res.rows;
}

describe("audit_log table", () => {
  it("accepts a normal record", async () => {
    await db.query(
      "insert into audit_log (actor, action, target, outcome, source_key, detail) values ('admin', 'admin.test', 'ref1', 'ok', 'abc', '{\"a\":1}')",
    );
    const rows = await audit("action = 'admin.test'");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: "admin", outcome: "ok" });
  });

  it("refuses an unknown outcome and empty actor or action", async () => {
    await expect(db.query("insert into audit_log (actor, action, outcome) values ('a', 'b', 'maybe')")).rejects.toThrow();
    await expect(db.query("insert into audit_log (actor, action) values ('', 'b')")).rejects.toThrow();
    await expect(db.query("insert into audit_log (actor, action) values ('a', '')")).rejects.toThrow();
  });

  it("cannot be edited, deleted or wiped", async () => {
    await db.query("insert into audit_log (actor, action) values ('admin', 'admin.keepme')");
    await expect(db.query("update audit_log set outcome = 'denied' where action = 'admin.keepme'")).rejects.toThrow(/append-only/);
    await expect(db.query("delete from audit_log where action = 'admin.keepme'")).rejects.toThrow(/append-only/);
    await expect(db.exec("truncate audit_log")).rejects.toThrow(/append-only/);
    expect(await audit("action = 'admin.keepme'")).toHaveLength(1);
  });
});

describe("automatic records", () => {
  it("records a new church", async () => {
    n += 1;
    const res = await db.query<{ id: string }>("insert into churches (name, slug) values ('Audit Church', $1) returning id", [`audit-church-${n}`]);
    const rows = await audit("action = 'church.created' and target = $1", [res.rows[0]!.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: "database", outcome: "ok", detail: { slug: `audit-church-${n}` } });
  });

  it("records a change to a giver: field names only, never the personal details", async () => {
    const res = await db.query<{ id: string }>(
      "insert into givers (full_name, phone, email) values ('Kwame Asante', '0244999888', 'kwame@example.com') returning id",
    );
    const id = res.rows[0]!.id;
    await db.query("update givers set full_name = 'Kwame B Asante', phone = '0244111222' where id = $1", [id]);
    const rows = await audit("target = $1", [id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe("giver.updated");
    expect(rows[0]!.detail).toEqual({ changed_fields: ["full_name", "phone"] });
    const everything = JSON.stringify(rows);
    for (const secret of ["Kwame", "Asante", "0244999888", "0244111222", "kwame@example.com"]) {
      expect(everything).not.toContain(secret);
    }
  });

  it("records an anonymisation as its own action", async () => {
    const res = await db.query<{ id: string }>("insert into givers (full_name, phone) values ('Ama Boateng', '0201112223') returning id");
    const id = res.rows[0]!.id;
    await db.query("update givers set full_name = null, phone = null, anonymised_at = now() where id = $1", [id]);
    const rows = await audit("target = $1", [id]);
    expect(rows.map((r) => r.action)).toEqual(["giver.anonymised"]);
    expect(rows[0]!.detail.changed_fields).toEqual(["anonymised_at", "full_name", "phone"]);
  });

  it("does not record an update that changed nothing", async () => {
    const res = await db.query<{ id: string }>("insert into givers (full_name) values ('Same Person') returning id");
    const id = res.rows[0]!.id;
    await db.query("update givers set full_name = 'Same Person' where id = $1", [id]);
    expect(await audit("target = $1", [id])).toHaveLength(0);
  });
});
