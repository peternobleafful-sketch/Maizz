import { getAudit } from "@/lib/audit";
import { giftsToCsv, createSupabaseChurchData } from "@/lib/churchData";
import { GIFT_TYPE_LABELS } from "@/lib/checkout";
import { requireSupabase } from "@/lib/config";
import { typeLabel } from "@/lib/format";
import { getLedger } from "@/lib/payments";
import { getStaffService, readCookie } from "@/lib/staffRuntime";
import { sourceOf } from "@/lib/staffRoutes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RANGE_DAYS: Record<string, number> = { "7": 7, "30": 30, "90": 90, all: 0 };

// Finance and owners can download their church's paid gifts. Names only for gifts that are not anonymous. Never phone numbers.
export async function GET(req: Request) {
  let session;
  try {
    session = await getStaffService(process.env, { needMail: false }).getSession(readCookie(req));
  } catch {
    return new Response("Not available", { status: 503 });
  }
  if (!session) return new Response("Please sign in again.", { status: 401 });
  const me = session.user;
  if (me.role === "viewer") return new Response("Not allowed", { status: 403 });

  const u = new URL(req.url);
  const days = RANGE_DAYS[u.searchParams.get("range") ?? "30"] ?? 30;
  const typeParam = u.searchParams.get("type") ?? "";
  const type = typeParam in GIFT_TYPE_LABELS ? typeParam : "";
  const anon = u.searchParams.get("anon") === "1";

  const church = (await getLedger().listChurches()).find((c) => c.id === me.churchId);
  if (!church) return new Response("Not allowed", { status: 403 });
  const { url, serviceKey } = requireSupabase(process.env);
  const gifts = (
    await createSupabaseChurchData({ url, serviceKey }).listPaidGifts(church.id, {
      sinceIso: days ? new Date(Date.now() - days * 86_400_000).toISOString() : undefined,
      limit: 5000,
    })
  ).filter((g) => (!type || g.giftType === type) && (!anon || g.giverName === null));

  try {
    await getAudit().record({
      actor: `staff:${me.id}`,
      action: "church.export",
      target: church.id,
      outcome: "ok",
      sourceKey: sourceOf(req),
      detail: { gifts: gifts.length },
    });
  } catch {
    // Every download is recorded. If the record cannot be written, nothing is handed over.
    return new Response("Not available right now. Try again in a minute.", { status: 503 });
  }

  const day = new Date().toISOString().slice(0, 10);
  return new Response(giftsToCsv(gifts, typeLabel), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${church.slug}-gifts-${day}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
