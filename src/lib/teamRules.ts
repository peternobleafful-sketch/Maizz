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
