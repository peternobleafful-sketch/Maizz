import type { Metadata } from "next";
import InviteForm from "@/app/church/invite/InviteForm";

export const metadata: Metadata = { title: "Choose your password | Maizz", robots: { index: false }, referrer: "no-referrer" };

export default async function OwnerInvite({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <InviteForm area="owner" token={typeof token === "string" ? token.slice(0, 100) : ""} />;
}
