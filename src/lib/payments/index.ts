import { requirePaystackSecret, requireSupabase, type Env } from "../config";
import { createSupabaseLedger, type Ledger } from "../ledger";
import { createPaystackProvider } from "./paystack";
import type { PaymentProvider } from "./types";

// Today there is one provider. A router that picks between providers comes later (step 11).
export function getPaymentProvider(env: Env = process.env): PaymentProvider {
  return createPaystackProvider({ secretKey: requirePaystackSecret(env) });
}

export function getLedger(env: Env = process.env): Ledger {
  const { url, serviceKey } = requireSupabase(env);
  return createSupabaseLedger({ url, serviceKey });
}
