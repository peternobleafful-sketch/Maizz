import type { AuditLog } from "./audit";
import type { Ledger, GiftRecord } from "./ledger";
import { logError } from "./log";
import { formatCedis } from "./money";
import type { Mailer } from "./staff";
import { typeLabel, longDate } from "./format";

// Things Maizz tells people: a receipt to a giver, and alerts to the owner when something odd happens.
// Nothing here may ever block a payment from being recorded, so every method catches its own errors.

export interface Notifier {
  /** A gift was just recorded as paid for the first time: sends the receipt and checks for a large gift. */
  paid(gift: GiftRecord): Promise<void>;
  /** Tells the owner about something odd. At most one email per kind each hour. Lines must hold no names, phones or secrets. */
  alert(kind: string, subject: string, lines: string[]): Promise<void>;
}

export const NO_NOTIFIER: Notifier = { paid: async () => undefined, alert: async () => undefined };

export const DEFAULT_LARGE_GIFT_PESEWAS = 200_000; // GH₵2,000
export const ALERT_THROTTLE_MINUTES = 60;

export function receiptText(r: {
  churchName: string;
  giftType: string;
  amountPesewas: number;
  feePesewas: number;
  totalPesewas: number;
  createdAt: string;
  reference: string;
}): string {
  return [
    `Thank you for your gift to ${r.churchName}.`,
    "",
    `Gift type:  ${typeLabel(r.giftType)}`,
    `Date:       ${r.createdAt ? longDate(r.createdAt) : ""}`,
    `Gift:       ${formatCedis(r.amountPesewas)}`,
    `Fees:       ${formatCedis(r.feePesewas)}`,
    `Total:      ${formatCedis(r.totalPesewas)}`,
    `Reference:  ${r.reference}`,
    "",
    `${r.churchName} receives the full ${formatCedis(r.amountPesewas)}.`,
    "",
    "Keep this email as your record. Maizz never sees your mobile money PIN.",
  ].join("\n");
}

export function createNotifier(deps: {
  ledger: Ledger;
  audit: AuditLog;
  /** Null when email is not set up. Receipts and alerts are then skipped. */
  mailer: Mailer | null;
  /** Where alerts go. Null means alerts are only written to the audit log. */
  alertTo: string | null;
  largeGiftPesewas?: number;
}): Notifier {
  const { ledger, audit, mailer, alertTo } = deps;
  const large = deps.largeGiftPesewas ?? DEFAULT_LARGE_GIFT_PESEWAS;

  async function alert(kind: string, subject: string, lines: string[]): Promise<void> {
    try {
      if (!mailer || !alertTo) {
        logError("alert.not_delivered", { kind });
        return;
      }
      if ((await audit.countSince(`alert.sent.${kind}`, ALERT_THROTTLE_MINUTES)) > 0) return;
      await mailer.send({
        to: alertTo,
        subject: `[Maizz alert] ${subject}`,
        text: [...lines, "", "Open the setup page and check the audit log for details. This kind of alert is sent at most once an hour."].join("\n"),
      });
      await audit.record({ actor: "alerts", action: `alert.sent.${kind}`, outcome: "ok" });
    } catch {
      logError("alert.send_failed", { kind });
    }
  }

  return {
    alert,

    async paid(gift) {
      try {
        if (gift.amountPesewas >= large) {
          await alert("large_gift", `A large gift of ${formatCedis(gift.amountPesewas)} was paid`, [
            `A gift of ${formatCedis(gift.amountPesewas)} was just paid.`,
            `Reference: ${gift.reference}`,
            `Your alert limit is ${formatCedis(large)}.`,
          ]);
        }
      } catch {
        logError("notify.large_gift_failed");
      }
      try {
        if (!mailer) return;
        const info = await ledger.findReceiptInfo(gift.reference);
        if (!info?.email) return;
        await mailer.send({
          to: info.email,
          subject: `Your receipt from ${info.churchName}`,
          text: receiptText({ ...info, reference: gift.reference }),
        });
        await audit.record({ actor: "receipts", action: "receipt.sent", outcome: "ok", target: gift.reference });
      } catch {
        logError("receipt.send_failed");
        await audit.record({ actor: "receipts", action: "receipt.failed", outcome: "failed", target: gift.reference }).catch(() => undefined);
      }
    },
  };
}
