import { getAudit } from "./audit";
import { createResendMailer } from "./mailer";
import type { Env } from "./config";
import { getLedger } from "./payments";
import { createNotifier, DEFAULT_LARGE_GIFT_PESEWAS, NO_NOTIFIER, type Notifier } from "./notify";

/** Builds the notifier from settings. If anything is missing it quietly does less, and never throws. */
export function getNotifier(env: Env = process.env): Notifier {
  try {
    const apiKey = env.RESEND_API_KEY?.trim();
    const from = env.MAIZZ_FROM_EMAIL?.trim();
    const alertTo = env.ALERT_EMAIL?.trim() || null;
    const limit = Number(env.ALERT_LARGE_GIFT_PESEWAS);
    return createNotifier({
      ledger: getLedger(env),
      audit: getAudit(env),
      mailer: apiKey && from ? createResendMailer({ apiKey, from }) : null,
      alertTo: alertTo && alertTo.includes("@") ? alertTo : null,
      largeGiftPesewas: Number.isSafeInteger(limit) && limit > 0 ? limit : DEFAULT_LARGE_GIFT_PESEWAS,
    });
  } catch {
    return NO_NOTIFIER;
  }
}
