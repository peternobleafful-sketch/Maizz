import { assertPositivePesewas, type Pesewas } from "./money";

// Fees. Givers cover them, so the church receives exactly the gift.
// Two parts, both on top of the gift:
//   1. The payment provider's cut: Paystack Ghana, 1.95% on local cards and mobile money, no flat fee,
//      no extra levies (confirmed with Paystack by Isaac, 10 Oct 2026). Rounding is still unconfirmed,
//      so it is rounded up and checked against the real fee in the nightly check.
//   2. Maizz's own fee: 1% of the gift, rounded up.
// The provider's cut is charged on the whole payment (gift + Maizz fee + the provider's own cut),
// so the total is worked out so that after the provider's cut, gift + Maizz fee remains.

/** Basis points: 195 = 1.95%. */
export const PROVIDER_FEE_BPS = 195;
/** Maizz's own fee: 100 = 1%. */
export const MAIZZ_FEE_BPS = 100;

const BPS_BASE = 10_000;

function checkBps(bps: number): void {
  if (!Number.isInteger(bps) || bps < 0 || bps >= BPS_BASE) throw new Error("fee rate is not valid");
}

/** The fee the provider takes from a payment of this size, rounded up to the next pesewa. */
export function providerFee(totalPesewas: Pesewas, bps = PROVIDER_FEE_BPS): Pesewas {
  assertPositivePesewas(totalPesewas, "total");
  return Math.ceil((totalPesewas * bps) / BPS_BASE);
}

/** Maizz's own fee on a gift, rounded up to the next pesewa. */
export function maizzFee(giftPesewas: Pesewas, bps = MAIZZ_FEE_BPS): Pesewas {
  assertPositivePesewas(giftPesewas, "gift");
  checkBps(bps);
  return Math.ceil((giftPesewas * bps) / BPS_BASE);
}

export interface FeeBreakdown {
  /** What the church receives. Exactly what the giver chose. */
  giftPesewas: Pesewas;
  /** Everything the giver adds on top of the gift (Maizz's fee plus the provider's cut). */
  feePesewas: Pesewas;
  /** What the giver pays in all. */
  totalPesewas: Pesewas;
  /** Maizz's own part of the fee. */
  maizzFeePesewas: Pesewas;
  /** The provider's expected cut of the total. */
  providerFeePesewas: Pesewas;
}

/** The smallest total where, after the provider's cut, at least `target` is left. */
function grossUp(target: Pesewas, bps: number): Pesewas {
  let total = Math.ceil((target * BPS_BASE) / (BPS_BASE - bps));
  // Integer-safe correction: step down or up until the total is the smallest that works.
  while (total - 1 > target && total - 1 - providerFee(total - 1, bps) >= target) total -= 1;
  while (total - providerFee(total, bps) < target) total += 1;
  return total;
}

/** Whole pesewas only. Never decimals. */
export function addFees(
  giftPesewas: Pesewas,
  rates: { providerBps?: number; maizzBps?: number } = {},
): FeeBreakdown {
  assertPositivePesewas(giftPesewas, "gift");
  const providerBps = rates.providerBps ?? PROVIDER_FEE_BPS;
  const maizzBps = rates.maizzBps ?? MAIZZ_FEE_BPS;
  checkBps(providerBps);
  checkBps(maizzBps);
  const maizz = maizzFee(giftPesewas, maizzBps);
  const total = grossUp(giftPesewas + maizz, providerBps);
  return {
    giftPesewas,
    feePesewas: total - giftPesewas,
    totalPesewas: total,
    maizzFeePesewas: maizz,
    providerFeePesewas: providerFee(total, providerBps),
  };
}
