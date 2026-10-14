import type { AuditLog } from "./audit";
import { churchMemberKey, verifyHistoryRequest } from "./memberLink";
import type { Ledger } from "./ledger";
import { logError } from "./log";

// Church Manager's backend asks: "what has this member given to this church?". Server to server, signed, read only.
// Every refusal looks the same, so nobody can learn which churches exist or have the link switched on.

export const HISTORY_LIMITS = {
  /** Requests from one source address in the window. */
  perSource: 120,
  /** Requests that failed the signature check from one source in the window. */
  badPerSource: 20,
  minutes: 10,
  /** Failed signatures across the whole site in an hour that raise an alert (nothing is blocked by it). */
  badSiteAlert: 50,
} as const;

const NO = (status: number, error: string, headers?: Record<string, string>) =>
  Response.json({ error }, { status, headers: { "Cache-Control": "no-store", ...headers } });

export interface MemberHistoryDeps {
  body: unknown;
  ledger: Ledger;
  audit: AuditLog;
  master: string | null;
  /** Hashed source address. */
  source: string;
  nowMs: number;
  /** Called once when failed signatures pass the site-wide alert line. Must not throw. */
  onBadSpike?: () => Promise<void>;
}

export async function handleMemberHistory(d: MemberHistoryDeps): Promise<Response> {
  const b = typeof d.body === "object" && d.body !== null ? (d.body as Record<string, unknown>) : null;
  if (!b) return NO(400, "Bad request");
  if (!d.master) return NO(401, "Not allowed");
  try {
    const seen = await d.audit.hit({ action: "member_history.attempt", sourceKey: d.source, minutes: HISTORY_LIMITS.minutes });
    if (seen > HISTORY_LIMITS.perSource) return NO(429, "Too many requests. Wait a few minutes.", { "Retry-After": "600" });
    if ((await d.audit.countHits("member_history.bad", HISTORY_LIMITS.minutes, d.source)) >= HISTORY_LIMITS.badPerSource) {
      return NO(429, "Too many requests. Wait a few minutes.", { "Retry-After": "600" });
    }

    const slug = typeof b.church === "string" && /^[a-z0-9-]{1,80}$/.test(b.church) ? b.church : null;
    const church = slug ? await d.ledger.findChurch(slug) : null;
    const key = church && church.memberLinkEnabled ? churchMemberKey(d.master, church.id, church.memberLinkVersion) : null;
    const member = church && key ? verifyHistoryRequest(key, church.slug, { member: b.member, timestamp: b.timestamp, signature: b.signature }, d.nowMs) : null;
    if (!church || !member) {
      await d.audit.hit({ action: "member_history.bad", sourceKey: d.source, minutes: HISTORY_LIMITS.minutes });
      const site = await d.audit.hit({ action: "member_history.bad_site", sourceKey: "all", minutes: 60 }).catch(() => 0);
      if (site === HISTORY_LIMITS.badSiteAlert) await d.onBadSpike?.().catch(() => undefined);
      return NO(401, "Not allowed");
    }

    const gifts = await d.ledger.listMemberGifts(church.id, member);
    return Response.json(
      {
        church: church.slug,
        currency: "GHS",
        // Amounts are whole pesewas. "gift" is what the church received; "paid" is what the member paid with fees.
        gifts: gifts.map((g) => ({
          date: g.createdAt,
          type: g.giftType,
          giftPesewas: g.amountPesewas,
          paidPesewas: g.totalPesewas,
          refundedPesewas: g.refundedPesewas,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    logError("member_history.failed", { reason: err instanceof Error ? err.message : "unknown" });
    return NO(503, "Not available right now. Try again shortly.");
  }
}
