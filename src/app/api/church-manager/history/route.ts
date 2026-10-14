import { getAudit, sourceKeyFor } from "@/lib/audit";
import { handleMemberHistory } from "@/lib/memberHistory";
import { memberMasterKey } from "@/lib/memberLink";
import { getNotifier } from "@/lib/notifyRuntime";
import { getLedger } from "@/lib/payments";
import { rateSecret } from "@/lib/rateKey";
import { readCappedText } from "@/lib/staffRoutes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Church Manager's backend (WordPress) asks for one member's paid gifts to one church. Signed with that church's key; read only.
// See src/lib/memberHistory.ts and docs/CHURCH_MANAGER_LINK.md.
export async function POST(req: Request) {
  const text = await readCappedText(req, 2_000).catch(() => null);
  if (text === null) return Response.json({ error: "Bad request" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  try {
    return await handleMemberHistory({
      body,
      ledger: getLedger(),
      audit: getAudit(),
      master: memberMasterKey(process.env),
      source: sourceKeyFor(req, rateSecret(process.env)),
      nowMs: Date.now(),
      onBadSpike: () =>
        getNotifier().alert("member_history_spike", "Many bad requests to the Church Manager history address", [
          "Requests with a wrong signature keep arriving. Nothing real is exposed: every refusal looks the same.",
          "If you did not just change a key, switch the Church Manager link off for the church concerned, or make a new key.",
        ]),
    });
  } catch {
    return Response.json({ error: "Not available right now. Try again shortly." }, { status: 503 });
  }
}
