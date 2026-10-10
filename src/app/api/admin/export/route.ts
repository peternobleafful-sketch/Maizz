import { openAdminRoute } from "@/lib/adminAuth";
import { exportBooksCsv } from "@/lib/booksExport";
import { requireSupabase } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Private tool: download every gift and its status as a CSV, to keep a copy of the books off Supabase.
export async function POST(req: Request) {
  const denied = await openAdminRoute(req, process.env, "admin.export_books");
  if (denied) return denied;
  try {
    const { url, serviceKey } = requireSupabase(process.env);
    const csv = await exportBooksCsv({ url, serviceKey });
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="maizz-books-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json({ error: "Could not export the books. See the Vercel logs." }, { status: 502 });
  }
}
