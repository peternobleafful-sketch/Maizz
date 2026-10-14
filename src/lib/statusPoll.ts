import type { AuditLog } from "./audit";
import { giftKey } from "./rateKey";

/** How many times the provider may be asked about one gift in a minute, whatever the giver's page does. */
export const VERIFY_PER_MINUTE = 6;

/**
 * True if the provider may be asked about this gift now (and counts the question in the short-lived counters, never the permanent log).
 * If the counters are down, the answer is no:
 * the giver simply sees "confirming" and the payment notice or the nightly check settles it.
 */
export async function mayAskProvider(audit: AuditLog, reference: string): Promise<boolean> {
  try {
    const key = giftKey(reference);
    return (await audit.hit({ action: "checkout.verify", sourceKey: key, minutes: 1 })) <= VERIFY_PER_MINUTE;
  } catch {
    return false;
  }
}
