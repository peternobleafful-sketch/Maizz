import type { Metadata } from "next";
import ResetForm from "./ResetForm";

export const metadata: Metadata = { title: "Choose a new password | Maizz", robots: { index: false }, referrer: "no-referrer" };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <ResetForm token={typeof token === "string" ? token.slice(0, 100) : ""} />;
}
