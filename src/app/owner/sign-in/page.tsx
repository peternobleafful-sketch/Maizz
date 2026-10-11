import type { Metadata } from "next";
import SignInForm from "@/app/church/sign-in/SignInForm";

export const metadata: Metadata = { title: "Owner sign-in | Maizz", robots: { index: false } };

export default function OwnerSignIn() {
  return <SignInForm area="owner" />;
}
