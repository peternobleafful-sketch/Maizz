import type { Metadata } from "next";
import SignInForm from "./SignInForm";

// Built fresh for each visit, so the browser-safety policy can attach its one-time marker (nonce) to the page.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Church sign-in | Maizz", robots: { index: false } };

export default function SignInPage() {
  return <SignInForm />;
}
