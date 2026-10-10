import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../supabase/migrations/${name}`, import.meta.url)), "utf8");

let db: PGlite;
let churchId = "";
let n = 0;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(read("0001_ledger.sql"));
  await db.exec(read("0002_audit.sql"));
  // A gift made before 0003 must survive it.
  const c = await db.query<{ id: string }>("insert into churches (name, slug) values ('T', 't') returning id");
  churchId = c.rows[0]!.id;
  await db.query(
    "insert into gifts (reference, church_id, gift_type, amount_pesewas, fee_pesewas, total_pesewas) values ('before_0003_ref', $1, 'other', 100, 2, 102)",
    [churchId],
  );
  await db.exec(read("0003_gift_types.sql"));
}, 60_000);

afterAll(async () => {
  await db.close();
});

const insert = (type: string) =>
  db.query(
    "insert into gifts (reference, church_id, gift_type, amount_pesewas, fee_pesewas, total_pesewas) values ($1, $2, $3, 100, 2, 102)",
    [`ref_gift_type_${n++}`, churchId, type],
  );

describe("0003 gift types", () => {
  it("accepts every type on the giving page", async () => {
    for (const t of ["tithe", "offering", "thanksgiving", "seed", "building", "missions", "other", "project"]) {
      await insert(t);
    }
  });
  it("still refuses an unknown type", async () => {
    await expect(insert("lottery")).rejects.toThrow();
  });
  it("leaves earlier gifts untouched", async () => {
    const r = await db.query<{ n: number }>("select count(*)::int as n from gifts where reference = 'before_0003_ref'");
    expect(r.rows[0]!.n).toBe(1);
  });
  it("keeps gifts append-only", async () => {
    await expect(db.query("update gifts set amount_pesewas = 5")).rejects.toThrow();
    await expect(db.query("delete from gifts")).rejects.toThrow();
  });
});
