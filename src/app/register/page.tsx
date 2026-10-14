import type { Metadata } from "next";
import ApplyForm from "./ApplyForm";

// Built fresh for each visit, so the browser-safety policy can attach its one-time marker (nonce) to the page.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Register your church | Maizz",
  description: "Tell us about your church. Maizz is opening for churches in Ghana.",
};

export default function RegisterPage() {
  return <ApplyForm />;
}
