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

Givers cover Paystack's 1.95% and Maizz's own 1%, so the church receives the exact gift (`src/lib/fees.ts`). Whole pesewas only; fees are rounded up.

## The giving page (step 5, test mode only)

`/give/maizz-test-church` is the giver's page: amount (quick buttons or any amount), gift type, mobile money network and number, name or anonymous. It shows "Gift + fees = total" and says only "Maizz". The giver is told thank you only when the ledger says the gift succeeded. Only an active church has a giving page. Run `supabase/migrations/0003_gift_types.sql` once in Supabase. Card and bank transfer come later.

## Safety (step 6)

- A late or out-of-order notice never un-pays a gift (`0004_status_rules.sql`). The same payment is recorded once, whether the notice or our own check arrives first.
- While a giver waits, the page asks the payment provider directly, so failures show up in seconds. Gifts the provider never confirms close as abandoned after 2 hours; a later payment still counts.
- Refunds are recorded from the provider's refund notice and can never exceed what was paid. `/setup-check` has a test-mode refund button.
- The nightly check (`/api/cron/reconcile`, 03:00, needs `CRON_SECRET` in Vercel) settles waiting gifts, re-checks gifts paid in the last 3 days against the provider, and writes problems to the audit log. `/setup-check` shows FIX if it has not run in 26 hours.

## Church accounts (step 7, test mode only)

- Run `supabase/migrations/0005_church_accounts.sql` (after 0003 and 0004) once in Supabase.
- `/setup-check` has a Churches section: add a church (starts pending), set up its payout account (bank or mobile money, from Paystack's Ghana list), check the account holder's name Paystack returns, then activate. A church cannot be activated without a payout account and your confirmation.
- Each gift is split at payment time: the church's payout account receives the gift exactly; Maizz keeps its 1% and pays the provider's cut out of the rest. Maizz keeps only the last 4 digits of a payout account number.
- The giving page for a church is `/give/<church-slug>` and works only while the church is active.

## Look and feel

Blue (#011BFF), white and ink, in the spirit of atom.money. The giving page is a blue field with the amount at the top and one white sheet below. Logo files are in `public/brand`. Fonts Outfit and DM Mono. The design rule is in `CLAUDE.md`.

The design brief is `docs/design.md`. The Claude Design mock-ups (giving page, home, church dashboard, sign-up, receipts, Church Manager "My giving", owner tools) were exported on 10 Oct 2026. The giving page, home page and "page not found" page are built to them. The dashboard, sign-up and "My giving" screens wait for steps 8 and 9, because they need church sign-in with 2FA first. Receipt emails are not built yet, so no page promises one.

## Step 9, part 1: church sign-in

People who sign in for a church are added from the owner tools (setup check page, Team). They get an email link to choose a password. To sign in they enter email and password, then a six-digit code sent to their email. Pages: `/church/sign-in`, `/church/invite`, `/church`. Needs migration `0006_church_staff.sql` and the settings `STAFF_SECRET`, `RESEND_API_KEY` and `MAIZZ_FROM_EMAIL`. The dashboard screens (overview, gifts, payouts, team, settings) come next.

## Step 9, part 2: church dashboard

Signed-in church people see: Overview (last 7 days, this month, all time, by gift type, latest gifts), Gifts (filters, detail, CSV for finance and owners), Payouts (payout account, totals; payout history later), Team and Settings (owners), and a printable QR share card. Pages are in `src/app/church/(app)`. Roles: viewer, finance, owner. Still to do: payout history from the payment provider, receipts, the Church Manager "My giving" link (step 8), pausing giving from the dashboard, password reset.
