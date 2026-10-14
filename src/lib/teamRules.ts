import type { AuditLog } from "./audit";
import type { StaffUser } from "./staff";

/**
 * A church owner may not remove another owner if that would leave only one active owner
 * (one stolen sign-in could otherwise remove everyone else). Removing a non-owner is always fine.
 */
export function removalDecision(team: StaffUser[], targetId: string): "ok" | "last_other_owner" {
  const target = team.find((u) => u.id === targetId);
  if (!target || target.role !== "owner" || target.status !== "active") return "ok";
  const remaining = team.filter((u) => u.role === "owner" && u.status === "active" && u.id !== targetId).length;
  return remaining < 2 ? "last_other_owner" : "ok";
}

/** Invite and re-send emails one church may cause in a day. Stops a stolen church sign-in using Maizz to send a flood of emails. */
export const INVITE_LIMIT_PER_DAY = 20;

/** Counts one invite (or re-send) for this church; false when the church is over its daily limit, or the counters are down. */
export async function mayInvite(audit: AuditLog, churchId: string): Promise<boolean> {
  try {
    return (await audit.hit({ action: "church.invite", sourceKey: churchId.slice(0, 64), minutes: 24 * 60 })) <= INVITE_LIMIT_PER_DAY;
  } catch {
    return false;
  }
}
