import type { AuditLog } from "./audit";
import type { Ledger } from "./ledger";
import { logError } from "./log";

/**
 * How long personal details are kept when no gift was ever paid.
 * Giver details of an unpaid gift: 30 days (the security review suggested 24 hours; change giverDays to 1 for that).
 * Contact details of a declined church application: 90 days.
 * Paid gifts and their givers are not touched here; their period is for a lawyer to confirm.
 */
export const RETENTION = { giverDays: 30, applicationDays: 90 } as const;

export interface CleanUpResult {
  ok: boolean;
  givers: number;
  applications: number;
}

/** The nightly clean-up. Never throws: a failure is logged and written to the audit log so a missed night is visible. */
export async function runCleanUp(args: { ledger: Ledger; audit: AuditLog }): Promise<CleanUpResult> {
  try {
    const done = await args.ledger.cleanUpOldDetails(RETENTION);
    await args.audit
      .record({ actor: "cleanup", action: "cleanup.run", outcome: "ok", detail: { givers: done.givers, applications: done.applications } })
      .catch(() => logError("audit.write_failed", { action: "cleanup.run" }));
    return { ok: true, ...done };
  } catch (err) {
    logError("cleanup.failed", { reason: err instanceof Error ? err.message : "unknown" });
    await args.audit
      .record({ actor: "cleanup", action: "cleanup.run", outcome: "failed", detail: {} })
      .catch(() => logError("audit.write_failed", { action: "cleanup.run" }));
    return { ok: false, givers: 0, applications: 0 };
  }
}
