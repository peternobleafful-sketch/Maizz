import { can, requireChurchSession } from "@/lib/staffSession";
import { initials } from "@/lib/format";
import DashNav, { type NavItem } from "./DashNav";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, church } = await requireChurchSession();
  const items: NavItem[] = [
    { href: "/church", label: "Overview" },
    { href: "/church/gifts", label: "Gifts" },
    ...(can(user.role, "finance") ? [{ href: "/church/payouts", label: "Payouts" }] : []),
    ...(can(user.role, "owner") ? [{ href: "/church/team", label: "Team" }, { href: "/church/settings", label: "Settings" }] : []),
  ];
  const role = user.role[0]!.toUpperCase() + user.role.slice(1);
  return (
    <div className="dash">
      <aside className="dash-side">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="dash-logo" src="/brand/maizz-logo-ink.png" alt="Maizz" width={1101} height={296} />
        <DashNav items={items} variant="side" />
        <div className="dash-me">
          <span className="dash-avatar">{initials(user.fullName)}</span>
          <div>
            <strong>{user.fullName}</strong>
            <span>{church.name}</span>
          </div>
        </div>
      </aside>
      <div className="dash-main">
        <header className="dash-top">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/maizz-mark-ink.png" alt="Maizz" width={36} height={36} />
          <div>
            <strong>{church.name}</strong>
            <span>{user.fullName.split(" ")[0]} · {role}</span>
          </div>
          <span className="dash-avatar">{initials(user.fullName)}</span>
        </header>
        <main className="dash-page">{children}</main>
      </div>
      <DashNav items={items} variant="tabs" />
    </div>
  );
}
