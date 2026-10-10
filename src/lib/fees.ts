import { assertPositivePesewas, type Pesewas } from "./money";

// Fees. Givers cover them, so the church receives exactly the gift.
// Paystack Ghana charges 1.95% on local cards and mobile money (no flat collection fee).
// Isaac confirmed with Paystack (10 Oct 2026): 1.95%, no extra levies. Rounding is still
// unconfirmed, so it is checked against the real fee Paystack reports on each payment in step 6 (reconciliation).

/** Basis points: 195 = 1.95%. */
export const PROVIDER_FEE_BPS = 195;

const BPS_BASE = 10_000;

/** The fee Paystack takes from a payment of this size, rounded up to the next pesewa. */
export function providerFee(totalPesewas: Pesewas, bps = PROVIDER_FEE_BPS): Pesewas {
  assertPositivePesewas(totalPesewas, "total");
  return Math.ceil((totalPesewas * bps) / BPS_BASE);
}

export interface FeeBreakdown {
  /** What the church receives. Exactly what the giver chose. */
  giftPesewas: Pesewas;
  /** What the giver adds to cover fees. */
  feePesewas: Pesewas;
  /** What the giver pays in all. */
  totalPesewas: Pesewas;
}

/** The smallest total where, after the provider's fee, at least the gift is left. Whole pesewas only. */
export function addFees(giftPesewas: Pesewas, bps = PROVIDER_FEE_BPS): FeeBreakdown {
  assertPositivePesewas(giftPesewas, "gift");
  if (!Number.isInteger(bps) || bps < 0 || bps >= BPS_BASE) throw new Error("fee rate is not valid");
  let total = Math.ceil((giftPesewas * BPS_BASE) / (BPS_BASE - bps));
  // Integer-safe correction: step down or up until the total is the smallest that works.
  while (total - 1 > giftPesewas && total - 1 - providerFee(total - 1, bps) >= giftPesewas) total -= 1;
  while (total - providerFee(total, bps) < giftPesewas) total += 1;
  return { giftPesewas, feePesewas: total - giftPesewas, totalPesewas: total };
}
