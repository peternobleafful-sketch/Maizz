import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { requireChurchSession } from "@/lib/staffSession";
import CopyButton from "../CopyButton";
import SignOutButton from "../SignOutButton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Settings | Maizz", robots: { index: false } };

export default async function Settings() {
  const { user, church } = await requireChurchSession("owner");
  const host = (await headers()).get("host") ?? "";
  const link = `${process.env.MAIZZ_PUBLIC_URL?.replace(/\/+$/, "") ?? `https://${host}`}/give/${church.slug}`;
  return (
    <>
      <div className="dash-head"><h1>Settings</h1><p>{church.name}</p></div>

      <section className="dash-card">
        <h2>Giving page</h2>
        <dl className="dash-dl">
          <div><dt>Status</dt><dd>{church.status === "active" ? "Open for giving" : church.status === "pending" ? "Not open yet" : "Paused"}</dd></div>
        </dl>
        <div className="dash-link"><code>{link}</code><CopyButton text={link} /></div>
        <Link className="dash-btn ghost" href="/church/share">Open the printable share card</Link>
      </section>

      <section className="dash-card">
        <h2>Your sign-in</h2>
        <dl className="dash-dl">
          <div><dt>Name</dt><dd>{user.fullName}</dd></div>
          <div><dt>Email</dt><dd>{user.email}</dd></div>
          <div><dt>Role</dt><dd>{user.role}</dd></div>
          <div><dt>Two-step sign-in</dt><dd>On. A code is emailed every time you sign in.</dd></div>
        </dl>
        <SignOutButton />
      </section>

      <section className="dash-card">
        <h2>Roles</h2>
        <p className="dash-muted">
          Owners can do everything, including the team. Finance can see gifts, payouts and download the CSV. Viewers can see the
          overview and gifts. To pause giving or change the payout account, contact Maizz.
        </p>
      </section>
    </>
  );
}
