import type { AuditLog } from "./audit";
import type { Ledger } from "./ledger";

// "Remove a giver's details": for a data request from a giver. Finds the giver through one of their gift references,
// removes name, phone and email for good. The gifts, amounts and the church's totals do not change.

const REFERENCE = /^[A-Za-z0-9_-]{8,100}$/;

export async function removeGiverDetails(args: {
  ledger: Ledger;
  audit: AuditLog;
  actor: string;
  sourceKey?: string;
  reference: unknown;
}): Promise<{ status: number; body: { ok?: true; message?: string; error?: string } }> {
  const ref = typeof args.reference === "string" ? args.reference.trim() : "";
  if (!REFERENCE.test(ref)) return { status: 400, body: { error: "That does not look like a gift reference." } };
  let result: Awaited<ReturnType<Ledger["anonymiseGiverOfGift"]>>;
  try {
    result = await args.ledger.anonymiseGiverOfGift(ref);
  } catch {
    return { status: 502, body: { error: "Could not remove the details. Nothing was changed. Try again in a minute." } };
  }
  // The database trigger already records the removal itself; this record says who asked for it.
  await args.audit
    .record({
      actor: args.actor,
      action: "owner.giver_details_removed",
      target: ref,
      outcome: result === "done" ? "ok" : "failed",
      sourceKey: args.sourceKey,
      detail: { result },
    })
    .catch(() => undefined);
  if (result === "not_found") return { status: 404, body: { error: "No gift has that reference." } };
  if (result === "no_giver") return { status: 200, body: { ok: true, message: "That gift was anonymous: no details are stored for it." } };
  if (result === "already") return { status: 200, body: { ok: true, message: "The details were already removed." } };
  return { status: 200, body: { ok: true, message: "Done. The name, phone number and email are gone. The gifts and amounts are unchanged." } };
}
