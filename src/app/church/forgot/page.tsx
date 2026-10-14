import type { Metadata } from "next";
import ForgotForm from "./ForgotForm";

// Built fresh for each visit, so the browser-safety policy can attach its one-time marker (nonce) to the page.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Reset password | Maizz", robots: { index: false } };

export default function ForgotPage() {
  return <ForgotForm />;
}
