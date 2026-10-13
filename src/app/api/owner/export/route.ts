import { exportBooksCsv } from "@/lib/booksExport";
import { requireSupabase } from "@/lib/config";
import { openOwnerRoute } from "@/lib/ownerRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The owner downloads every gift and its status as a CSV (no names, phones or emails). Needs the owner sign-in.
export async function POST(req: Request) {
  const opened = await openOwnerRoute(req, "owner.export_books");
  if (opened instanceof Response) return opened;
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
