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

let n = 0;
async function gift(member: string | null) {
  n += 1;
  return db.query<{ id: string }>(
    "insert into gifts (reference, church_id, gift_type, amount_pesewas, fee_pesewas, total_pesewas, member_ref) values ($1, $2, 'tithe', 10000, 301, 10301, $3) returning id",
    [`mz_test_member${n.toString().padStart(4, "0")}`, churchId, member],
  );
}

describe("0014 church manager link", () => {
  it("starts with the link off at key number 1", async () => {
    const r = await db.query<{ member_link_enabled: boolean; member_link_version: number }>("select member_link_enabled, member_link_version from churches where id = $1", [churchId]);
    expect(r.rows[0]).toEqual({ member_link_enabled: false, member_link_version: 1 });
  });
  it("keeps only opaque member references", async () => {
    await gift("m_42");
    await gift(null);
    for (const bad of ["", "Ama Mensah", "0551234987@x", "a.b", "x".repeat(65)]) await expect(gift(bad), bad).rejects.toThrow();
  });
  it("shows the member reference in the gift view", async () => {
    const id = (await gift("m_view")).rows[0]!.id;
    await db.query("insert into gift_events (gift_id, status) values ($1, 'succeeded')", [id]);
    const r = await db.query<{ member_ref: string; was_paid: boolean }>("select member_ref, was_paid from gift_status where gift_id = $1", [id]);
    expect(r.rows[0]).toEqual({ member_ref: "m_view", was_paid: true });
  });
  it("records turning the link on and replacing the key, by the database itself", async () => {
    await db.query("update churches set member_link_enabled = true where id = $1", [churchId]);
    await db.query("update churches set member_link_version = member_link_version + 1 where id = $1", [churchId]);
    const r = await db.query<{ detail: { changed_fields: string[] } }>("select detail from audit_log where target = $1 and action = 'church.updated' order by id", [churchId]);
    const fields = r.rows.flatMap((x) => x.detail.changed_fields);
    expect(fields).toEqual(expect.arrayContaining(["member_link_enabled", "member_link_version"]));
  });
  it("refuses a key number below 1", async () => {
    await expect(db.query("update churches set member_link_version = 0 where id = $1", [churchId])).rejects.toThrow();
  });
});
