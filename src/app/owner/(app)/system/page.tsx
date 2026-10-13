import type { Metadata } from "next";
import { getAudit } from "@/lib/audit";
import { requireOwnerSession } from "@/lib/ownerRuntime";
import { runSetupChecks } from "@/lib/setupCheck";
import SystemTools from "./SystemTools";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const metadata: Metadata = { title: "System | Maizz owner", robots: { index: false } };

export default async function OwnerSystem() {
  const { user } = await requireOwnerSession();
  // Opening this page runs the checks, so it is recorded. No key or secret is ever shown.
  await getAudit().record({ actor: `owner:${user.id}`, action: "owner.setup_check", outcome: "ok" }).catch(() => undefined);
  const checks = await runSetupChecks(process.env);
  const fixes = checks.filter((c) => !c.ok).length;

  return (
    <>
      <div className="dash-head"><h1>System</h1><p>{fixes === 0 ? "Everything is set up" : `${fixes} to fix`}</p></div>
      <section className="dash-card flush">
        <ul className="dash-team plain">
          {checks.map((c) => (
            <li key={c.id}>
              <span className="who"><strong>{c.label}</strong><small>{c.hint}</small></span>
              <span className="dash-meta"><span className={c.ok ? "tag tag-pass" : "tag tag-fix"}>{c.ok ? "PASS" : "FIX"}</span></span>
            </li>
          ))}
        </ul>
      </section>
      <SystemTools />
      <p className="dash-muted">Reload this page to run the checks again.</p>
    </>
  );
}
