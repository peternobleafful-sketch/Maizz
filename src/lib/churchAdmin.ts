import type { ChurchRecord, Ledger } from "./ledger";
import { logError } from "./log";
import { ProviderError, type PaymentProvider } from "./payments/types";

// Private church tools for the Maizz owner: add a church, set up its payout account, activate or suspend it.
// A church cannot receive gifts until it is active, and cannot be activated without a payout account.

export const CHURCH_ACTIONS = ["list", "banks", "create", "payout", "activate", "suspend"] as const;
export type ChurchAction = (typeof CHURCH_ACTIONS)[number];

export interface ChurchReply {
  status: number;
  body: Record<string, unknown>;
}

/** The church as the owner sees it. Never includes a full account number: none is kept. */
export function showChurch(c: ChurchRecord) {
  return {
    slug: c.slug,
    name: c.name,
    status: c.status,
    payoutSet: c.subaccountCode !== null,
    payoutBank: c.payoutBankName,
    payoutAccountLast4: c.payoutAccountLast4,
    payoutAccountName: c.payoutAccountName,
  };
}

/** "Grace Chapel, Accra!" becomes "grace-chapel-accra". */
export function slugFromName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

const bad = (error: string, status = 400): ChurchReply => ({ status, body: { error } });

function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function runChurchAction(args: {
  ledger: Ledger;
  provider: PaymentProvider;
  action: ChurchAction;
  body: Record<string, unknown>;
}): Promise<ChurchReply> {
  const { ledger, provider, action, body } = args;
  try {
    switch (action) {
      case "list":
        return { status: 200, body: { churches: (await ledger.listChurches()).map(showChurch) } };

      case "banks":
        return { status: 200, body: { banks: await provider.listPayoutBanks() } };

      case "create": {
        const name = text(body.name).replace(/\s+/g, " ");
        if (name.length < 2 || name.length > 100) return bad("Enter the church's name.");
        const base = slugFromName(name);
        if (base.length < 2) return bad("Use letters or numbers in the church's name.");
        let slug = base;
        for (let i = 2; await ledger.findChurch(slug); i += 1) {
          if (i > 20) return bad("Too many churches with a similar name. Add a town to the name.");
          slug = `${base.slice(0, 55)}-${i}`;
        }
        const church = await ledger.createChurch({ slug, name });
        return { status: 200, body: { church: showChurch(church) } };
      }

      case "payout": {
        const church = await ledger.findChurch(text(body.slug));
        if (!church) return bad("No such church.", 404);
        if (church.status === "active") return bad("Suspend the church before changing its payout account.");
        const bankCode = text(body.bankCode);
        const accountNumber = text(body.accountNumber).replace(/[\s-]/g, "");
        if (!/^[A-Za-z0-9]{2,12}$/.test(bankCode)) return bad("Choose a bank or mobile money network.");
        if (!/^\d{6,20}$/.test(accountNumber)) return bad("Enter the account or mobile money number (digits only).");
        // The bank's name comes from the provider's own list, never from the browser.
        const bank = (await provider.listPayoutBanks()).find((b) => b.code === bankCode);
        if (!bank) return bad("That bank or network is not on the list.");
        const account = await provider.createPayoutAccount({ businessName: church.name, bankCode, accountNumber });
        await ledger.setChurchPayout(church.id, {
          subaccountCode: account.code,
          bankCode,
          bankName: bank.name,
          accountLast4: accountNumber.slice(-4),
          accountName: account.accountName,
        });
        const fresh = await ledger.findChurch(church.slug);
        return { status: 200, body: { church: fresh ? showChurch(fresh) : null } };
      }

      case "activate": {
        const church = await ledger.findChurch(text(body.slug));
        if (!church) return bad("No such church.", 404);
        if (church.status === "active") return bad("That church is already active.");
        if (!church.subaccountCode) return bad("Set up the church's payout account first.");
        if (body.confirmed !== true) {
          return bad("Confirm that you have checked the church is genuine and that the account name matches the church.");
        }
        await ledger.setChurchStatus(church.id, "active");
        const fresh = await ledger.findChurch(church.slug);
        return { status: 200, body: { church: fresh ? showChurch(fresh) : null } };
      }

      case "suspend": {
        const church = await ledger.findChurch(text(body.slug));
        if (!church) return bad("No such church.", 404);
        if (church.status === "suspended") return bad("That church is already suspended.");
        await ledger.setChurchStatus(church.id, "suspended");
        const fresh = await ledger.findChurch(church.slug);
        return { status: 200, body: { church: fresh ? showChurch(fresh) : null } };
      }
    }
  } catch (err) {
    logError("church_admin.failed", { action, reason: err instanceof Error ? err.message : "unknown" });
    if (err instanceof ProviderError) return bad("The payment provider refused that. Check the details and try again.", 502);
    return bad(err instanceof Error && /already exists/.test(err.message) ? err.message : "Something went wrong. See the Vercel logs.", 502);
  }
}
