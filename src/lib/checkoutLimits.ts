import type { AuditLog } from "./audit";

/** Gift starts one source address may make in the window. */
export const START_LIMIT = { perSource: 60, minutes: 10 } as const;
/** Gift starts for one phone number in the window, from anywhere. Stops strangers being sent approval prompts. */
export const PHONE_LIMIT = { perPhone: 3, minutes: 60 } as const;

/** Gift starts across the whole site in an hour that raise an alert. Only an alert: nobody is blocked by it. */
export const SITE_HOURLY_ALERT = 1000;

/** Counts one gift start for the whole site and returns the number so far this hour. */
export async function noteSiteVolume(audit: AuditLog): Promise<number> {
  return audit.hit({ action: "checkout.site", sourceKey: "all", minutes: 60 });
}

export type StartRefusal = "source" | "phone" | null;

/**
 * Counts this gift start against the source and the phone number, each in one atomic step
 * (so a burst of simultaneous requests cannot all slip through). Returns who is over the limit, or null.
 */
export async function checkStartLimits(audit: AuditLog, sourceKey: string, phoneFingerprint: string): Promise<StartRefusal> {
  const [fromSource, forPhone] = await Promise.all([
    audit.hit({ action: "checkout.attempt", sourceKey, minutes: START_LIMIT.minutes }),
    audit.hit({ action: "checkout.phone", sourceKey: phoneFingerprint, minutes: PHONE_LIMIT.minutes }),
  ]);
  if (fromSource > START_LIMIT.perSource) return "source";
  if (forPhone > PHONE_LIMIT.perPhone) return "phone";
  return null;
}
