import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireSupabase } from "./config";
import { createSupabaseOwnerData, type OwnerData } from "./ownerData";
import type { StaffUser } from "./staff";
import { getStaffService, OWNER_COOKIE } from "./staffRuntime";

export function getOwnerData(env: NodeJS.ProcessEnv = process.env): OwnerData {
  const { url, serviceKey } = requireSupabase(env);
  return createSupabaseOwnerData({ url, serviceKey });
}

export interface OwnerSigned {
  user: StaffUser;
  data: OwnerData;
}

/** For the owner's pages: who is signed in, or off to the owner sign-in. A church sign-in never counts here. */
export async function requireOwnerSession(): Promise<OwnerSigned> {
  const token = (await cookies()).get(OWNER_COOKIE)?.value;
  let user: StaffUser | null = null;
  try {
    user = (await getStaffService(process.env, { needMail: false, area: "owner" }).getSession(token))?.user ?? null;
  } catch {
    user = null;
  }
  if (!user) redirect("/owner/sign-in");
  return { user, data: getOwnerData() };
}

