// The one interface the rest of Maizz talks to. Paystack is the first provider behind it.
// Adding a second provider later means writing another adapter, not changing the app.

export type Channel = "mobile_money" | "card" | "bank_transfer";
export type MobileMoneyNetwork = "mtn" | "vodafone" | "airteltigo";

export interface InitializeInput {
  /** Maizz's own reference for the gift. */
  reference: string;
  /** What the giver pays in total, in whole pesewas. */
  amountPesewas: number;
  email: string;
  channel: Channel;
  mobileMoney?: { network: MobileMoneyNetwork; phone: string };
  metadata?: Record<string, string>;
  /**
   * Send the church its share directly. The church receives the whole payment except
   * `maizzKeepsPesewas`, which stays with Maizz (it covers Maizz's fee and the provider's cut).
   */
  split?: { subaccountCode: string; maizzKeepsPesewas: number };
}

/** A bank or mobile money network a church can be paid through. */
export interface PayoutBank {
  name: string;
  code: string;
  kind: "mobile_money" | "bank";
}

export interface CreatePayoutAccountInput {
  businessName: string;
  bankCode: string;
  accountNumber: string;
}

export interface PayoutAccount {
  /** The provider's code for this church's payout account. */
  code: string;
  /** The account holder's name as the provider found it, to be compared with the church's name. */
  accountName: string;
}

export type InitializeResult =
  /** Mobile money: the giver approves on their phone. */
  | { kind: "prompt"; message: string }
  /** Mobile money: the giver must enter a one-time code, then call submitOtp. */
  | { kind: "otp_required"; message: string }
  /** Cards and bank transfer: send the giver to the provider's secure page. */
  | { kind: "redirect"; url: string }
  | { kind: "paid" }
  | { kind: "failed"; message: string };

export type ProviderStatus = "pending" | "succeeded" | "failed" | "abandoned";

export interface VerifyResult {
  reference: string;
  status: ProviderStatus;
  amountPesewas: number;
  currency: string;
  providerTransactionId: string;
  /** The provider's own word for the status, kept for logs and checks. Never shown to givers. */
  rawStatus?: string;
}

export interface RefundInput {
  reference: string;
  /** Leave out to refund the whole payment. */
  amountPesewas?: number;
}

export interface RefundResult {
  status: "pending" | "processed" | "failed";
  providerRefundId: string;
}

export type WebhookEventKind = "payment_succeeded" | "payment_failed" | "refund_processed" | "ignored";

export interface WebhookEvent {
  kind: WebhookEventKind;
  /** Unique per provider event, so a repeated notice is recorded once. */
  providerEventId: string;
  /** Maizz's gift reference (empty for ignored events). */
  reference: string;
  /** Payment amount, or the refunded amount for refund events. Whole pesewas. */
  amountPesewas?: number;
  currency?: string;
}

export interface ProviderCapabilities {
  channels: readonly Channel[];
  mobileMoneyNetworks: readonly MobileMoneyNetwork[];
  currencies: readonly string[];
  /** Cards (and bank transfer) show the provider's own secure page. */
  hostedPageForCards: boolean;
  partialRefunds: boolean;
}

export interface PaymentProvider {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;
  initialize(input: InitializeInput): Promise<InitializeResult>;
  submitOtp(reference: string, otp: string): Promise<InitializeResult>;
  /** Asks the provider directly. This is the trusted answer, not a notice sent to us. */
  verify(reference: string): Promise<VerifyResult>;
  refund(input: RefundInput): Promise<RefundResult>;
  /** The banks and mobile money networks churches can be paid through. */
  listPayoutBanks(): Promise<PayoutBank[]>;
  /** Sets up a church's payout account. No money moves. */
  createPayoutAccount(input: CreatePayoutAccountInput): Promise<PayoutAccount>;
  /** Checks the signature and turns the provider's notice into a WebhookEvent. Throws if it is not genuine. */
  parseWebhook(rawBody: string, signature: string | null): WebhookEvent;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
  }
}

export class WebhookSignatureError extends Error {}
export class WebhookPayloadError extends Error {}
