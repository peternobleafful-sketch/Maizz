import type { StaffService } from "./staff";
import type { StaffUser } from "./staff";

// The owner's authenticator app: set up, check, and make new recovery codes. Called from /api/owner/authenticator
// after the owner sign-in has been checked and the call has been written to the audit log.

type Body = { status: number; body: Record<string, unknown> };
const NO = (status: number, error: string): Body => ({ status, body: { error } });

export async function handleAuthenticator(args: {
  service: StaffService;
  user: StaffUser;
  action: unknown;
  code: unknown;
  sourceKey: string;
  /** Turns the app link into a QR picture (SVG text). */
  qr: (uri: string) => Promise<string>;
}): Promise<Body> {
  const { service, user, code, sourceKey } = args;
  switch (args.action) {
    case "status":
      return { status: 200, body: { ...(await service.authenticatorStatus(user.id)) } };

    case "begin": {
      const r = await service.beginAuthenticator(user.id);
      if (!r.ok) return r.reason === "already" ? NO(400, "The authenticator app is already switched on.") : NO(503, "Could not start. Try again in a minute.");
      return { status: 200, body: { secret: r.secret, qr: await args.qr(r.uri) } };
    }

    case "confirm": {
      const r = await service.finishAuthenticator(user.id, code, sourceKey);
      if (r.ok) return { status: 200, body: { recoveryCodes: r.recoveryCodes } };
      if (r.reason === "wrong") return NO(403, "That code is not right. Wait for the next code in the app and try again.");
      if (r.reason === "locked") return NO(429, "Too many tries. Wait 15 minutes and try again.");
      if (r.reason === "none") return NO(400, "Start the set-up first.");
      return NO(503, "Could not check the code. Try again in a minute.");
    }

    case "renew": {
      const r = await service.renewRecoveryCodes(user.id, code, sourceKey);
      if (r.ok) return { status: 200, body: { recoveryCodes: r.recoveryCodes } };
      if (r.reason === "wrong") return NO(403, "That code is not right. Use the current code from the app (not a recovery code).");
      if (r.reason === "locked") return NO(429, "Too many tries. Wait 15 minutes and try again.");
      if (r.reason === "none") return NO(400, "The authenticator app is not switched on.");
      return NO(503, "Could not make new codes. Try again in a minute.");
    }
  }
  return NO(400, "Bad request");
}
