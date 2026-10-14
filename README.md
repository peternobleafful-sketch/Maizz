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
- `/setup-check`: private page that tests each setting without showing any value. Needs `SETUP_CHECK_TOKEN`. Also starts a GH₵1 test payment and checks the result. **Switched off (404) in Production** since 13 Oct 2026: the owner dashboard (Churches, System) does the same jobs behind the owner sign-in. Set `MAIZZ_ADMIN_TOOLS=on` in Vercel to bring it back for a short while. Until the first owner has set a password it shows only "Add the first Maizz owner".
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

Signed-in church people see: Overview (last 7 days, this month, all time, by gift type, latest gifts), Gifts (filters, detail, CSV for finance and owners), Payouts (payout account, totals; payout history later), Team and Settings (owners), and a printable QR share card. Pages are in `src/app/church/(app)`. Roles: viewer, finance, owner. Payout history, receipts, password reset and pausing giving are done (see below). Still to do: the Church Manager "My giving" link (step 8).

## Alerts, receipts, password reset and backups

- **Alerts:** set `ALERT_EMAIL` (plus the email settings). Odd events email the owner at most once an hour per kind. A second cron, `/api/cron/watchdog` at 08:00, emails if the daily check did not run.
- **Receipts:** an optional email box on the giving page (named gifts only). Receipts go out once, when the gift is first recorded as paid.
- **Password reset:** `/church/forgot` and `/church/reset`. Needs migration `0007_password_reset.sql`.
- **Books copy:** owner dashboard, System, "Download the books" (CSV, no personal data).
- **Incident plan:** `docs/INCIDENT_RESPONSE.md`.

## Owner dashboard, church sign-up and pause giving (10 Oct 2026)

Needs migration `0008_owner_signup_pause.sql`. The System page shows "Owner dashboard tables are installed" once it is run.

- **Owner dashboard** at `/owner` (own sign-in at `/owner/sign-in`, own people, own sessions and its own cookie, so a church sign-in can never open it). It shows totals across all churches, Maizz's own fee share, failed or waiting gifts, whether the daily check ran, every church, applications and recent alerts. Add the first owner from the setup page ("Maizz owners", at most 5; in Production only until the first owner has a password). Payouts, opening and suspending a church are now under Churches in the dashboard (see the group A notes below).
- **Church sign-up** at `/register`. It only saves an application (name, town, contact name, email, phone). Limits: 3 per connection per day, 100 waiting at once, a hidden box for robots. You get an alert email. Accepting an application in the owner dashboard adds the church as "pending" and emails the contact an invite as the church's owner. You still set up the payout account and open the church on the setup page.
- **Pause giving**: a church owner can pause and resume their own page from Settings. A paused page shows a short message and refuses gifts; gifts already in progress still finish. This is separate from Maizz suspending a church, which a church cannot undo.
- **Payout history** on the church Payouts page, read from the payment provider's settlements for that church's account. It could not be tested against the live provider, so it fails safely with a plain message.
- **Home page** has a menu (How it works, Fees, Security, Church sign-in, Register your church).

## Security review, group A (13 Oct 2026)

Needs migration `0009_owner_payout_code.sql` (run it in Supabase before the code goes live).

- **Church tools in the owner dashboard** (`/owner/churches`): add a church, set its payout account, open or suspend it, see its people and send an invite again. Changing a payout account needs a fresh six-digit code emailed to the signed-in owner (works once, 10 minutes), and the church's owners are emailed afterwards ("Your payout account was changed to •••• 1234 by Maizz").
- **System page** (`/owner/system`): the setup checks, "Run the daily check now" and "Download the books".
- **Admin tools off in Production:** `/setup-check` and `/api/admin/*` answer 404 unless `MAIZZ_ADMIN_TOOLS=on`. The nightly check addresses are not affected.
- **Lock-out fix:** the right admin or cron secret always works; wrong ones lock only the sender; the watchdog has its own counter.
- **Live key guard:** with a live key, checkout refuses while any test gift exists. See `docs/LIVE_DATABASE.md`.
- **Refund rule:** a refund returns the gift amount only. Fees are not refunded (Maizz mistakes are decided case by case). Refunds stay test-only until Paystack answers in writing.

## Security review, group B (14 Oct 2026)

Needs migration `0010_atomic_limits_retention.sql` (run it in Supabase before the code goes live) and a new Vercel setting `RATE_LIMIT_SECRET` (32+ random characters, Production, Sensitive).

- **Attempt limits that hold under floods:** every sign-in, code, reset, step-up, admin-token, checkout, code and application attempt is counted and recorded in one database step.
- **Sign-in:** a source address gets 30 attempts per 15 minutes; one person from one source gets 8; a person is locked for everyone only after 20 wrong tries. Locked, over the limit, wrong password and unknown email all look the same. Reset requests answer at once.
- **Giving page:** 60 gift requests per source per 10 minutes (high, so a whole church on one Wi-Fi can give), and 3 per phone number per hour (the number is stored only as a keyed hash in the counters).
- **Personal details:** the nightly check (03:00) removes the name, phone and email of givers whose gifts were never paid after 30 days (`src/lib/retention.ts`), and the contact details of declined church applications after 90 days. Paid gifts keep their giver. The System page has "Remove a giver's details" (by gift reference) for data requests.
- **Daily check:** also asks about gifts closed as abandoned or failed in the last 3 days, and records a late payment once, for the exact amount only.
- **Content-Security-Policy:** report-only for the first week (`middleware.ts`). Reports are listed in the audit log as `csp.report`. Set `MAIZZ_CSP=enforce` to block for real.

## Second review fixes and group C (14 Oct 2026)

Needs migration `0011_refund_total_rule.sql`, and two Vercel settings **before** the code goes live: `RATE_LIMIT_SECRET` (32+ random characters, Sensitive) and `MAIZZ_PUBLIC_URL` (for example `https://maizz-nu.vercel.app`, no slash). Without them giving is refused and no invite or reset email is sent.

- **Admin tools:** stay off whenever the Paystack key is live or `MAIZZ_LIVE_DATABASE=yes` is set (set it in every Vercel environment that can reach the live database).
- **Limits:** 60 gift starts and 40 codes per address per 10 minutes (church Wi-Fi), 3 gifts per phone per hour, 10 code tries per gift.
- **Team changes** are recorded before they happen. A church cannot remove an owner if fewer than two active owners would remain; Maizz is emailed whenever an owner is removed.
- **Refunds:** the database refuses refunds that add up to more than the gift amount.
- **Alerts** for large gifts and amount mismatches are per gift.
- **GitHub:** `.github/workflows/tests.yml` runs the checks on every push; `.github/dependabot.yml` checks packages weekly. Turn on branch protection for `main` in GitHub settings so the checks must pass.
