import { createHmac, timingSafeEqual } from "node:crypto";
import { assertPositivePesewas } from "../money";
import {
  ProviderError,
  WebhookPayloadError,
  WebhookSignatureError,
  type InitializeInput,
  type InitializeResult,
  type MobileMoneyNetwork,
  type PaymentProvider,
  type ProviderStatus,
  type RefundInput,
  type RefundResult,
  type VerifyResult,
  type WebhookEvent,
} from "./types";

const API = "https://api.paystack.co";
const REFERENCE = /^[A-Za-z0-9_.=-]{8,100}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Paystack's codes for the Ghana mobile money networks.
const NETWORK_CODE: Record<MobileMoneyNetwork, string> = {
  mtn: "mtn",
  vodafone: "vod",
  airteltigo: "atl",
};

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function text(v: unknown): string | undefined {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined;
}

function wholeNumber(v: unknown, label: string): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) {
    throw new ProviderError(`Paystack sent an unexpected ${label}`);
  }
  return v;
}

export interface PaystackOptions {
  secretKey: string;
  fetchFn?: typeof fetch;
}

export function createPaystackProvider(opts: PaystackOptions): PaymentProvider {
  const { secretKey } = opts;
  const fetchFn = opts.fetchFn ?? fetch;

  async function call(method: "GET" | "POST", path: string, body?: Rec): Promise<Rec> {
    let res: Response;
    try {
      res = await fetchFn(`${API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new ProviderError("Could not reach Paystack");
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new ProviderError("Paystack sent a reply we could not read", res.status);
    }
    if (!isRec(json)) throw new ProviderError("Paystack sent an unexpected reply", res.status);
    if (!res.ok || json.status !== true) {
      throw new ProviderError(text(json.message) ?? "Paystack refused the request", res.status);
    }
    if (!isRec(json.data)) throw new ProviderError("Paystack reply had no data", res.status);
    return json.data;
  }

  function mapCharge(data: Rec): InitializeResult {
    const message = text(data.display_text) ?? text(data.message) ?? "";
    switch (text(data.status)) {
      case "success":
        return { kind: "paid" };
      case "failed":
        return { kind: "failed", message: message || "The payment did not go through." };
      case "send_otp":
        return { kind: "otp_required", message: message || "Enter the code sent to your phone." };
      case "pay_offline":
      case "pending":
      case "send_pin":
        return { kind: "prompt", message: message || "Approve the payment on your phone." };
      default:
        throw new ProviderError("Paystack sent an unexpected payment status");
    }
  }

  function mapStatus(s: string | undefined): ProviderStatus {
    switch (s) {
      case "success":
        return "succeeded";
      case "failed":
        return "failed";
      case "abandoned":
        return "abandoned";
      default:
        return "pending";
    }
  }

  return {
    name: "paystack",

    capabilities: {
      channels: ["mobile_money", "card", "bank_transfer"],
      mobileMoneyNetworks: ["mtn", "vodafone", "airteltigo"],
      currencies: ["GHS"],
      hostedPageForCards: true,
      partialRefunds: true,
    },

    async initialize(input: InitializeInput): Promise<InitializeResult> {
      if (!REFERENCE.test(input.reference)) throw new ProviderError("Invalid gift reference");
      assertPositivePesewas(input.amountPesewas, "amount");
      if (!EMAIL.test(input.email)) throw new ProviderError("A valid email address is needed");

      const common = {
        email: input.email,
        amount: input.amountPesewas,
        currency: "GHS",
        reference: input.reference,
        metadata: input.metadata ?? {},
      };

      if (input.channel === "mobile_money") {
        const mm = input.mobileMoney;
        if (!mm) throw new ProviderError("Mobile money details are needed");
        // Charged straight from the Maizz page: the giver gets a prompt on their phone.
        const data = await call("POST", "/charge", {
          ...common,
          mobile_money: { phone: mm.phone, provider: NETWORK_CODE[mm.network] },
        });
        return mapCharge(data);
      }

      // Cards and bank transfer use Paystack's secure page.
      const data = await call("POST", "/transaction/initialize", {
        ...common,
        channels: [input.channel === "card" ? "card" : "bank_transfer"],
      });
      const url = text(data.authorization_url);
      if (!url || !url.startsWith("https://")) throw new ProviderError("Paystack sent no payment page");
      return { kind: "redirect", url };
    },

    async submitOtp(reference: string, otp: string): Promise<InitializeResult> {
      if (!REFERENCE.test(reference)) throw new ProviderError("Invalid gift reference");
      if (!/^\d{4,8}$/.test(otp)) throw new ProviderError("The code should be 4 to 8 digits");
      const data = await call("POST", "/charge/submit_otp", { otp, reference });
      return mapCharge(data);
    },

    async verify(reference: string): Promise<VerifyResult> {
      if (!REFERENCE.test(reference)) throw new ProviderError("Invalid gift reference");
      const data = await call("GET", `/transaction/verify/${encodeURIComponent(reference)}`);
      return {
        reference: text(data.reference) ?? reference,
        status: mapStatus(text(data.status)),
        amountPesewas: wholeNumber(data.amount, "amount"),
        currency: text(data.currency) ?? "",
        providerTransactionId: text(data.id) ?? "",
      };
    },

    async refund(input: RefundInput): Promise<RefundResult> {
      if (!REFERENCE.test(input.reference)) throw new ProviderError("Invalid gift reference");
      const body: Rec = { transaction: input.reference };
      if (input.amountPesewas !== undefined) {
        assertPositivePesewas(input.amountPesewas, "refund amount");
        body.amount = input.amountPesewas;
      }
      const data = await call("POST", "/refund", body);
      const s = text(data.status);
      return {
        status: s === "processed" ? "processed" : s === "failed" ? "failed" : "pending",
        providerRefundId: text(data.id) ?? "",
      };
    },

    parseWebhook(rawBody: string, signature: string | null): WebhookEvent {
      if (!signature) throw new WebhookSignatureError("Missing signature");
      const expected = Buffer.from(createHmac("sha512", secretKey).update(rawBody).digest("hex"), "utf8");
      const sent = Buffer.from(signature.trim().toLowerCase(), "utf8");
      if (expected.length !== sent.length || !timingSafeEqual(expected, sent)) {
        throw new WebhookSignatureError("Signature does not match");
      }

      let payload: unknown;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        throw new WebhookPayloadError("Body is not JSON");
      }
      if (!isRec(payload) || typeof payload.event !== "string" || !isRec(payload.data)) {
        throw new WebhookPayloadError("Unexpected notice shape");
      }
      const event = payload.event;
      const data = payload.data;

      if (event === "charge.success") {
        const id = text(data.id);
        const reference = text(data.reference);
        if (!id || !reference || data.status !== "success") {
          throw new WebhookPayloadError("Incomplete charge.success notice");
        }
        return {
          kind: "payment_succeeded",
          providerEventId: `paystack:charge.success:${id}`,
          reference,
          amountPesewas: wholeNumber(data.amount, "amount"),
          currency: text(data.currency),
        };
      }

      if (event === "refund.processed") {
        const refundId = text(data.id) ?? text(data.refund_reference);
        const transaction = isRec(data.transaction) ? data.transaction : {};
        const reference = text(data.transaction_reference) ?? text(transaction.reference);
        if (!refundId || !reference) throw new WebhookPayloadError("Incomplete refund.processed notice");
        return {
          kind: "refund_processed",
          providerEventId: `paystack:refund.processed:${refundId}`,
          reference,
          amountPesewas: wholeNumber(data.amount, "refund amount"),
          currency: text(data.currency),
        };
      }

      return { kind: "ignored", providerEventId: `paystack:${event}`, reference: "" };
    },
  };
}
