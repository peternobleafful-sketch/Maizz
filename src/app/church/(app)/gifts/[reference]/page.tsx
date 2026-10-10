import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { netPesewas } from "@/lib/churchData";
import { longDate, typeLabel } from "@/lib/format";
import { formatCedis } from "@/lib/money";
import { requireChurchSession } from "@/lib/staffSession";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Gift | Maizz", robots: { index: false } };

export default async function GiftDetail({ params }: { params: Promise<{ reference: string }> }) {
  const { church, data } = await requireChurchSession();
  const { reference } = await params;
  const g = await data.findPaidGift(church.id, reference);
  if (!g) notFound();
  const rows: [string, string][] = [
    ["Gift type", typeLabel(g.giftType)],
    ["Giver", g.giverName ?? "Anonymous"],
    ["Date", longDate(g.createdAt)],
    ["Reference", g.reference],
    ...(g.refundedPesewas > 0 ? ([["Refunded", formatCedis(Math.min(g.refundedPesewas, g.amountPesewas))]] as [string, string][]) : []),
  ];
  return (
    <>
      <div className="dash-head"><h1>Gift</h1><p>{church.name}</p></div>
      <section className="dash-card">
        <div className="dash-row-head">
          <div>
            <p className="dash-muted">Church receives</p>
            <p className="dash-big">{formatCedis(netPesewas(g))}</p>
          </div>
          <span className={g.status === "refunded" ? "tag tag-fix" : "tag tag-pass"}>{g.status === "refunded" ? "REFUNDED" : "PAID"}</span>
        </div>
        <dl className="dash-dl">
          {rows.map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
        <Link className="dash-btn ghost" href="/church/gifts">Back to gifts</Link>
      </section>
    </>
  );
}
