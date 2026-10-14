import { cookies } from "next/headers";
import { cache } from "react";
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
export const requireOwnerSession = cache(async (): Promise<OwnerSigned> => {
  const token = (await cookies()).get(OWNER_COOKIE)?.value;
  let user: StaffUser | null = null;
  try {
    user = (await getStaffService(process.env, { needMail: false, area: "owner" }).getSession(token))?.user ?? null;
  } catch {
    user = null;
  }
  if (!user) redirect("/owner/sign-in");
  return { user, data: getOwnerData() };
});


/** Only for the layout: the owner even if the authenticator app is still off (so the set-up screen can be shown under a live key). */
export const getOwnerSetupUser = cache(async (): Promise<StaffUser | null> => {
  const token = (await cookies()).get(OWNER_COOKIE)?.value;
  try {
    return (await getStaffService(process.env, { needMail: false, area: "owner" }).getSession(token, { setup: true }))?.user ?? null;
  } catch {
    return null;
  }
});

/**
 * True only while there are NO owner rows at all. Only then may the first owner be added with the admin key in Production.
 * (An owner who is invited but has not set a password yet still counts as a row, so the door closes the moment the first invite exists.
 * To re-send that first invite, switch the admin tools on briefly with MAIZZ_ADMIN_TOOLS=on.)
 */
export async function noActiveOwnerYet(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const { url, serviceKey } = requireSupabase(env);
  const owners = await createSupabaseStaffStore({ url, serviceKey, area: "owner" }).listUsers("platform");
  return owners.length === 0;
}
