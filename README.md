# Maizz

A giving platform for churches in Ghana. Its own service, separate from Church Manager (customer #1).

## Rules for this project
- Money is stored in whole pesewas only. Never decimals.
- The ledger is append-only: rows are added, never edited or deleted.
- Test mode only until the company, bank account and legal checks are confirmed.
- Webhooks must be verified by signature. Every state change is logged.
- Givers see "Maizz" only. Paystack stays in the background.
- Design: Black and Gold only, no gradients. Fonts: Outfit and DM Mono.
- Secret keys go in settings boxes or GitHub secrets. Never in code, never in chat.
- British spelling.

## Where things live
- Website and checkout: Vercel
- Database: Supabase (Europe, London)
- Code: this private repo

## Build order
1. Project and repo (this step)
2. Ledger (churches, givers, gifts, append-only)
3. Paystack connection, test mode, as a swappable adapter
4. Fees (giver covers them)
5. Checkout page (mobile money first)
6. Safety (duplicate and late webhooks, refunds, daily reconciliation)
7. Church sub-accounts and onboarding
8. Church Manager link
9. Church dashboard
10. Security review, Data Protection Commission, tiny live pilot
11. Later: replace GH₵5 collection, more churches, second provider

## The ledger (step 2)
The database design lives in `supabase/migrations/0001_ledger.sql`.
- `churches` and `givers`: reference records. Never deleted.
- `gifts`: one row per gift, in whole pesewas. The church receives `amount_pesewas` exactly; `fee_pesewas` is what the giver adds. Append-only.
- `gift_events`: every change of a gift's progress (pending, succeeded, failed, abandoned, refunded) is a new row. Append-only. A repeated provider notice is rejected by a unique `provider_event_id`.
- `gift_status` and `church_totals`: read-only views for the current status and what each church has received.
- Only the server (Supabase service role) can reach these tables.

## The Paystack connection (step 3, test mode only)
- `src/lib/payments/types.ts`: the one interface Maizz talks to (initialise, submit code, verify, refund, parse webhook, capabilities). A second provider later means another adapter, not an app rewrite.
- `src/lib/payments/paystack.ts`: the Paystack adapter. Mobile money is charged directly from the Maizz page (givers see Maizz, not Paystack). Cards and bank transfer use Paystack's secure page.
- `src/lib/payments/webhookHandler.ts` and `src/app/api/webhooks/paystack/route.ts`: receive Paystack's notices. A notice is refused unless its signature matches. A payment is only recorded as paid if the amount and currency match the gift exactly. A repeated notice is recorded once.
- `src/lib/config.ts`: refuses a live Paystack key unless `MAIZZ_ALLOW_LIVE=yes` (do not set it before the legal checks are done).
- `src/lib/ledger.ts`: the only code that writes to the ledger.
- `/setup-check`: private page that tests each setting without showing any value. Needs `SETUP_CHECK_TOKEN`. Also starts a GH₵1 test payment and checks the result.
- Failed-payment detection, refunds, late or out-of-order notices and daily reconciliation come in step 6.
- Paystack's exact test-mode behaviour for Ghana mobile money (and the refund notice fields) is to be confirmed against a real test run.

## Running it
```
npm install
npm run dev
npm run typecheck
npm test
```

## Fees (step 4)

Givers cover Paystack's 1.95%, so the church receives the exact gift (`src/lib/fees.ts`). Whole pesewas only; the fee is rounded up.

## The giving page (step 5, test mode only)

`/give/maizz-test-church` is the giver's page: amount (quick buttons or any amount), gift type, mobile money network and number, name or anonymous. It shows "Gift + fees = total" and says only "Maizz". The giver is told thank you only when the ledger says the gift succeeded. Only the test church can receive gifts until church sign-up (step 7). Run `supabase/migrations/0003_gift_types.sql` once in Supabase. Card and bank transfer come later.
