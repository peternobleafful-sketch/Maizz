import type { Metadata } from "next";
import { requireSupabase } from "@/lib/config";
import { requireChurchSession } from "@/lib/staffSession";
import { createSupabaseStaffStore } from "@/lib/staffStore";
import TeamClient from "./TeamClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Team | Maizz", robots: { index: false } };

export default async function Team() {
  const { user, church } = await requireChurchSession("owner");
  const { url, serviceKey } = requireSupabase(process.env);
  const people = await createSupabaseStaffStore({ url, serviceKey }).listUsers(church.id);
  return (
    <>
      <div className="dash-head"><h1>Team</h1><p>People who can sign in for {church.name}</p></div>
      <TeamClient
        meId={user.id}
        people={people.map((p) => ({ id: p.id, name: p.fullName, email: p.email, role: p.role, status: p.status }))}
      />
    </>
  );
}
