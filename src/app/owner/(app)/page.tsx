import type { Metadata } from "next";
import Link from "next/link";
import SignOutButton from "@/app/church/(app)/SignOutButton";
import { longDate } from "@/lib/format";
import { formatCedis } from "@/lib/money";
import { platformSummary } from "@/lib/ownerData";
import { requireOwnerSession } from "@/lib/ownerRuntime";
import { getLedger } from "@/lib/payments";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Overview | Maizz owner", robots: { index: false } };

const HOUR = 3_600_000;

export default async function OwnerOverview() {
  const { user, data } = await requireOwnerSession();
  const now = Date.now();
  const [gifts, problems, apps, churches, lastCheck] = await Promise.all([
    data.listPaidGifts({ limit: 5000 }),
    data.problemCounts(now),
    data.listApplications(),
    getLedger().listChurches(),
    data.lastDailyCheck(),
  ]);
  const s = platformSummary(gifts, now);
  const waiting = apps.filter((a) => a.status === "new").length;
  const active = churches.filter((c) => c.status === "active" && !c.paused).length;
  const pending = churches.filter((c) => c.status === "pending").length;
  const paused = churches.filter((c) => c.status === "suspended" || (c.status === "active" && c.paused)).length;
  const checkFresh = lastCheck !== null && now - Date.parse(lastCheck) < 26 * HOUR;
  const trouble = problems.failedWeek + problems.waiting;

  return (
    <>
      <div className="dash-head"><h1>Overview</h1><p>All churches on Maizz</p></div>

      <div className="dash-stats">
        <div className="dash-stat"><span>Today</span><strong>{formatCedis(s.todayPesewas)}</strong></div>
        <div className="dash-stat"><span>Last 7 days</span><strong>{formatCedis(s.weekPesewas)}</strong></div>
        <div className="dash-stat"><span>This month</span><strong>{formatCedis(s.monthPesewas)}</strong></div>
      </div>
      <p className="dash-muted">Given to churches, after refunds. All time: {formatCedis(s.totalPesewas)} in {s.giftCount} gifts.</p>

      <div className="dash-two">
        <section className="dash-card">
          <h2>Maizz fees</h2>
          <dl className="dash-dl">
            <div><dt>Your share, this month</dt><dd>{formatCedis(s.maizzFeeMonthPesewas)}</dd></div>
            <div><dt>Your share, all time</dt><dd>{formatCedis(s.maizzFeeTotalPesewas)}</dd></div>
            <div><dt>All fees givers paid</dt><dd>{formatCedis(s.feesPesewas)}</dd></div>
          </dl>
          <p className="dash-muted">Your share is Maizz&apos;s own part of each fee on paid gifts. The rest covers the payment provider. Check your real balance with the provider.</p>
        </section>

        <section className="dash-card">
          <h2>Needs a look</h2>
          <dl className="dash-dl">
            <div><dt>Daily check</dt><dd><span className={checkFresh ? "tag tag-pass" : "tag tag-fix"}>{checkFresh ? "RAN" : "OVERDUE"}</span> {lastCheck ? longDate(lastCheck) : "never"}</dd></div>
            <div><dt>Failed gifts, 7 days</dt><dd>{problems.failedWeek}</dd></div>
            <div><dt>Waiting over 30 minutes</dt><dd>{problems.waiting}</dd></div>
            <div><dt>Refunded, 7 days</dt><dd>{problems.refundedWeek}</dd></div>
          </dl>
          <p className="dash-muted">
            {trouble === 0 ? "Nothing is stuck." : "Failed gifts are usually a giver who did not approve. Waiting gifts are settled by the daily check."}{" "}
            Refunds and manual checks are on the <Link href="/setup-check">setup page</Link>.
          </p>
        </section>
      </div>

      <div className="dash-stats">
        <div className="dash-stat"><span>Churches open</span><strong>{active}</strong></div>
        <div className="dash-stat"><span>Not open yet</span><strong>{pending}</strong></div>
        <div className="dash-stat"><span>Paused</span><strong>{paused}</strong></div>
      </div>

      {waiting > 0 && (
        <section className="dash-card">
          <h2>{waiting} {waiting === 1 ? "church is" : "churches are"} waiting to hear from you</h2>
          <Link className="dash-btn" href="/owner/applications">Review applications</Link>
        </section>
      )}

      <section className="dash-card">
        <h2>Your sign-in</h2>
        <dl className="dash-dl">
          <div><dt>Name</dt><dd>{user.fullName}</dd></div>
          <div><dt>Email</dt><dd>{user.email}</dd></div>
          <div><dt>Two-step sign-in</dt><dd>On. A code is emailed every time you sign in.</dd></div>
        </dl>
        <SignOutButton area="owner" />
      </section>
    </>
  );
}
