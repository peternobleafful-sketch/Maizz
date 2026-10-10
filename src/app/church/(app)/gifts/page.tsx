import type { Metadata } from "next";
import Link from "next/link";
import { GIFT_TYPE_LABELS } from "@/lib/checkout";
import { netPesewas } from "@/lib/churchData";
import { longDate, shortDate, typeLabel } from "@/lib/format";
import { formatCedis } from "@/lib/money";
import { can, requireChurchSession } from "@/lib/staffSession";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Gifts | Maizz", robots: { index: false } };

const RANGES = [
  { key: "7", label: "7 days", days: 7 },
  { key: "30", label: "30 days", days: 30 },
  { key: "90", label: "90 days", days: 90 },
  { key: "all", label: "All time", days: 0 },
] as const;

type Params = { type?: string; range?: string; anon?: string };

export default async function Gifts({ searchParams }: { searchParams: Promise<Params> }) {
  const { user, church, data } = await requireChurchSession();
  const p = await searchParams;
  const range = RANGES.find((r) => r.key === p.range) ?? RANGES[1];
  const type = p.type && p.type in GIFT_TYPE_LABELS ? p.type : "";
  const anon = p.anon === "1";

  const since = range.days ? new Date(Date.now() - range.days * 86_400_000).toISOString() : undefined;
  const all = await data.listPaidGifts(church.id, { sinceIso: since, limit: 2000 });
  const gifts = all.filter((g) => (!type || g.giftType === type) && (!anon || g.giverName === null));
  const shown = gifts.slice(0, 200);
  const sum = gifts.reduce((t, g) => t + netPesewas(g), 0);

  const href = (over: Partial<Params>) => {
    const next = { type, range: range.key, anon: anon ? "1" : "", ...over };
    const qs = new URLSearchParams(Object.entries(next).filter(([, v]) => v)).toString();
    return `/church/gifts${qs ? `?${qs}` : ""}`;
  };
  const exportQs = new URLSearchParams({ range: range.key, ...(type ? { type } : {}), ...(anon ? { anon: "1" } : {}) }).toString();

  return (
    <>
      <div className="dash-head with-action">
        <div>
          <h1>Gifts</h1>
          <p>Paid gifts to {church.name}</p>
        </div>
        {can(user.role, "finance") && gifts.length > 0 && (
          <a className="dash-btn ghost" href={`/api/church/export?${exportQs}`}>Download CSV</a>
        )}
      </div>

      <div className="dash-chips" role="group" aria-label="Date range">
        {RANGES.map((r) => (
          <Link key={r.key} href={href({ range: r.key })} className={r.key === range.key ? "chip on" : "chip"}>{r.label}</Link>
        ))}
        <Link href={href({ anon: anon ? "" : "1" })} className={anon ? "chip on" : "chip"}>Anonymous only</Link>
      </div>
      <div className="dash-chips" role="group" aria-label="Gift type">
        <Link href={href({ type: "" })} className={!type ? "chip on" : "chip"}>All types</Link>
        {Object.entries(GIFT_TYPE_LABELS).map(([k, label]) => (
          <Link key={k} href={href({ type: k })} className={type === k ? "chip on" : "chip"}>{label}</Link>
        ))}
      </div>

      {gifts.length === 0 ? (
        <section className="dash-card dash-empty">
          <h2>No gifts to show</h2>
          <p>Nothing matches these filters, or no one has given yet. Gifts show here within a minute of being paid.</p>
          <Link className="dash-btn ghost" href="/church/gifts">Clear filters</Link>
        </section>
      ) : (
        <section className="dash-card flush">
          <p className="dash-sum"><span>{gifts.length} {gifts.length === 1 ? "gift" : "gifts"}</span><strong>{formatCedis(sum)}</strong></p>
          <div className="dash-table-head" aria-hidden="true"><span>Giver</span><span>Type</span><span>Date</span><span>Gift</span></div>
          <ul className="dash-gifts table">
            {shown.map((g) => (
              <li key={g.reference}>
                <Link href={`/church/gifts/${g.reference}`}>
                  <span className="who">
                    <strong>{g.giverName ?? "Anonymous"}</strong>
                    <small>{typeLabel(g.giftType)} · {shortDate(g.createdAt)}</small>
                  </span>
                  <span className="col">{typeLabel(g.giftType)}</span>
                  <span className="col">{longDate(g.createdAt)}</span>
                  <span className="dash-amt">
                    {formatCedis(netPesewas(g))}
                    {g.status === "refunded" && <em className="tag-small">Refunded</em>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {gifts.length > shown.length && <p className="dash-muted pad">Showing the latest {shown.length}. Narrow the dates or download the CSV for the rest.</p>}
        </section>
      )}
    </>
  );
}
