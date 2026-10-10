import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireSupabase } from "./config";
import { createSupabaseChurchData, type ChurchData } from "./churchData";
import type { ChurchRecord } from "./ledger";
import { getLedger } from "./payments";
import type { Role, StaffUser } from "./staff";
import { getStaffService, STAFF_COOKIE } from "./staffRuntime";

export interface Signed {
  user: StaffUser;
  church: ChurchRecord;
  data: ChurchData;
}

/** Roles in order of reach. */
const RANK: Record<Role, number> = { viewer: 1, finance: 2, owner: 3 };
export const can = (role: Role, needs: Role) => RANK[role] >= RANK[needs];

/** For church pages: returns who is signed in and which church, or sends them to sign in. */
export async function requireChurchSession(needs: Role = "viewer"): Promise<Signed> {
  const token = (await cookies()).get(STAFF_COOKIE)?.value;
  let user: StaffUser | null = null;
  try {
    user = (await getStaffService(process.env, { needMail: false }).getSession(token))?.user ?? null;
  } catch {
    user = null;
  }
  if (!user) redirect("/church/sign-in");
  const church = (await getLedger().listChurches()).find((c) => c.id === user.churchId);
  if (!church) redirect("/church/sign-in");
  if (!can(user.role, needs)) redirect("/church");
  const { url, serviceKey } = requireSupabase(process.env);
  return { user, church, data: createSupabaseChurchData({ url, serviceKey }) };
}
