import { openAdminRoute } from "@/lib/adminAuth";
import { CHURCH_ACTIONS, runChurchAction, type ChurchAction } from "@/lib/churchAdmin";
import { getLedger, getPaymentProvider } from "@/lib/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Private tool: add churches, set up payout accounts, activate or suspend. Every call is audited.
// No full account number is stored or returned. The audit log never holds one either.
export async function POST(req: Request) {
  const text = await req.text();
  let input: unknown;
  try {
    input = text.length <= 4_000 ? JSON.parse(text) : null;
  } catch {
    input = null;
  }
  const body = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const action = CHURCH_ACTIONS.find((a) => a === body.action) as ChurchAction | undefined;
  const slug = typeof body.slug === "string" && /^[a-z0-9-]{1,80}$/.test(body.slug) ? body.slug : undefined;

  const denied = await openAdminRoute(req, process.env, `admin.church_${action ?? "invalid"}`, slug);
  if (denied) return denied;
  if (!action) return Response.json({ error: "Unknown action." }, { status: 400 });

  try {
    const reply = await runChurchAction({ ledger: getLedger(), provider: getPaymentProvider(), action, body });
    return Response.json(reply.body, { status: reply.status });
  } catch {
    return Response.json({ error: "Something went wrong. See the Vercel logs." }, { status: 502 });
  }
}
