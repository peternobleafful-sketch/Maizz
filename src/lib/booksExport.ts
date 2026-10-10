// A plain copy of the books (every gift and its current status) for the owner to keep. No names, phone numbers or emails.

const COLUMNS = "reference,church_id,gift_type,amount_pesewas,fee_pesewas,total_pesewas,status,refunded_pesewas,created_at";
const HEADER = COLUMNS.split(",");

export async function exportBooksCsv(opts: { url: string; serviceKey: string; fetchFn?: typeof fetch }): Promise<string> {
  const base = `${opts.url.replace(/\/+$/, "")}/rest/v1`;
  const fetchFn = opts.fetchFn ?? fetch;
  const headers: Record<string, string> = { apikey: opts.serviceKey };
  if (opts.serviceKey.startsWith("eyJ")) headers.Authorization = `Bearer ${opts.serviceKey}`;
  const lines = [HEADER.join(",")];
  const page = 1000;
  for (let offset = 0; offset < 1_000_000; offset += page) {
    const res = await fetchFn(`${base}/gift_status?select=${COLUMNS}&order=created_at.asc&limit=${page}&offset=${offset}`, {
      headers,
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Database refused the export (${res.status})`);
    const rows: unknown = await res.json();
    if (!Array.isArray(rows)) throw new Error("Unexpected reply for the export");
    for (const r of rows) {
      const rec = r as Record<string, unknown>;
      lines.push(HEADER.map((h) => String(rec[h] ?? "").replace(/[",\r\n]/g, " ")).join(","));
    }
    if (rows.length < page) break;
  }
  return lines.join("\r\n") + "\r\n";
}
