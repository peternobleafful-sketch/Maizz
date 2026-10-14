import { getAudit } from "@/lib/audit";
import { readCspReport, saveCspReport } from "@/lib/cspReport";
import { readCappedText, sourceOf } from "@/lib/staffRoutes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Browsers post here when a page tries something the policy would block. Public by nature, so: small, rate-capped,
// and only the rule, the blocked place's address and the page path are kept (no query, no page content).
export async function POST(req: Request) {
  // Never read more than the report limit, whatever is sent.
  const text = await readCappedText(req, 10_000).catch(() => null);
  const report = text ? readCspReport(text) : null;
  if (report) await saveCspReport(getAudit(), sourceOf(req), report);
  return new Response(null, { status: 204 });
}
