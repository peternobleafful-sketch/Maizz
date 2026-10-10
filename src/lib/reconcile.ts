import type { AuditLog } from "./audit";
import type { GiftRecord, Ledger } from "./ledger";
import { logError } from "./log";
import { ProviderError, type PaymentProvider, type VerifyResult } from "./payments/types";

// Settling and checking. The provider's own answer (verify) is trusted; notices are only a hint.
// Used when a giver is waiting, and by the daily check.

export type SettleOutcome =
  | "paid"
  | "failed"
  | "abandoned"
  | "still_pending"
  | "mismatch"
  | "error";

/** A gift the provider never confirms is closed as abandoned after this long. A later payment notice still wins. */
export const ABANDON_AFTER_MINUTES = 120;

async function ask(provider: PaymentProvider, reference: string): Promise<VerifyResult | null> {
  try {
    return await provider.verify(reference);
  } catch (err) {
    if (err instanceof ProviderError && err.httpStatus === 404) return null;
    throw err;
  }
}

/** Asks the provider about one waiting gift and records the answer. Safe to repeat: events dedupe by provider id. */
export async function settleGift(args: {
  ledger: Ledger;
  provider: PaymentProvider;
  audit?: AuditLog;
  gift: GiftRecord;
  now?: number;
}): Promise<SettleOutcome> {
  const { ledger, provider, audit, gift } = args;
  const now = args.now ?? Date.now();
  try {
    const answer = await ask(provider, gift.reference);
    const age = now - Date.parse(gift.createdAt || String(now));
    const idPart = answer?.providerTransactionId ? answer.providerTransactionId : undefined;

    if (answer?.status === "succeeded") {
      if (answer.currency !== "GHS" || answer.amountPesewas !== gift.totalPesewas) {
        await audit
          ?.record({
            actor: "reconcile",
            action: "reconcile.amount_mismatch",
            outcome: "failed",
            target: gift.reference,
            detail: { expected_pesewas: gift.totalPesewas, received_pesewas: answer.amountPesewas, received_currency: answer.currency },
          })
          .catch(() => logError("audit.write_failed", { action: "reconcile.amount_mismatch" }));
        return "mismatch";
      }
      // Same id the payment notice uses, so a notice and this check can never both record it.
      await ledger.addEvent({
        giftId: gift.id,
        status: "succeeded",
        providerEventId: idPart ? `${provider.name}:charge.success:${idPart}` : undefined,
        detail: { provider: provider.name, source: "verify" },
      });
      return "paid";
    }
    if (answer?.status === "failed") {
      await ledger.addEvent({
        giftId: gift.id,
        status: "failed",
        providerEventId: idPart ? `${provider.name}:verify.failed:${idPart}` : undefined,
        detail: { provider: provider.name, source: "verify" },
      });
      return "failed";
    }
    if (answer?.status === "abandoned" || age > ABANDON_AFTER_MINUTES * 60_000) {
      await ledger.addEvent({
        giftId: gift.id,
        status: "abandoned",
        detail: { provider: provider.name, source: answer ? "verify" : "timeout_not_found" },
      });
      return "abandoned";
    }
    return "still_pending";
  } catch (err) {
    logError("settle.failed", { reason: err instanceof Error ? err.message : "unknown" });
    return "error";
  }
}

export interface ReconcileSummary {
  checkedPending: number;
  settledPaid: number;
  settledFailed: number;
  abandoned: number;
  stillPending: number;
  mismatches: number;
  paidChecked: number;
  paidNotConfirmed: number;
  errors: number;
  incomplete: boolean;
}

const TIME_BUDGET_MS = 40_000;
const CONCURRENCY = 5;

async function inChunks<T>(items: T[], deadline: number, work: (item: T) => Promise<void>): Promise<boolean> {
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    if (Date.now() > deadline) return false;
    await Promise.all(items.slice(i, i + CONCURRENCY).map(work));
  }
  return true;
}

/**
 * The daily check:
 *  1. Every gift still waiting for an answer (10 minutes to 3 days old) is settled with the provider.
 *  2. Every gift paid in the last 3 days is asked about again: the provider must still say paid, for the exact amount.
 * Anything odd is written to the audit log as an alert. A summary is always written, so a missed day is visible.
 */
export async function reconcile(args: {
  ledger: Ledger;
  provider: PaymentProvider;
  audit: AuditLog;
  now?: () => number;
}): Promise<ReconcileSummary> {
  const { ledger, provider, audit } = args;
  const clock = args.now ?? Date.now;
  const deadline = Date.now() + TIME_BUDGET_MS;
  const s: ReconcileSummary = {
    checkedPending: 0,
    settledPaid: 0,
    settledFailed: 0,
    abandoned: 0,
    stillPending: 0,
    mismatches: 0,
    paidChecked: 0,
    paidNotConfirmed: 0,
    errors: 0,
    incomplete: false,
  };

  const waiting = await ledger.listUnsettled({ olderThanMinutes: 10, newerThanDays: 3, limit: 100 });
  const doneWaiting = await inChunks(waiting, deadline, async (gift) => {
    s.checkedPending += 1;
    const out = await settleGift({ ledger, provider, audit, gift, now: clock() });
    if (out === "paid") s.settledPaid += 1;
    else if (out === "failed") s.settledFailed += 1;
    else if (out === "abandoned") s.abandoned += 1;
    else if (out === "mismatch") s.mismatches += 1;
    else if (out === "error") s.errors += 1;
    else s.stillPending += 1;
  });

  const paid = await ledger.listRecentPaid({ sinceDays: 3, limit: 100 });
  const donePaid = await inChunks(paid, deadline, async (gift) => {
    s.paidChecked += 1;
    try {
      const answer = await ask(provider, gift.reference);
      if (!answer || answer.status !== "succeeded" || answer.currency !== "GHS" || answer.amountPesewas !== gift.totalPesewas) {
        s.paidNotConfirmed += 1;
        await audit.record({
          actor: "reconcile",
          action: "reconcile.paid_not_confirmed",
          outcome: "failed",
          target: gift.reference,
          detail: {
            expected_pesewas: gift.totalPesewas,
            provider_status: answer?.status ?? "not_found",
            received_pesewas: answer?.amountPesewas ?? null,
            received_currency: answer?.currency ?? null,
          },
        });
      }
    } catch (err) {
      logError("reconcile.paid_check_failed", { reason: err instanceof Error ? err.message : "unknown" });
      s.errors += 1;
    }
  });

  s.incomplete = !(doneWaiting && donePaid) || waiting.length >= 100 || paid.length >= 100;
  const odd = s.mismatches + s.paidNotConfirmed + s.errors > 0 || s.incomplete;
  await audit.record({
    actor: "reconcile",
    action: "reconcile.run",
    outcome: odd ? "failed" : "ok",
    detail: { ...s },
  });
  return s;
}
