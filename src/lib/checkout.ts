import { addFees, type FeeBreakdown } from "./fees";
import { GIFT_TYPES, type GiftType, type Ledger } from "./ledger";
import { logError } from "./log";
import { assertPesewas } from "./money";
import { normaliseGhanaPhone } from "./phone";
import { newGiftReference } from "./payments/reference";
import type { InitializeResult, MobileMoneyNetwork, PaymentProvider } from "./payments/types";

// The giver-facing gift flow. Givers only ever see "Maizz": nothing here passes on the
// payment provider's own wording.

/** Until church sign-up exists (step 7), only the test church can receive gifts. */
export const CHECKOUT_CHURCHES: Readonly<Record<string, string>> = { "maizz-test-church": "Maizz Test Church" };

export const MIN_GIFT_PESEWAS = 100; // GH₵1.00
export const MAX_GIFT_PESEWAS = 5_000_000; // GH₵50,000.00 until large-gift review exists

export const GIFT_TYPE_LABELS: Record<(typeof GIFT_TYPES)[number], string> = {
  tithe: "Tithe",
  offering: "Offering",
  thanksgiving: "Thanksgiving",
  seed: "Seed",
  building: "Building fund",
  missions: "Missions",
  other: "Other",
};

const NETWORKS: readonly MobileMoneyNetwork[] = ["mtn", "vodafone", "airteltigo"];

export interface CheckoutInput {
  churchSlug: string;
  amountPesewas: number;
  giftType: GiftType;
  anonymous: boolean;
  fullName?: string;
  phone: string;
  network: MobileMoneyNetwork;
}

export type ParsedCheckout = { ok: true; input: CheckoutInput } | { ok: false; error: string };

/** Checks what the browser sent. Nothing from the browser is trusted, including the fee (worked out here). */
export function parseCheckout(raw: unknown): ParsedCheckout {
  const b = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const fail = (error: string): ParsedCheckout => ({ ok: false, error });

  const churchSlug = typeof b.church === "string" ? b.church : "";
  if (!Object.hasOwn(CHECKOUT_CHURCHES, churchSlug)) return fail("We could not find that church.");

  const amount = b.amountPesewas;
  try {
    assertPesewas(amount, "amount");
  } catch {
    return fail("Enter a valid amount.");
  }
  if (amount < MIN_GIFT_PESEWAS) return fail("The smallest gift is GH₵1.00.");
  if (amount > MAX_GIFT_PESEWAS) return fail("For gifts above GH₵50,000 please contact your church office.");

  const giftType = GIFT_TYPES.find((t) => t === b.giftType);
  if (!giftType) return fail("Choose what you are giving.");

  const network = NETWORKS.find((n) => n === b.network);
  if (!network) return fail("Choose MTN, Vodafone or AirtelTigo.");

  const phone = typeof b.phone === "string" ? normaliseGhanaPhone(b.phone) : null;
  if (!phone) return fail("Enter a Ghana mobile money number such as 0551234987.");

  const anonymous = b.anonymous === true;
  let fullName: string | undefined;
  if (!anonymous) {
    fullName = typeof b.fullName === "string" ? b.fullName.trim().replace(/\s+/g, " ") : "";
    if (fullName.length < 2 || fullName.length > 80) return fail("Enter your name, or choose to give anonymously.");
  }

  return { ok: true, input: { churchSlug, amountPesewas: amount, giftType, anonymous, fullName, phone, network } };
}

export type GiverStep =
  | { kind: "waiting" } // approve on your phone
  | { kind: "otp" } // enter the code you were sent
  | { kind: "confirming" } // paid, waiting for the books to confirm
  | { kind: "failed"; message: string };

export function toGiverStep(result: InitializeResult): GiverStep {
  switch (result.kind) {
    case "prompt":
      return { kind: "waiting" };
    case "otp_required":
      return { kind: "otp" };
    case "paid": // the ledger, not this reply, decides when a giver is told thank you
      return { kind: "confirming" };
    case "redirect": // cards come later; mobile money never redirects
    case "failed":
      return { kind: "failed", message: "The payment did not go through. Please check the number and try again." };
  }
}

export interface CheckoutStarted {
  reference: string;
  step: GiverStep;
  fees: FeeBreakdown;
}

// A stand-in until real receipts exist. Givers are not asked for an email.
const STAND_IN_EMAIL = "giver@example.com";

export async function startCheckout(args: {
  ledger: Ledger;
  provider: PaymentProvider;
  input: CheckoutInput;
  testMode: boolean;
}): Promise<CheckoutStarted> {
  const { ledger, provider, input, testMode } = args;
  const church = await ledger.findChurch(input.churchSlug);
  if (!church) throw new Error("church_missing");

  const fees = addFees(input.amountPesewas);
  const giverId = input.anonymous
    ? undefined
    : await ledger.createGiver({ fullName: input.fullName ?? "", phone: input.phone });

  const reference = newGiftReference(testMode ? "mz_test" : "mz");
  const gift = await ledger.createGift({
    reference,
    churchId: church.id,
    giverId,
    giftType: input.giftType,
    amountPesewas: fees.giftPesewas,
    feePesewas: fees.feePesewas,
  });

  try {
    const result = await provider.initialize({
      reference,
      amountPesewas: gift.totalPesewas,
      email: STAND_IN_EMAIL,
      channel: "mobile_money",
      mobileMoney: { network: input.network, phone: input.phone },
      metadata: { church_id: church.id, gift_type: input.giftType },
    });
    const failed = result.kind === "failed";
    await ledger.addEvent({ giftId: gift.id, status: failed ? "failed" : "pending", detail: { source: "initialize" } });
    return { reference, step: toGiverStep(result), fees };
  } catch (err) {
    logError("checkout.initialize_failed", { reason: err instanceof Error ? err.message : "unknown" });
    await ledger
      .addEvent({ giftId: gift.id, status: "failed", detail: { source: "initialize_error" } })
      .catch(() => undefined);
    return {
      reference,
      step: { kind: "failed", message: "We could not start the payment. Please try again in a moment." },
      fees,
    };
  }
}

export const REFERENCE_PATTERN = /^mz(?:_test)?_[0-9a-f]{24}$/;

/** What a giver is told about a gift. "confirming" covers the short wait before the bank confirms. */
export function giverStatus(s: { status: string; wasPaid: boolean } | null): "confirming" | "paid" | "failed" | "unknown" {
  if (!s) return "unknown";
  if (s.status === "succeeded") return "paid";
  if (s.status === "failed" || s.status === "abandoned") return "failed";
  if (s.status === "refunded") return s.wasPaid ? "paid" : "failed";
  return "confirming";
}
