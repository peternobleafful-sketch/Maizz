import type { AuditLog } from "./audit";

/** How many times the provider may be asked about one gift in a minute, whatever the giver's page does. */
export const VERIFY_PER_MINUTE = 6;

/**
 * True if the provider may be asked about this gift now (and notes the question).
 * Reading first means ordinary page polls write nothing. If the audit log is down, the answer is no:
 * the giver simply sees "confirming" and the payment notice or the nightly check settles it.
 */
export async function mayAskProvider(audit: AuditLog, reference: string): Promise<boolean> {
  try {
    const key = reference.slice(0, 64);
    if ((await audit.countSince("checkout.verify", 1, key)) >= VERIFY_PER_MINUTE) return false;
    await audit.record({ actor: "giver", action: "checkout.verify", sourceKey: key, outcome: "ok" });
    return true;
  } catch {
    return false;
  }
}
