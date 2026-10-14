# Separate live database (runbook)

Why: test gifts (reference `mz_test_...`) and real gifts must never share a database. Church dashboards, CSV downloads and the owner totals would count the test gifts as real money. So real money gets its own, empty Supabase project. The old project stays as the test project.

This is security review fix A3. Do it before any live Paystack key, and before the first real church.

## What changes and what stays

| | Test project (today) | Live project (new) |
|---|---|---|
| Supabase project | the one you have now | a new, empty one |
| Used by | Vercel **Preview** (and your own tests) | Vercel **Production** only |
| Paystack key | `sk_test_...` | `sk_live_...` (only after the legal and bank checks and the independent re-review) |
| Test gifts | allowed | **never** |

Maizz protects you in two ways. Checkout refuses to start when the key is live and the database holds any test gift. And the System page shows "Live key with test gifts in the database" as FIX if that ever happens.

## Steps (about 45 minutes, you do the clicks, Claude walks you through each)

1. **Create the live project.** In Supabase: New project, name it `maizz-live`, pick the region closest to Ghana that is offered, set a strong database password and keep it in your password manager. Choose the paid plan if you can: the free plan has no backups (see SECURITY.md, rule 8).
2. **Run every migration, in order, once.** In the live project open SQL Editor and run each file in `supabase/migrations/` from `0001` up to the latest, one at a time, in number order. Do not skip any. Never edit an old file.
3. **Add the first Maizz owner.** (First-owner set-up, below.)
4. **Put the live settings in Vercel, for Production only.** In Vercel, Settings, Environment Variables. For each variable below, set the live value and tick **Production only** (untick Preview and Development):
   - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from the live project
   - `PAYSTACK_SECRET_KEY` (the live secret key) and, in the Paystack dashboard, the live webhook address pointing at `/api/webhooks/paystack`
   - `STAFF_SECRET`, `CRON_SECRET`, `SETUP_CHECK_TOKEN`: **new** random values, not the test ones
   - `ALERT_EMAIL`, `RESEND_API_KEY`, `MAIZZ_FROM_EMAIL`, `MAIZZ_PUBLIC_URL`
   - Mark every secret as **Sensitive**.
5. **Keep the test project for Preview.** Set the old test values for Preview only (and leave Production without them). Never put a live key in Preview.
6. **Only now** set `MAIZZ_ALLOW_LIVE=yes` in Production, and only once Kobina has confirmed the company, bank account and legal checks, and the independent re-review of fixes A and B is done.
7. **Check.** Open the owner dashboard, System. Every line must say PASS, including "Live key with test gifts in the database".
8. **Backups.** Switch on paid backups for the live project and do one test restore into a scratch project before the first real church (SECURITY.md, rule 8).

## First-owner set-up on the live project

The old setup page is switched off in Production. For the very first owner only, it shows "Add the first Maizz owner" until that owner has chosen a password. Open `/setup-check`, enter `SETUP_CHECK_TOKEN`, add yourself, open the invite email and choose your password. After that the page answers 404 and everything is done from the owner dashboard. To add a second owner later, set `MAIZZ_ADMIN_TOOLS=on` in Production for a few minutes, add them, then remove it.

## If test gifts end up in the live database anyway

Checkout stops by itself. Do not delete anything by hand (the ledger is append-only). Tell Claude: the fix is to restore the live project from a clean backup or to start a new empty live project and point Production at it. Real gifts already taken must be moved with a careful, recorded export, not by editing rows.

## Rolling back

Point the Production variables back at the test project and the test key. Nothing in the live project is changed or deleted by doing this.

## Keeping test builds away from the live database

Set `MAIZZ_LIVE_DATABASE=yes` in **every** Vercel environment that holds the live Supabase settings (Production, and Preview or Development if the live settings were ever ticked for them). With it set, the old admin tools and the setup page answer 404 in that environment, and the override `MAIZZ_ADMIN_TOOLS=on` does nothing. They also stay off whenever the Paystack key is a live key. The test Supabase project must never have this setting.
