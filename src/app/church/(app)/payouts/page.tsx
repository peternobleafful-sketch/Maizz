import type { Metadata } from "next";
import { netPesewas, summarise } from "@/lib/churchData";
import { formatCedis } from "@/lib/money";
import { getPaymentProvider } from "@/lib/payments";
import type { PayoutRecord } from "@/lib/payments/types";
import { shortDate } from "@/lib/format";
import { requireChurchSession } from "@/lib/staffSession";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Payouts | Maizz", robots: { index: false } };

export default async function Payouts() {
  const { church, data } = await requireChurchSession("finance");
  const gifts = await data.listPaidGifts(church.id, { limit: 5000 });
  const s = summarise(gifts, Date.now());
  const received = gifts.reduce((t, g) => t + netPesewas(g), 0);

  // The payout list comes straight from the payment provider. If it cannot be read, say so plainly and show the rest.
  let payouts: PayoutRecord[] | null = null;
  let unavailable = false;
  if (church.subaccountCode) {
    try {
      const provider = getPaymentProvider();
      if (provider.listPayouts) payouts = await provider.listPayouts(church.subaccountCode);
    } catch {
      unavailable = true;
    }
  }
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
        {payouts && payouts.length > 0 ? (
          <ul className="dash-team plain">
            {payouts.slice(0, 30).map((p) => (
              <li key={p.id}>
                <span className="who">
                  <strong>{formatCedis(p.amountPesewas)}</strong>
                  <small>{shortDate(p.date)}</small>
                </span>
                <span className="dash-meta">
                  <span className={p.status === "paid" ? "tag tag-pass" : "tag tag-fix"}>{p.status === "paid" ? "PAID" : p.status === "failed" ? "FAILED" : "ON ITS WAY"}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="dash-muted">
            {!church.subaccountCode
              ? "No payout account is set up yet, so there are no payouts."
              : unavailable || payouts === null
                ? "The payout list could not be loaded just now. Try again in a few minutes, or check your account statement."
                : "No payouts yet. A payout appears here once your payment provider has settled your gifts to your account."}
          </p>
        )}
        <p className="dash-muted">
          Use this list with your account statement. To match gifts to a payout, use the gifts list and the CSV download. The payout amounts come from the payment provider and can arrive a day or two after the gifts.
        </p>
      </section>
    </>
  );
}
