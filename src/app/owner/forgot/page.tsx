import type { Metadata } from "next";
import ForgotForm from "@/app/church/forgot/ForgotForm";

export const metadata: Metadata = { title: "Reset password | Maizz", robots: { index: false } };

export default function OwnerForgot() {
  return <ForgotForm area="owner" />;
}
