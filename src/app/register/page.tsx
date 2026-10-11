import type { Metadata } from "next";
import ApplyForm from "./ApplyForm";

export const metadata: Metadata = {
  title: "Register your church | Maizz",
  description: "Tell us about your church. Maizz is opening for churches in Ghana.",
};

export default function RegisterPage() {
  return <ApplyForm />;
}
