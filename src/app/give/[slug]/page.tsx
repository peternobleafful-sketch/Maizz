import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GIFT_TYPE_LABELS, SLUG_PATTERN } from "@/lib/checkout";
import { classifyPaystackKey } from "@/lib/config";
import type { ChurchRecord } from "@/lib/ledger";
import { logError } from "@/lib/log";
import { getLedger } from "@/lib/payments";
import GiveForm from "./GiveForm";

export const dynamic = "force-dynamic";

type Found = { church: ChurchRecord | null } | { error: true };

// Only an active church has a giving page. A pending or suspended church looks the same as one that does not exist.
async function lookup(slug: string): Promise<Found> {
  if (slug.length > 80 || !SLUG_PATTERN.test(slug)) return { church: null };
  try {
    const church = await getLedger().findChurch(slug);
    return { church: church && church.status === "active" ? church : null };
  } catch (err) {
    logError("give_page.lookup_failed", { reason: err instanceof Error ? err.message : "unknown" });
    return { error: true };
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const found = await lookup(slug);
  const name = "church" in found ? found.church?.name : undefined;
  return { title: name ? `Give to ${name} | Maizz` : "Maizz", robots: { index: false } };
}

export default async function GivePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const found = await lookup(slug);
  if ("error" in found) {
    return (
      <main className="give">
        <p className="give-brand">MAIZZ</p>
        <h1>Giving is not available right now</h1>
        <p className="tool-note">Please try again in a few minutes.</p>
      </main>
    );
  }
  if (!found.church) notFound();
  const testMode = classifyPaystackKey(process.env.PAYSTACK_SECRET_KEY) === "test";
  const types = Object.entries(GIFT_TYPE_LABELS).map(([value, label]) => ({ value, label }));
  return <GiveForm slug={slug} churchName={found.church.name} testMode={testMode} types={types} />;
}
