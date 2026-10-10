import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../supabase/migrations/${name}`, import.meta.url)), "utf8");

let db: PGlite;
let n = 0;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(read("0001_ledger.sql"));
  await db.exec(read("0002_audit.sql"));
  await db.exec(read("0003_gift_types.sql"));
  await db.exec(read("0004_status_rules.sql"));
  // A church that exists before 0005 must stay active.
  await db.query("insert into churches (name, slug) values ('Old', 'old-church')");
  await db.exec(read("0005_church_accounts.sql"));
}, 60_000);

afterAll(async () => {
  await db.close();
});

async function church() {
  n += 1;
  const r = await db.query<{ id: string }>("insert into churches (name, slug) values ($1, $2) returning id", [`C${n}`, `c-${n}`]);
  return r.rows[0]!.id;
}

const auditFor = async (id: string, action: string) =>
  (await db.query<{ detail: Record<string, unknown> }>("select detail from audit_log where target = $1 and action = $2 order by id", [id, action])).rows;

describe("0005 church accounts", () => {
  it("keeps existing churches active and starts new ones pending", async () => {
    const old = await db.query<{ status: string }>("select status from churches where slug = 'old-church'");
    expect(old.rows[0]!.status).toBe("active");
    const id = await church();
    const r = await db.query<{ status: string }>("select status from churches where id = $1", [id]);
    expect(r.rows[0]!.status).toBe("pending");
  });

  it("refuses an unknown status", async () => {
    const id = await church();
    await expect(db.query("update churches set status = 'open' where id = $1", [id])).rejects.toThrow();
  });

  it("records status changes with from and to, and other changes by field name only", async () => {
    const id = await church();
    await db.query("update churches set provider_subaccount_code = 'ACCT_abc', payout_account_last4 = '4987', payout_account_name = 'Grace Chapel' where id = $1", [id]);
    await db.query("update churches set status = 'active' where id = $1", [id]);
    const changes = await auditFor(id, "church.status_changed");
    expect(changes).toHaveLength(1);
    expect(changes[0]!.detail).toEqual({ from: "pending", to: "active" });
    const updates = await auditFor(id, "church.updated");
    expect(updates[0]!.detail.changed_fields).toEqual(["payout_account_last4", "payout_account_name", "provider_subaccount_code"]);
    expect(JSON.stringify(updates)).not.toContain("Grace Chapel");
    expect(JSON.stringify(updates)).not.toContain("4987");
  });

  it("records nothing when nothing changed", async () => {
    const id = await church();
    await db.query("update churches set status = status where id = $1", [id]);
    expect(await auditFor(id, "church.updated")).toHaveLength(0);
  });

  it("never lets a church's web address change, and never lets a church be deleted", async () => {
    const id = await church();
    await expect(db.query("update churches set slug = 'other' where id = $1", [id])).rejects.toThrow();
    await expect(db.query("delete from churches where id = $1", [id])).rejects.toThrow();
  });

  it("accepts only the last four digits of an account number", async () => {
    const id = await church();
    await expect(db.query("update churches set payout_account_last4 = '0551234987' where id = $1", [id])).rejects.toThrow();
  });

  it("does not allow two churches to share one payout account", async () => {
    const a = await church();
    const b = await church();
    await db.query("update churches set provider_subaccount_code = 'ACCT_same' where id = $1", [a]);
    await expect(db.query("update churches set provider_subaccount_code = 'ACCT_same' where id = $1", [b])).rejects.toThrow();
  });

  it("stores Maizz's fee on a gift, never more than the fee, and gifts stay append-only", async () => {
    const id = await church();
    const ok = (fee: number, maizz: number) =>
      db.query(
        "insert into gifts (reference, church_id, gift_type, amount_pesewas, fee_pesewas, total_pesewas, maizz_fee_pesewas) values ($1, $2, 'tithe', 10000, $3, $4, $5)",
        [`ref_maizz_fee_${n++}`, id, fee, 10000 + fee, maizz],
      );
    await ok(301, 100);
    await expect(ok(301, 302)).rejects.toThrow();
    await expect(db.query("update gifts set maizz_fee_pesewas = 0")).rejects.toThrow();
  });
});
