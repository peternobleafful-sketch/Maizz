import type { AuditLog } from "./audit";
import { runChurchAction, type ChurchAction } from "./churchAdmin";
import type { Ledger } from "./ledger";
import { logError } from "./log";
import type { PaymentProvider } from "./payments/types";
import type { StaffService, StaffUser } from "./staff";
import { PUBLIC_URL_MESSAGE } from "./config";
import { churchMemberKey } from "./memberLink";
import { readJson, sameSite } from "./staffRoutes";

// The church tools of the Maizz owner: add a church, set its payout account, open or suspend it, send an invite again.
// Everything here sits behind the owner sign-in (password and emailed code). Changing a payout account also needs a fresh emailed code,
// and the church's own owners are emailed afterwards. The audit record is written before anything changes.

export const OWNER_CHURCH_ACTIONS = ["list", "banks", "create", "payout_code", "payout", "activate", "suspend", "team", "resend", "member_link", "member_link_on", "member_link_off", "member_link_key", "member_link_new_key"] as const;
export type OwnerChurchAction = (typeof OWNER_CHURCH_ACTIONS)[number];

export interface OwnerChurchDeps {
  req: Request;
  /** The owner sign-in service (owner people, owner sessions). */
  ownerService: Pick<StaffService, "getSession" | "startStepUp" | "verifyStepUp">;
  /** The church sign-in service, used to email a church's own owners and to resend an invite. */
  churchService: Pick<StaffService, "tellChurchOwnersPayoutChanged" | "resendInvite">;
  listChurchPeople(churchId: string): Promise<StaffUser[]>;
  audit: AuditLog;
  ledger: Ledger;
  provider: PaymentProvider;
  /** The owner's session cookie value. */
  cookie: string | undefined;
  /** Hashed source address. */
  source: string;
  /** From MAIZZ_PUBLIC_URL; null when not set, in which case no invite link can be made. */
  baseUrl: string | null;
  /** True with a live payment key: a payout change then needs the authenticator app, not an emailed code. */
  requireApp?: boolean;
  /** MEMBER_LINK_MASTER_KEY, or null when it is not set (the Church Manager link is then off everywhere). */
  memberMaster?: string | null;
}

const NO = (status: number, error: string) => Response.json({ error }, { status });

export async function handleOwnerChurches(d: OwnerChurchDeps): Promise<Response> {
  if (!sameSite(d.req)) return NO(403, "Not allowed");
  const body = await readJson(d.req);
  const action = OWNER_CHURCH_ACTIONS.find((a) => a === body?.action);
  if (!body || !action) return NO(400, "Bad request");

  let me: StaffUser | null;
  try {
    me = (await d.ownerService.getSession(d.cookie))?.user ?? null;
  } catch {
    return NO(503, "Sign-in is not available right now.");
  }
  if (!me) return NO(401, "Please sign in again.");
  const actor = `owner:${me.id}`;
  const slug = typeof body.slug === "string" && /^[a-z0-9-]{1,80}$/.test(body.slug) ? body.slug : undefined;

  // Writes first, so a change never happens unrecorded. If the record cannot be written, nothing changes.
  async function recordFirst(what: string): Promise<boolean> {
    try {
      await d.audit.record({ actor, action: `owner.church_${what}`, target: slug, outcome: "ok", sourceKey: d.source });
      return true;
    } catch {
      return false;
    }
  }
  const unrecorded = () => NO(503, "The audit log is not available, so nothing was changed. Try again in a minute.");

  try {
    switch (action) {
      case "list":
      case "banks": {
        const r = await runChurchAction({ ledger: d.ledger, provider: d.provider, action, body });
        return Response.json(r.body, { status: r.status });
      }

      case "create": {
        if (!d.baseUrl) return NO(503, PUBLIC_URL_MESSAGE);
        if (!(await recordFirst("create"))) return unrecorded();
        const r = await runChurchAction({ ledger: d.ledger, provider: d.provider, action: "create", body });
        return Response.json(r.body, { status: r.status });
      }

      case "activate":
      case "suspend": {
        if (!slug) return NO(400, "Choose a church.");
        if (!(await recordFirst(action))) return unrecorded();
        const r = await runChurchAction({ ledger: d.ledger, provider: d.provider, action: action as ChurchAction, body });
        return Response.json(r.body, { status: r.status });
      }

      case "payout_code": {
        if (!slug) return NO(400, "Choose a church.");
        if (d.requireApp && !me.totp?.enabled) {
          return NO(403, "With real money, changing a payout account needs your authenticator app. Set it up first on the System page.");
        }
        const r = await d.ownerService.startStepUp(d.cookie, d.source);
        if (r.ok) {
          return Response.json({
            challenge: r.challenge,
            method: r.method,
            message: r.method === "app" ? "Enter the current code from your authenticator app." : "A code was emailed to you. It works once, for 10 minutes.",
          });
        }
        if (r.reason === "signed_out") return NO(401, "Please sign in again.");
        if (r.reason === "locked") return NO(429, "Too many codes were asked for. Wait 15 minutes and try again.");
        return NO(503, "The code email could not be sent. Check that email sending is set up.");
      }

      case "payout": {
        if (!slug) return NO(400, "Choose a church.");
        const church = await d.ledger.findChurch(slug);
        if (!church) return NO(404, "No such church.");
        // The fresh code is checked first. Without it, nothing is sent to the payment provider.
        const check = await d.ownerService.verifyStepUp(d.cookie, body.challenge, body.code, d.source);
        if (!check.ok) {
          if (check.reason === "signed_out") return NO(401, "Please sign in again.");
          if (check.reason === "locked") return NO(429, "Too many wrong codes. Wait 15 minutes and try again.");
          if (check.reason === "wrong") return NO(403, "That code is not right.");
          if (check.reason === "expired") return NO(403, "That code has expired or was already used. Ask for a new one.");
          return NO(503, "The code could not be checked. Try again in a minute.");
        }
        if (!(await recordFirst("payout"))) return unrecorded();
        const r = await runChurchAction({ ledger: d.ledger, provider: d.provider, action: "payout", body });
        if (r.status !== 200) return Response.json(r.body, { status: r.status });
        const fresh = await d.ledger.findChurch(slug);
        let told = 0;
        try {
          told = await d.churchService.tellChurchOwnersPayoutChanged({
            churchId: church.id,
            churchName: church.name,
            bankName: fresh?.payoutBankName ?? null,
            last4: fresh?.payoutAccountLast4 ?? null,
          });
        } catch (err) {
          logError("owner.payout_notice_failed", { reason: err instanceof Error ? err.message : "unknown" });
        }
        try {
          await d.audit.record({ actor, action: "owner.church_payout_notified", target: slug, outcome: told > 0 ? "ok" : "failed", sourceKey: d.source, detail: { emailed: told } });
        } catch {
          // The change itself was already recorded.
        }
        return Response.json({
          ...r.body,
          emailed: told,
          notice:
            told > 0
              ? `The church's owners (${told}) were emailed about the change.`
              : "No church owner could be emailed (none has been invited yet, or email failed). Tell the church yourself.",
        });
      }

      case "team": {
        if (!slug) return NO(400, "Choose a church.");
        const church = await d.ledger.findChurch(slug);
        if (!church) return NO(404, "No such church.");
        const people = await d.listChurchPeople(church.id);
        return Response.json({ people: people.map((u) => ({ id: u.id, name: u.fullName, email: u.email, role: u.role, status: u.status })) });
      }

      case "resend": {
        if (!d.baseUrl) return NO(503, PUBLIC_URL_MESSAGE);
        if (!slug || typeof body.userId !== "string") return NO(400, "Choose a church and a person.");
        const church = await d.ledger.findChurch(slug);
        if (!church) return NO(404, "No such church.");
        const people = await d.listChurchPeople(church.id);
        // Only people who belong to this church can be sent an invite from here.
        if (!people.some((u) => u.id === body.userId)) return NO(404, "That person was not found in this church.");
        if (!(await recordFirst("invite_resend"))) return unrecorded();
        await d.churchService.resendInvite({ userId: body.userId, churchName: church.name, baseUrl: d.baseUrl });
        return Response.json({ ok: true, message: "A new invite email was sent." });
      }

      case "member_link": {
        if (!slug) return NO(400, "Choose a church.");
        const church = await d.ledger.findChurch(slug);
        if (!church) return NO(404, "No such church.");
        return Response.json({ memberLink: { available: !!d.memberMaster, enabled: church.memberLinkEnabled, keyVersion: church.memberLinkVersion } });
      }

      case "member_link_on":
      case "member_link_off":
      case "member_link_new_key": {
        if (!slug) return NO(400, "Choose a church.");
        if (!d.memberMaster) return NO(503, "The Church Manager link is not set up yet. Add MEMBER_LINK_MASTER_KEY in Vercel first.");
        const church = await d.ledger.findChurch(slug);
        if (!church) return NO(404, "No such church.");
        if (!(await recordFirst(action))) return unrecorded();
        if (action === "member_link_new_key") await d.ledger.setMemberLink(church.id, { replaceKey: true });
        else await d.ledger.setMemberLink(church.id, { enabled: action === "member_link_on" });
        const fresh = await d.ledger.findChurch(slug);
        return Response.json({
          memberLink: { available: true, enabled: fresh?.memberLinkEnabled ?? false, keyVersion: fresh?.memberLinkVersion ?? church.memberLinkVersion },
          message:
            action === "member_link_new_key"
              ? "A new key was made. The old key stops working now. Show the new key and put it into Church Manager."
              : action === "member_link_on"
                ? "The Church Manager link is on for this church."
                : "The Church Manager link is off for this church.",
        });
      }

      case "member_link_key": {
        if (!slug) return NO(400, "Choose a church.");
        if (!d.memberMaster) return NO(503, "The Church Manager link is not set up yet. Add MEMBER_LINK_MASTER_KEY in Vercel first.");
        const church = await d.ledger.findChurch(slug);
        if (!church) return NO(404, "No such church.");
        // The key lets Church Manager tag gifts and read a member's history, so a fresh code is needed to see it.
        const check = await d.ownerService.verifyStepUp(d.cookie, body.challenge, body.code, d.source);
        if (!check.ok) {
          if (check.reason === "signed_out") return NO(401, "Please sign in again.");
          if (check.reason === "locked") return NO(429, "Too many wrong codes. Wait 15 minutes and try again.");
          if (check.reason === "wrong") return NO(403, "That code is not right.");
          if (check.reason === "expired") return NO(403, "That code has expired or was already used. Ask for a new one.");
          return NO(503, "The code could not be checked. Try again in a minute.");
        }
        if (!(await recordFirst("member_link_key_shown"))) return unrecorded();
        const res = Response.json({ key: churchMemberKey(d.memberMaster, church.id, church.memberLinkVersion), keyVersion: church.memberLinkVersion });
        res.headers.set("Cache-Control", "no-store");
        return res;
      }
    }
  } catch (err) {
    logError("owner.church_failed", { action, reason: err instanceof Error ? err.message : "unknown" });
    return NO(502, "Something went wrong. See the Vercel logs.");
  }
  return NO(400, "Bad request");
}
