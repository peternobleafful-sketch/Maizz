import type { Ledger } from "../ledger";
import { log, logError } from "../log";
import {
  WebhookPayloadError,
  WebhookSignatureError,
  type PaymentProvider,
  type WebhookEvent,
} from "./types";

export interface WebhookResponse {
  status: number;
  body: { ok: boolean; result: string };
}

const MAX_BODY_BYTES = 100_000;

/**
 * Turns a provider notice into a ledger event.
 * - A notice with a wrong signature is refused (401) and nothing is recorded.
 * - The same notice twice is recorded once.
 * - A payment is only recorded as succeeded if its amount and currency match the gift exactly.
 * - Anything we cannot act on still gets a 200 so the provider does not retry for ever;
 *   a database failure gets a 500 so the provider does retry.
 */
export async function processWebhook(args: {
  provider: PaymentProvider;
  ledger: Ledger;
  rawBody: string;
  signature: string | null;
}): Promise<WebhookResponse> {
  const { provider, ledger, rawBody, signature } = args;

  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return { status: 413, body: { ok: false, result: "too_large" } };
  }

  let event: WebhookEvent;
  try {
    event = provider.parseWebhook(rawBody, signature);
  } catch (err) {
    if (err instanceof WebhookSignatureError) {
      logError("webhook.bad_signature", { provider: provider.name });
      return { status: 401, body: { ok: false, result: "bad_signature" } };
    }
    if (err instanceof WebhookPayloadError) {
      logError("webhook.bad_payload", { provider: provider.name, reason: err.message });
      return { status: 400, body: { ok: false, result: "bad_payload" } };
    }
    logError("webhook.parse_failed", { provider: provider.name });
    return { status: 500, body: { ok: false, result: "error" } };
  }

  if (event.kind === "ignored") {
    log("webhook.ignored", { provider: provider.name, event: event.providerEventId });
    return { status: 200, body: { ok: true, result: "ignored" } };
  }

  try {
    const gift = await ledger.findGiftByReference(event.reference);
    if (!gift) {
      // Could be a payment on the same Paystack account that is not a Maizz gift.
      log("webhook.unknown_reference", { provider: provider.name, event: event.providerEventId });
      return { status: 200, body: { ok: true, result: "unknown_reference" } };
    }

    if (event.kind === "payment_succeeded") {
      if (event.currency !== "GHS" || event.amountPesewas !== gift.totalPesewas) {
        // Never mark a gift as paid when the money does not match. Step 6 adds a review queue.
        logError("webhook.amount_mismatch", {
          provider: provider.name,
          giftId: gift.id,
          expected: gift.totalPesewas,
          received: event.amountPesewas ?? null,
          currency: event.currency ?? null,
        });
        return { status: 200, body: { ok: true, result: "amount_mismatch_not_recorded" } };
      }
      const outcome = await ledger.addEvent({
        giftId: gift.id,
        status: "succeeded",
        providerEventId: event.providerEventId,
        detail: { provider: provider.name, source: "webhook" },
      });
      log("webhook.recorded", { giftId: gift.id, status: "succeeded", outcome });
      return { status: 200, body: { ok: true, result: outcome } };
    }

    if (event.kind === "payment_failed") {
      const outcome = await ledger.addEvent({
        giftId: gift.id,
        status: "failed",
        providerEventId: event.providerEventId,
        detail: { provider: provider.name, source: "webhook" },
      });
      log("webhook.recorded", { giftId: gift.id, status: "failed", outcome });
      return { status: 200, body: { ok: true, result: outcome } };
    }

    // refund_processed
    const refunded = event.amountPesewas ?? 0;
    if (refunded <= 0 || refunded > gift.totalPesewas) {
      logError("webhook.refund_amount_invalid", { giftId: gift.id, refunded, total: gift.totalPesewas });
      return { status: 200, body: { ok: true, result: "refund_amount_invalid_not_recorded" } };
    }
    const outcome = await ledger.addEvent({
      giftId: gift.id,
      status: "refunded",
      amountPesewas: refunded,
      providerEventId: event.providerEventId,
      detail: { provider: provider.name, source: "webhook" },
    });
    log("webhook.recorded", { giftId: gift.id, status: "refunded", outcome });
    return { status: 200, body: { ok: true, result: outcome } };
  } catch (err) {
    logError("webhook.ledger_failed", { provider: provider.name, reason: err instanceof Error ? err.message : "unknown" });
    return { status: 500, body: { ok: false, result: "ledger_error" } };
  }
}
