import Link from "next/link";
import FindChurch from "./FindChurch";
import Icon from "@/components/site/Icon";
import { Dashboard, FloatChart, FloatGift, FloatPrompt, MiniAmount, MiniDone, MiniPrompt, PhoneGive, Receipt } from "@/components/site/Mockups";
import SiteFooter from "@/components/site/SiteFooter";
import SiteNav from "@/components/site/SiteNav";

const STEPS = [
  { t: "Pick an amount", d: "Open your church's giving page, type the amount and choose a gift type such as tithe or offering.", pic: <MiniAmount /> },
  { t: "Approve on your phone", d: "A prompt arrives from MTN, Vodafone or AirtelTigo. You enter your PIN on your own phone.", pic: <MiniPrompt /> },
  { t: "See it confirmed", d: "The page tells you when the gift is received. The church sees it and is paid to its own account.", pic: <MiniDone /> },
];

const WHY = [
  { icon: "bolt", t: "Speed", d: "Give from any phone in under a minute, with the mobile money you already use." },
  { icon: "eye", t: "Transparency", d: "Givers see the fee before they pay. The church receives the exact gift." },
  { icon: "shield", t: "Security", d: "Your PIN stays on your phone. No card numbers are kept." },
  { icon: "grid", t: "Ease of use", d: "A simple dashboard for church teams. No technical skill needed." },
];

const PROMISES = [
  { t: "Your PIN stays yours", d: "You approve the payment on your phone. Maizz never sees your PIN." },
  { t: "No card numbers kept", d: "Maizz never stores card numbers or PINs." },
  { t: "Last four digits only", d: "Church payout accounts show only their last 4 digits once saved." },
  { t: "Every action recorded", d: "Refunds and changes to gifts and churches are written to a log that cannot be edited." },
];

// Built fresh for each visit, so the browser-safety policy can attach its one-time marker (nonce) to the page.
export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <div className="pub">
      <SiteNav />

      <header className="pub-hero">
        <p className="pub-chip"><span className="dot" />Opening soon for churches in Ghana</p>
        <h1>Giving for churches, made simple.</h1>
        <p className="pub-lede">
          Tithes, offerings and seeds by mobile money, from any phone, in under a minute. Your church receives the full gift.
        </p>
        <div className="pub-actions">
          <Link className="pub-btn ink big" href="/register">Register your church</Link>
          <a className="pub-btn line big" href="#how">See how it works</a>
        </div>
        <div className="pub-stage">
          <Dashboard />
          <FloatGift className="f1" />
          <FloatPrompt className="f2" />
          <FloatChart className="f3" />
        </div>
        <p className="pub-example">Example screens. All figures are samples.</p>
      </header>

      <section className="pub-section" id="how">
        <div className="pub-head">
          <h2>Three steps. No forms to fill in.</h2>
          <p>Givers never need an account. They pick an amount, approve on their phone, and they are done.</p>
        </div>
        <div className="pub-steps">
          {STEPS.map((s, i) => (
            <article className="pub-step" key={s.t}>
              <div className="pub-step-pic">{s.pic}</div>
              <h3><span className="pub-num">{i + 1}</span>{s.t}</h3>
              <p>{s.d}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="pub-section" id="fees">
        <div className="pub-fees">
          <div className="pub-fees-copy">
            <h2>Fees, explained plainly</h2>
            <p>Givers cover the fees. The giver sees the fee before paying. The church receives the full gift, every time.</p>
            <ul className="pub-ticks">
              <li><Icon name="check" size={18} />No fee taken from the church&apos;s gift</li>
              <li><Icon name="check" size={18} />The total is shown before anyone pays</li>
              <li><Icon name="check" size={18} />Mobile money first, charged straight from the giving page</li>
            </ul>
          </div>
          <div className="pub-fees-card">
            <p className="pub-tag">Example gift</p>
            <Receipt />
          </div>
        </div>
      </section>

      <section className="pub-section" id="why">
        <div className="pub-head">
          <h2>Why churches choose Maizz</h2>
          <p>Built for churches in Ghana, and for the people who give to them.</p>
        </div>
        <div className="pub-why">
          <div className="pub-why-col">
            {WHY.slice(0, 2).map((w) => (
              <article className="pub-why-card" key={w.t}>
                <span className="pub-badge"><Icon name={w.icon} /></span>
                <h3>{w.t}</h3>
                <p>{w.d}</p>
              </article>
            ))}
          </div>
          <div className="pub-why-stage">
            <PhoneGive />
          </div>
          <div className="pub-why-col">
            {WHY.slice(2).map((w) => (
              <article className="pub-why-card" key={w.t}>
                <span className="pub-badge"><Icon name={w.icon} /></span>
                <h3>{w.t}</h3>
                <p>{w.d}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="pub-section" id="security">
        <div className="pub-head">
          <h2>Security promises</h2>
          <p>Plain promises we keep, because people are giving money.</p>
        </div>
        <div className="pub-promises">
          {PROMISES.map((p) => (
            <article className="pub-promise" key={p.t}>
              <span className="pub-tick"><Icon name="check" size={16} /></span>
              <h3>{p.t}</h3>
              <p>{p.d}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="pub-section narrow" id="find">
        <div className="pub-find">
          <div>
            <h2>Giving to your church?</h2>
            <p>Enter the end of your church&apos;s giving link to go to its page.</p>
          </div>
          <FindChurch />
        </div>
      </section>

      <section className="pub-cta">
        <span className="pub-cta-mark">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/maizz-mark-white.png" alt="" width={285} height={296} />
        </span>
        <h2>Ready to register your church?</h2>
        <p>Tell us about your church. Nothing is charged, and nothing goes live until we have spoken to you.</p>
        <div className="pub-actions">
          <Link className="pub-btn ink big" href="/register">Register your church</Link>
          <Link className="pub-btn white big" href="/church/sign-in">Church sign-in</Link>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
