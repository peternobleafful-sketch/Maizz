import type { Metadata } from "next";
import ResetForm from "@/app/church/reset/ResetForm";

export const metadata: Metadata = { title: "Choose a new password | Maizz", robots: { index: false }, referrer: "no-referrer" };

export default async function OwnerReset({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <ResetForm area="owner" token={typeof token === "string" ? token.slice(0, 100) : ""} />;
}
