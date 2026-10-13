import type { Metadata } from "next";
import { shortDate } from "@/lib/format";
import { formatCedis } from "@/lib/money";
import { platformSummary } from "@/lib/ownerData";
import { requireOwnerSession } from "@/lib/ownerRuntime";
import { getLedger } from "@/lib/payments";
import ChurchTools, { type ChurchRow } from "./ChurchTools";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Churches | Maizz owner", robots: { index: false } };

export default async function OwnerChurches() {
  const { data } = await requireOwnerSession();
  const [gifts, churches] = await Promise.all([data.listPaidGifts({ limit: 5000 }), getLedger().listChurches()]);
  const s = platformSummary(gifts, Date.now());
  const rows = churches
    .map((c) => ({ c, st: s.byChurch.get(c.id) }))
    .sort((a, b) => (b.st?.monthPesewas ?? 0) - (a.st?.monthPesewas ?? 0));

  const list: ChurchRow[] = rows.map(({ c, st }) => ({
    slug: c.slug,
    name: c.name,
    status: c.status,
    paused: c.paused,
    payoutSet: c.subaccountCode !== null,
    payoutBank: c.payoutBankName,
    payoutLast4: c.payoutAccountLast4,
    payoutName: c.payoutAccountName,
    month: formatCedis(st?.monthPesewas ?? 0),
    line:
      `${st ? `${st.giftCount} gifts · last ${st.lastGiftAt ? shortDate(st.lastGiftAt) : "never"}` : "No gifts yet"}` +
      ` · ${c.subaccountCode ? `payout ${c.payoutBankName ?? ""} ••••${c.payoutAccountLast4 ?? ""}` : "no payout account"}`,
  }));

  return (
    <>
      <div className="dash-head"><h1>Churches</h1><p>{churches.length} on Maizz</p></div>
      <ChurchTools churches={list} />
    </>
  );
}
