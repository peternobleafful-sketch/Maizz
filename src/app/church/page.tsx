import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getLedger } from "@/lib/payments";
import { getStaffService, STAFF_COOKIE } from "@/lib/staffRuntime";
import SignOutButton from "./SignOutButton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Church dashboard | Maizz", robots: { index: false } };

export default async function ChurchHome() {
  const token = (await cookies()).get(STAFF_COOKIE)?.value;
  let session = null;
  try {
    session = await getStaffService(process.env, { needMail: false }).getSession(token);
  } catch {
    session = null;
  }
  if (!session) redirect("/church/sign-in");

  const church = (await getLedger().listChurches()).find((c) => c.id === session.user.churchId);
  return (
    <div className="give-wrap">
      <main className="give">
        <header className="give-hero">
          <div className="give-top">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="give-logo" src="/brand/maizz-logo-white.png" alt="Maizz" width={1101} height={296} />
          </div>
          <p className="give-eyebrow">{church?.name?.toUpperCase() ?? "CHURCH DASHBOARD"}</p>
          <h1 className="give-thanks tight">Hello, {session.user.fullName.split(" ")[0]}</h1>
          <p className="give-lede">You are signed in as {session.user.role}.</p>
        </header>
        <section className="give-sheet">
          <p>Your gifts, payouts and team will appear here.</p>
          <SignOutButton />
        </section>
      </main>
    </div>
  );
}
