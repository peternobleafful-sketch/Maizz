import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { adminToolsOff } from "@/lib/adminAuth";
import { noActiveOwnerYet } from "@/lib/ownerRuntime";
import SetupCheckClient from "./SetupCheckClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Maizz setup check",
  robots: { index: false, follow: false },
};

// In Production this page is switched off (404), because the owner dashboard has these tools behind a proper sign-in.
// The one exception is the very first set-up: until the first Maizz owner has chosen a password, it shows only "add the first owner".
export default async function SetupCheckPage() {
  if (!adminToolsOff(process.env)) return <SetupCheckClient />;
  let first = false;
  try {
    first = await noActiveOwnerYet(process.env);
  } catch {
    first = false;
  }
  if (!first) notFound();
  return <SetupCheckClient bootstrapOnly />;
}
