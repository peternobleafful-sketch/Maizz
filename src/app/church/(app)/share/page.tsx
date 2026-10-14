import type { Metadata } from "next";
import QRCode from "qrcode";
import { publicBaseUrl } from "@/lib/config";
import { requireChurchSession } from "@/lib/staffSession";
import PrintButton from "./PrintButton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Share card | Maizz", robots: { index: false } };

export default async function Share() {
  const { church } = await requireChurchSession();
  const base = publicBaseUrl(process.env);
  const link = base ? `${base}/give/${church.slug}` : null;
  if (!link) {
    return (
      <section className="dash-card">
        <h2>Share card</h2>
        <p className="dash-muted">The public web address is not set yet, so the card cannot be made. Ask Maizz to set it.</p>
      </section>
    );
  }
  const svg = await QRCode.toString(link, { type: "svg", margin: 1, width: 280, color: { dark: "#0a0a0f", light: "#ffffff" } });
  return (
    <>
      <div className="dash-head no-print"><h1>Share card</h1><p>Print it or show it on a screen at your service</p></div>
      <section className="share-card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/maizz-logo-white.png" alt="Maizz" width={110} height={30} />
        <h2>Give to {church.name}</h2>
        <div className="share-qr" role="img" aria-label={`QR code for ${link}`} dangerouslySetInnerHTML={{ __html: svg }} />
        <p>Scan with your phone camera, then pay with mobile money.</p>
        <code>{link}</code>
      </section>
      <div className="no-print"><PrintButton /></div>
    </>
  );
}
