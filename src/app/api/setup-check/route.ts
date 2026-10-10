import { requireAdmin } from "@/lib/adminAuth";
import { runSetupChecks } from "@/lib/setupCheck";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Private. Switched off (404) unless SETUP_CHECK_TOKEN is set. Never returns any key or secret.
export async function POST(req: Request) {
  const denied = requireAdmin(req, process.env);
  if (denied) return denied;
  const checks = await runSetupChecks(process.env);
  return Response.json({ checks });
}
