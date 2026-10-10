import type { Metadata } from "next";
import SetupCheckClient from "./SetupCheckClient";

export const metadata: Metadata = {
  title: "Maizz setup check",
  robots: { index: false, follow: false },
};

export default function SetupCheckPage() {
  return <SetupCheckClient />;
}
