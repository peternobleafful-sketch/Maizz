import { addFees } from "@/lib/fees";
import { formatCedis } from "@/lib/money";
import Icon from "./Icon";

// Pictures of the product made in plain HTML. Every figure is a sample, and the pages say so.

const SAMPLE = addFees(10000);

/** An amount with a small "GH₵" in front, so the sign does not shout next to the digits. */
function Money({ p }: { p: number }) {
  const m = /^GH₵\s?(.*)$/.exec(formatCedis(p));
  return m ? (
    <>
      <span className="pub-cur">GH₵</span>
      {m[1]}
    </>
  ) : (
    <>{formatCedis(p)}</>
  );
}

export function Dashboard() {
  const bars = [
    { d: "S", h: 100 },
    { d: "M", h: 22 },
    { d: "T", h: 14 },
    { d: "W", h: 38 },
    { d: "T", h: 18 },
    { d: "F", h: 26 },
    { d: "S", h: 30 },
  ];  return (
    <div className="pub-laptop" aria-hidden="true">
      <div className="pub-dash">
        <div className="pub-dash-side">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/maizz-logo-ink.png" alt="" width={1101} height={296} />
          <span className="on">Overview</span>
          <span>Gifts</span>
          <span>Payouts</span>
          <span>Team</span>
        </div>
        <div className="pub-dash-main">
          <div className="pub-dash-head">
            <strong>Grace Chapel</strong>
            <small>Sample church</small>
          </div>
          <div className="pub-stats">
            <div className="pub-stat">
              <small>This month</small>
              <b><Money p={482000} /></b>
              <i />
            </div>
            <div className="pub-stat">
              <small>Gifts</small>
              <b>63</b>
              <i className="b" />
            </div>
            <div className="pub-stat hide-sm">
              <small>Last Sunday</small>
              <b><Money p={131000} /></b>
              <i className="c" />
            </div>
          </div>
          <div className="pub-chart">
            <small>Gifts this week</small>
            <div className="pub-bars">
              {bars.map((b, i) => (
                <span key={i} style={{ height: `${b.h}%` }} className={i === 0 ? "top" : ""}>
                  <em>{b.d}</em>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function FloatGift({ className = "" }: { className?: string }) {
  return (
    <div className={`pub-float ${className}`} aria-hidden="true">
      <span className="pub-tick"><Icon name="check" size={16} /></span>
      <span>
        <b>Gift received</b>
        <small>Tithe &middot; {formatCedis(SAMPLE.giftPesewas)}</small>
      </span>
    </div>
  );
}

export function FloatPrompt({ className = "" }: { className?: string }) {
  return (
    <div className={`pub-float ${className}`} aria-hidden="true">
      <span className="pub-ico"><Icon name="phone" size={18} /></span>
      <span>
        <b>Approve on your phone</b>
        <small>Enter your PIN</small>
      </span>
    </div>
  );
}

export function FloatChart({ className = "" }: { className?: string }) {
  const h = [30, 55, 40, 85, 62, 48];
  return (
    <div className={`pub-float chart ${className}`} aria-hidden="true">
      <small>Gifts by month</small>
      <div className="pub-mini-bars">
        {h.map((v, i) => (
          <span key={i} style={{ height: `${v}%` }} className={i === 3 ? "top" : ""} />
        ))}
      </div>
    </div>
  );
}

export function PhoneGive() {
  return (
    <div className="pub-phone" aria-hidden="true">
      <div className="pub-notch" />
      <div className="pub-screen">
        <div className="pub-s-top">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/maizz-mark-ink.png" alt="" width={285} height={296} />
          <span>
            <small>Give to</small>
            <b>Grace Chapel</b>
          </span>
        </div>
        <p className="pub-s-label">Amount</p>
        <p className="pub-s-amount"><Money p={SAMPLE.giftPesewas} /></p>
        <div className="pub-s-chips">
          <span>20</span>
          <span>50</span>
          <span className="on">100</span>
          <span>200</span>
        </div>
        <div className="pub-s-chips">
          <span className="on">Tithe</span>
          <span>Offering</span>
          <span>Seed</span>
        </div>
        <div className="pub-s-sum">
          <p><span>Gift</span><span><Money p={SAMPLE.giftPesewas} /></span></p>
          <p><span>Fees</span><span><Money p={SAMPLE.feePesewas} /></span></p>
          <p className="big"><span>Total</span><span><Money p={SAMPLE.totalPesewas} /></span></p>
        </div>
        <div className="pub-s-btn">Give <Money p={SAMPLE.totalPesewas} /></div>
      </div>
    </div>
  );
}

/* Small pictures for the three "how it works" cards. */
export function MiniAmount() {
  return (
    <div className="pub-mini" aria-hidden="true">
      <small>Amount</small>
      <b className="amt"><Money p={SAMPLE.giftPesewas} /></b>
      <div className="pub-s-chips">
        <span>20</span>
        <span>50</span>
        <span className="on">100</span>
        <span>200</span>
      </div>
      <div className="pub-s-chips">
        <span className="on">Tithe</span>
        <span>Offering</span>
      </div>
    </div>
  );
}

export function MiniPrompt() {
  return (
    <div className="pub-mini centre" aria-hidden="true">
      <span className="pub-pulse"><Icon name="phone" size={26} /></span>
      <b>Waiting for approval</b>
      <small>Enter your PIN on your own phone</small>
    </div>
  );
}

export function MiniDone() {
  return (
    <div className="pub-mini centre" aria-hidden="true">
      <span className="pub-bigtick"><Icon name="check" size={30} /></span>
      <b>Gift received</b>
      <small>Grace Chapel receives the full {formatCedis(SAMPLE.giftPesewas)}</small>
    </div>
  );
}

export function Receipt() {
  return (
    <div className="pub-receipt" aria-hidden="true">
      <p><span>Gift</span><span><Money p={SAMPLE.giftPesewas} /></span></p>
      <p><span>Fees</span><span><Money p={SAMPLE.feePesewas} /></span></p>
      <p className="big"><span>Total</span><span><Money p={SAMPLE.totalPesewas} /></span></p>
      <p className="recv">Your church receives the full {formatCedis(SAMPLE.giftPesewas)}</p>
    </div>
  );
}
