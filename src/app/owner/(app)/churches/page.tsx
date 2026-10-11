import type { Metadata } from "next";
import Link from "next/link";
import { shortDate } from "@/lib/format";
import { formatCedis } from "@/lib/money";
import { platformSummary } from "@/lib/ownerData";
import { requireOwnerSession } from "@/lib/ownerRuntime";
import { getLedger } from "@/lib/payments";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Churches | Maizz owner", robots: { index: false } };

export default async function OwnerChurches() {
  const { data } = await requireOwnerSession();
  const [gifts, churches] = await Promise.all([data.listPaidGifts({ limit: 5000 }), getLedger().listChurches()]);
  const s = platformSummary(gifts, Date.now());
  const rows = churches
    .map((c) => ({ c, st: s.byChurch.get(c.id) }))
    .sort((a, b) => (b.st?.monthPesewas ?? 0) - (a.st?.monthPesewas ?? 0));

  return (
    <>
      <div className="dash-head"><h1>Churches</h1><p>{churches.length} on Maizz</p></div>
      {rows.length === 0 ? (
        <section className="dash-card dash-empty">
          <h2>No churches yet</h2>
          <p>Add one on the setup page, or accept an application.</p>
          <Link className="dash-btn ghost" href="/setup-check">Open the setup page</Link>
        </section>
      ) : (
        <section className="dash-card flush">
          <ul className="dash-team plain">
            {rows.map(({ c, st }) => {
              const state = c.status === "active" ? (c.paused ? "PAUSED BY CHURCH" : "OPEN") : c.status === "pending" ? "NOT OPEN YET" : "SUSPENDED";
              return (
                <li key={c.id}>
                  <span className="who">
                    <strong>{c.name}</strong>
                    <small>
                      {st ? `${st.giftCount} gifts · last ${st.lastGiftAt ? shortDate(st.lastGiftAt) : "never"}` : "No gifts yet"}
                      {" · "}{c.subaccountCode ? `payout ${c.payoutBankName ?? ""} ••••${c.payoutAccountLast4 ?? ""}` : "no payout account"}
                    </small>
                  </span>
                  <span className="dash-meta">
                    <span className="dash-role">{formatCedis(st?.monthPesewas ?? 0)} this month</span>
                    <span className={state === "OPEN" ? "tag tag-pass" : "tag tag-fix"}>{state}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <p className="dash-muted">To set up a payout account, open, or suspend a church, use the <Link href="/setup-check">setup page</Link>.</p>
    </>
  );
}
