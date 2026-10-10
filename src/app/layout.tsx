import type { Metadata, Viewport } from "next";
import { Outfit, DM_Mono } from "next/font/google";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
});

const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-dm-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Maizz",
  description: "Giving for churches in Ghana.",
};

export const viewport: Viewport = { themeColor: "#011bff" };

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-GB" className={`${outfit.variable} ${dmMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
