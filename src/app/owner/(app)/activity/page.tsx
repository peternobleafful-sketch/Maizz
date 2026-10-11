import type { Metadata } from "next";
import { longDate } from "@/lib/format";
import { requireOwnerSession } from "@/lib/ownerRuntime";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Activity | Maizz owner", robots: { index: false } };

function plain(action: string): string {
  if (action.startsWith("alert.sent.")) return `Alert emailed: ${action.slice("alert.sent.".length).replace(/_/g, " ")}`;
  return action.replace(/[._]/g, " ");
}

export default async function OwnerActivity() {
  const { data } = await requireOwnerSession();
  const rows = await data.recentActivity(60);
  return (
    <>
      <div className="dash-head"><h1>Activity</h1><p>Alerts sent, and anything refused or failed</p></div>
      {rows.length === 0 ? (
        <section className="dash-card dash-empty"><h2>Nothing to show</h2><p>Alerts and refused attempts appear here.</p></section>
      ) : (
        <section className="dash-card flush">
          <ul className="dash-team plain">
            {rows.map((r, i) => (
              <li key={`${r.at}-${i}`}>
                <span className="who">
                  <strong>{plain(r.action)}</strong>
                  <small>{longDate(r.at)} · {r.actor}</small>
                </span>
                <span className="dash-meta">
                  <span className={r.outcome === "ok" ? "tag tag-pass" : "tag tag-fix"}>{r.outcome.toUpperCase()}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="dash-muted">This is a short view of the audit log. Names, phone numbers, emails and keys are never in it.</p>
    </>
  );
}
