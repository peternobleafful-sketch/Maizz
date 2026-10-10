import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CHECKOUT_CHURCHES, GIFT_TYPE_LABELS } from "@/lib/checkout";
import { classifyPaystackKey } from "@/lib/config";
import GiveForm from "./GiveForm";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const name = Object.hasOwn(CHECKOUT_CHURCHES, slug) ? CHECKOUT_CHURCHES[slug] : undefined;
  return { title: name ? `Give to ${name} | Maizz` : "Maizz", robots: { index: false } };
}

export default async function GivePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!Object.hasOwn(CHECKOUT_CHURCHES, slug)) notFound();
  const churchName = CHECKOUT_CHURCHES[slug] ?? "";
  const testMode = classifyPaystackKey(process.env.PAYSTACK_SECRET_KEY) === "test";
  const types = Object.entries(GIFT_TYPE_LABELS).map(([value, label]) => ({ value, label }));
  return <GiveForm slug={slug} churchName={churchName} testMode={testMode} types={types} />;
}
