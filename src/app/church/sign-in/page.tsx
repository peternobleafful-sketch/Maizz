import type { Metadata } from "next";
import SignInForm from "./SignInForm";

export const metadata: Metadata = { title: "Church sign-in | Maizz", robots: { index: false } };

export default function SignInPage() {
  return <SignInForm />;
}
