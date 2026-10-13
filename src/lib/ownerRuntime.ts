import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireSupabase } from "./config";
import { createSupabaseOwnerData, type OwnerData } from "./ownerData";
import type { StaffUser } from "./staff";
import { getStaffService, OWNER_COOKIE } from "./staffRuntime";
import { createSupabaseStaffStore } from "./staffStore";

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


/** True until the first Maizz owner has set a password. Only then may the first owner be added with the admin key in Production. */
export async function noActiveOwnerYet(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const { url, serviceKey } = requireSupabase(env);
  const owners = await createSupabaseStaffStore({ url, serviceKey, area: "owner" }).listUsers("platform");
  return !owners.some((o) => o.status === "active");
}
