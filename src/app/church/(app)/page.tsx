import type { Metadata } from "next";
import Link from "next/link";
import { netPesewas, summarise } from "@/lib/churchData";
import { longDate, typeLabel } from "@/lib/format";
import { formatCedis } from "@/lib/money";
import { requireChurchSession } from "@/lib/staffSession";
import { headers } from "next/headers";
import CopyButton from "./CopyButton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Overview | Maizz", robots: { index: false } };

export default async function Overview() {
  const { church, data } = await requireChurchSession();
  const now = Date.now();
  const gifts = await data.listPaidGifts(church.id, { limit: 5000 });
  const s = summarise(gifts, now);
  const host = (await headers()).get("host") ?? "";
  const link = `${process.env.MAIZZ_PUBLIC_URL?.replace(/\/+$/, "") ?? `https://${host}`}/give/${church.slug}`;
  const max = Math.max(1, ...s.days.map((d) => d.pesewas));
  const typeMax = Math.max(1, ...s.byType.map((t) => t.pesewas));
  const latest = gifts.slice(0, 5);

  return (
    <>
      <div className="dash-head">
        <h1>Overview</h1>
        <p>{church.name}</p>
      </div>

      <div className="dash-stats">
        <div className="dash-stat"><span>Last 7 days</span><strong>{formatCedis(s.weekPesewas)}</strong></div>
        <div className="dash-stat"><span>This month</span><strong>{formatCedis(s.monthPesewas)}</strong></div>
        <div className="dash-stat"><span>All time ({s.giftCount} gifts)</span><strong>{formatCedis(s.totalPesewas)}</strong></div>
      </div>

      {gifts.length === 0 ? (
        <section className="dash-card dash-empty">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/maizz-mark-ink.png" alt="" width={48} height={50} />
          <h2>No gifts yet</h2>
          <p>Gifts appear here within a minute of being paid. Share your link at the next service to get started.</p>
          <div className="dash-link"><code>{link}</code><CopyButton text={link} /></div>
          <Link className="dash-btn ghost" href="/church/share">Open the printable share card</Link>
        </section>
      ) : (
        <>
          <div className="dash-two">
            <section className="dash-card">
              <h2>Last 7 days</h2>
              <ul className="dash-bars">
                {s.days.map((d) => (
                  <li key={d.label + d.pesewas} title={`${d.label}: ${formatCedis(d.pesewas)}`}>
                    <span className="bar-track"><span className="bar" style={{ height: `${Math.max(2, Math.round((d.pesewas / max) * 100))}%` }} /></span>
                    <span className="bar-label">{d.label}</span>
                    <span className="sr-only">{formatCedis(d.pesewas)}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="dash-card">
              <h2>This month by gift type</h2>
              {s.byType.length === 0 ? (
                <p className="dash-muted">No gifts this month yet.</p>
              ) : (
                <ul className="dash-types">
                  {s.byType.map((t) => (
                    <li key={t.type}>
                      <p><span>{typeLabel(t.type)}</span><span>{formatCedis(t.pesewas)}</span></p>
                      <span className="type-track"><span style={{ width: `${Math.max(2, Math.round((t.pesewas / typeMax) * 100))}%` }} /></span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="dash-card">
            <div className="dash-row-head">
              <h2>Latest gifts</h2>
              <Link href="/church/gifts">See all gifts</Link>
            </div>
            <ul className="dash-gifts">
              {latest.map((g) => (
                <li key={g.reference}>
                  <Link href={`/church/gifts/${g.reference}`}>
                    <span>
                      <strong>{g.giverName ?? "Anonymous"}</strong>
                      <small>{typeLabel(g.giftType)} · {longDate(g.createdAt)}</small>
                    </span>
                    <span className="dash-amt">{formatCedis(netPesewas(g))}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </>
  );
}
