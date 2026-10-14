import { classifyPaystackKey, type Env } from "./config";
import type { StaffUser } from "./staff";

/**
 * With a live Paystack key, the owner dashboard and the owner tools stay shut until the authenticator app is on.
 * Test mode is unchanged. Only the screens and calls needed to switch the app on are open until then,
 * so a stolen password and inbox alone can never reach the live money tools.
 */
export function ownerNeedsApp(env: Env, user: Pick<StaffUser, "totp">): boolean {
  return classifyPaystackKey(env.PAYSTACK_SECRET_KEY) === "live" && user.totp?.enabled !== true;
}

/** The only owner calls allowed while the app is still off under a live key. */
export function allowedBeforeApp(action: string): boolean {
  return action.startsWith("owner.authenticator_");
}
