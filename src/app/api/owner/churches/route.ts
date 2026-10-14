import { getAudit } from "@/lib/audit";
import { classifyPaystackKey, publicBaseUrl, requireSupabase } from "@/lib/config";
import { handleOwnerChurches } from "@/lib/ownerChurches";
import { getLedger, getPaymentProvider } from "@/lib/payments";
import { sourceOf } from "@/lib/staffRoutes";
import { getStaffService, OWNER_COOKIE, readCookie } from "@/lib/staffRuntime";
import { createSupabaseStaffStore } from "@/lib/staffStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The Maizz owner's church tools. Needs the owner sign-in; a church sign-in cannot open it.
// Setting a payout account also needs a fresh emailed code. See src/lib/ownerChurches.ts.
export async function POST(req: Request) {
  try {
    const { url, serviceKey } = requireSupabase(process.env);
    return await handleOwnerChurches({
      req,
      ownerService: getStaffService(process.env, { area: "owner" }),
      churchService: getStaffService(process.env, { area: "church" }),
      listChurchPeople: (churchId) => createSupabaseStaffStore({ url, serviceKey }).listUsers(churchId),
      audit: getAudit(),
      ledger: getLedger(),
      provider: getPaymentProvider(),
      cookie: readCookie(req, OWNER_COOKIE),
      source: sourceOf(req),
      baseUrl: publicBaseUrl(process.env),
      requireApp: classifyPaystackKey(process.env.PAYSTACK_SECRET_KEY) === "live",
    });
  } catch {
    return Response.json({ error: "Sign-in is not available right now." }, { status: 503 });
  }
}
