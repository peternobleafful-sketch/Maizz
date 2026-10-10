import { addFees } from "@/lib/fees";
import { formatCedis } from "@/lib/money";

const STEPS = [
  { t: "Pick an amount", d: "Open your church's giving page, type the amount and choose a gift type such as tithe or offering." },
  { t: "Approve on your phone", d: "A prompt arrives from MTN, Vodafone or AirtelTigo. You enter your PIN on your own phone." },
  { t: "See it confirmed", d: "The page tells you when the gift is received. The church sees it and is paid to its own account." },
];

const PROMISES = [
  { t: "Your PIN stays yours", d: "You approve the payment on your phone. Maizz never sees your PIN." },
  { t: "No card numbers kept", d: "Maizz never stores card numbers or PINs." },
  { t: "Last four digits only", d: "Church payout accounts show only their last 4 digits once saved." },
  { t: "Every action recorded", d: "Refunds and changes to gifts and churches are written to a log that cannot be edited." },
];

export default function HomePage() {
  const example = addFees(10000);
  return (
    <div className="site">
      <header className="site-hero">
        <div className="site-wrap">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="site-logo" src="/brand/maizz-logo-white.png" alt="Maizz" width={1101} height={296} />
          <p className="site-eyebrow">COMING SOON</p>
          <h1>Church giving by mobile money is coming soon.</h1>
          <p className="site-lede">
            Maizz is opening for churches in Ghana. Tithes, offerings and seeds from any phone, in under a minute. Your
            church receives the full gift.
          </p>
        </div>
      </header>

      <section className="site-wrap site-split">
        <h2>What Maizz is</h2>
        <p>
          Maizz lets people give tithes and offerings to their church by mobile money. Givers pay from their own phone
          with MTN, Vodafone or AirtelTigo. Churches see every gift, get paid to their own account, and keep clear records.
        </p>
      </section>

      <section className="site-band">
        <div className="site-wrap site-stack">
          <h2>How it works</h2>
          <div className="site-cards">
            {STEPS.map((s, i) => (
              <div className="site-card" key={s.t}>
                <span className="site-num">{i + 1}</span>
                <h3>{s.t}</h3>
                <p>{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="site-wrap site-split centre">
        <div className="site-stack">
          <h2>Fees, explained plainly</h2>
          <p>Givers cover the fees. The giver sees the fee before paying. The church receives the full gift, every time.</p>
        </div>
        <div className="site-example">
          <p className="site-eyebrow">EXAMPLE GIFT</p>
          <p className="give-row"><span>Gift</span><span>{formatCedis(example.giftPesewas)}</span></p>
          <p className="give-row"><span>Fees</span><span>{formatCedis(example.feePesewas)}</span></p>
          <p className="give-row big"><span>Total</span><span>{formatCedis(example.totalPesewas)}</span></p>
          <p className="site-receives">Your church receives the full {formatCedis(example.giftPesewas)}</p>
        </div>
      </section>

      <section className="site-band">
        <div className="site-wrap site-stack">
          <h2>Security promises</h2>
          <div className="site-cards four">
            {PROMISES.map((p) => (
              <div className="site-card" key={p.t}>
                <h3>{p.t}</h3>
                <p>{p.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="site-foot">
        <div className="site-wrap foot-row">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="site-logo small" src="/brand/maizz-logo-white.png" alt="Maizz" width={1101} height={296} />
          <span>Giving for churches in Ghana</span>
        </div>
      </footer>
    </div>
  );
}
