import type { Metadata } from "next";
import { netPesewas, summarise } from "@/lib/churchData";
import { formatCedis } from "@/lib/money";
import { requireChurchSession } from "@/lib/staffSession";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Payouts | Maizz", robots: { index: false } };

export default async function Payouts() {
  const { church, data } = await requireChurchSession("finance");
  const gifts = await data.listPaidGifts(church.id, { limit: 5000 });
  const s = summarise(gifts, Date.now());
  const received = gifts.reduce((t, g) => t + netPesewas(g), 0);
  return (
    <>
      <div className="dash-head"><h1>Payouts</h1><p>Where your gifts are paid to</p></div>

      <section className="dash-card">
        <h2>Payout account</h2>
        {church.payoutAccountLast4 ? (
          <dl className="dash-dl">
            <div><dt>Account name</dt><dd>{church.payoutAccountName || "Not returned"}</dd></div>
            <div><dt>Bank or network</dt><dd>{church.payoutBankName ?? "Not set"}</dd></div>
            <div><dt>Account number</dt><dd className="mono">•••• {church.payoutAccountLast4}</dd></div>
          </dl>
        ) : (
          <p className="dash-muted">No payout account is set up yet.</p>
        )}
        <p className="dash-muted">Maizz keeps only the last 4 digits. To change the account, contact Maizz.</p>
      </section>

      <div className="dash-stats two">
        <div className="dash-stat"><span>Gifts received, all time</span><strong>{formatCedis(received)}</strong></div>
        <div className="dash-stat"><span>Last 7 days</span><strong>{formatCedis(s.weekPesewas)}</strong></div>
      </div>

      <section className="dash-card">
        <h2>Payout history</h2>
        <p className="dash-muted">
          Payouts are sent to your account automatically on Maizz&apos;s payout schedule. A list of each payout will appear here
          once it is connected. Until then, check your account statement, and use the gifts list and CSV to match gifts to payouts.
        </p>
      </section>
    </>
  );
}
