import type { Metadata } from "next";
import DashNav, { type NavItem } from "@/app/church/(app)/DashNav";
import { initials } from "@/lib/format";
import { ownerNeedsApp } from "@/lib/ownerRules";
import { redirect } from "next/navigation";
import { getOwnerSetupUser, requireOwnerSession } from "@/lib/ownerRuntime";
import AuthenticatorCard from "./system/AuthenticatorCard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false } };

export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const early = await getOwnerSetupUser();
  if (!early) redirect("/owner/sign-in");
  if (ownerNeedsApp(process.env, early)) {
    // Live payments: nothing else opens until the authenticator app is on.
    return (
      <div className="dash">
        <div className="dash-main">
          <main className="dash-page">
            <h1>Switch on the authenticator app</h1>
            <p className="dash-muted">Maizz is set up for live payments, so the owner dashboard stays shut until your authenticator app is on. Set it up below, save your recovery codes, then reload this page.</p>
            <AuthenticatorCard />
          </main>
        </div>
      </div>
    );
  }
  const { user, data } = await requireOwnerSession();
  const waiting = (await data.listApplications().catch(() => [])).filter((a) => a.status === "new").length;
  const items: NavItem[] = [
    { href: "/owner", label: "Overview" },
    { href: "/owner/churches", label: "Churches" },
    { href: "/owner/applications", label: waiting > 0 ? "Applications •" : "Applications" },
    { href: "/owner/activity", label: "Activity" },
    { href: "/owner/system", label: "System" },
  ];
  return (
    <div className="dash">
      <aside className="dash-side">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="dash-logo" src="/brand/maizz-logo-ink.png" alt="Maizz" width={1101} height={296} />
        <DashNav items={items} variant="side" home="/owner" label="Owner dashboard" />
        <div className="dash-me">
          <span className="dash-avatar">{initials(user.fullName)}</span>
          <div>
            <strong>{user.fullName}</strong>
            <span>Maizz owner</span>
          </div>
        </div>
      </aside>
      <div className="dash-main">
        <header className="dash-top">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/maizz-mark-ink.png" alt="Maizz" width={36} height={36} />
          <div>
            <strong>Maizz</strong>
            <span>{user.fullName.split(" ")[0]} · Owner</span>
          </div>
          <span className="dash-avatar">{initials(user.fullName)}</span>
        </header>
        <main className="dash-page">{children}</main>
      </div>
      <DashNav items={items} variant="tabs" home="/owner" label="Owner dashboard" />
    </div>
  );
}
