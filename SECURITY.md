# Maizz security rules

These are Isaac's rules. Follow them in every step. Update the status and the reviewer list as the build grows.

## The nine rules

1. **Verify every Paystack webhook by its signature.** Never trust a payment message without checking it. Ask Paystack directly (verify) when the answer matters.
2. **No secret keys in the code or in chat.** Keys go in the Vercel settings boxes or GitHub repository secrets only.
3. **Limit repeated sign-in attempts, and use two-step sign-in (2FA)** for everyone who can see church or gift data.
4. **Never store card numbers or PINs.** Paystack holds those. Maizz never receives them.
5. **Log every change to the ledger and every admin action,** and keep the logs safe (durable, append-only, backed up).
6. **Alerts for odd things:** many failed sign-ins, sudden large gifts, or the daily books not matching Paystack.
7. **Least access:** each person and each part of the system gets only the access it needs.
8. **Automatic backups, and a written plan** for what to do if something goes wrong.
9. **Independent security review before any live money.** Remind Isaac before step 10, and whenever real money, a live key or a first church is mentioned. Keep the reviewer list below up to date.

## Status after the safety fixes (after step 3)

| Rule | Status | Notes |
| --- | --- | --- |
| 1 Webhook signatures | Meets | HMAC-SHA512 check, constant-time compare, before anything is read or recorded. Amount and currency must match the gift. Repeats recorded once. Tested, including with the check switched off. |
| 2 No secrets in code or chat | Meets | Scan of the repo found none. `.env` files are ignored by git. Setup page never returns a value. Keep it this way. |
| 3 Sign-in limits and 2FA | Partly | Admin tools now lock for 15 minutes after 5 wrong tokens from one source (20 from all sources), counted in the database, tested. Church sign-in does not exist yet (step 9). 2FA must be switched on for GitHub, Vercel, Supabase and Paystack accounts (Isaac's action). |
| 4 No card numbers or PINs | Meets | Mobile money PIN is entered on the giver's phone. Cards use Paystack's page. Maizz stores gift records and (later) names, phone numbers and emails, which are personal data for the Data Protection Commission. |
| 5 Logging | Mostly meets | Gift changes are append-only rows in `gift_events`. Admin actions, failed admin tokens, refused webhooks, amount mismatches and giver edits/anonymising/church creation go to the append-only `audit_log` (no secrets, phone numbers or names). Needs `0002_audit.sql` run in Supabase. Not yet backed up (rule 8). |
| 6 Alerts | Not built | No error alerts (Sentry), no large-gift alert, no reconciliation yet (step 6). |
| 7 Least access | Partly | One all-powerful Supabase key serves the public webhook and the admin tools. Update and delete are already removed from the ledger tables for that key. Admin tools refuse anything but a test key. They also stop working if the audit log is unreachable (fail closed). |
| 8 Backups and incident plan | Gap | Supabase Free has no automatic backups and pauses after a week of no use. No written incident plan yet. |
| 9 Independent review | Pending | Reviewer list below. Do not use a live key or take real money before it is done. |

## Fixes planned (in this order)

- ~~**Audit trail (rule 5):**~~ DONE: an append-only `audit_log` table in the database for admin actions, rejected webhooks and giver anonymisation, with no secrets or phone numbers in it. Add a trigger so giver edits are recorded.
- ~~**Attempt limits (rule 3):**~~ DONE for admin tools: count failed access-token attempts in the database and lock the setup tools for a while after repeated failures. Use Supabase Auth two-step sign-in for church users in step 9.
- **Alerts (rule 6):** Sentry for errors; alert rows and an email for failed signatures, amount mismatches, large gifts; daily reconciliation in step 6.
- **Least access (rule 7):** a narrower database role (or database functions) for the webhook, so it can only read gifts and add events. Remove the Supabase and Paystack keys from the Vercel Development environment, since only Production needs them. Move the admin tools out of the public app before live.
- **Backups and plan (rule 8):** move the database to Supabase Pro before any real data (daily backups kept 7 days), run a test restore, and write `docs/INCIDENT_RESPONSE.md` (who to call, how to pause payments, how to rotate keys, what to tell churches and the Data Protection Commission).
- **Change control:** protect the `main` branch (changes by pull request, tests must pass) and add automatic tests on every push, before the pilot. Today every push goes straight to the live site.
- **Separate test and live:** a separate Supabase project and separate keys for live money, so test tools can never touch the live ledger.

## Reviewer list: things the independent reviewer should look at

Webhook and payments
- `src/lib/payments/paystack.ts`: signature check, status mapping, and the refund notice fields (not yet confirmed against a real test run).
- `src/lib/payments/webhookHandler.ts`: out-of-order and late notices, refunds larger than paid, failed-payment detection (currently only through verify), what happens on an amount mismatch (logged, not recorded; needs a review queue).
- Replay of an old genuine notice (safe today because of the unique provider event id; confirm).
- Whether Paystack's source addresses should also be checked as a second layer.

Ledger and database
- `supabase/migrations/0001_ledger.sql`: append-only triggers, revoked privileges, no row-level-security policies on purpose. The database owner (the Supabase account) can still change triggers, so the owner's 2FA and a daily export or hash of the books should be reviewed.
- `src/lib/ledger.ts`: how queries are built and encoded; the service key's reach.
- Personal data: what is stored about givers, how it can be anonymised, retention, and Data Protection Commission registration.

Access and secrets
- Vercel environment settings: which keys exist in which environments, who can see them, and the `Sensitive` flag.
- `supabase/migrations/0002_audit.sql`, `src/lib/audit.ts`: what is logged, scrubbing of secrets, source fingerprint (hashed address), throttle on webhook entries, whether audit rows need exporting off-site.
- `src/lib/adminAuth.ts` and the `/setup-check`, `/api/admin/*` routes: token strength, attempt limiting, whether these should exist in the live app at all.
- GitHub, Vercel, Supabase and Paystack account access: owners, 2FA, who can push to `main`, what the build assistant can push.
- Rotation: how each key is replaced if it leaks.

App and platform
- Security headers (`next.config.ts`): a Content-Security-Policy is not set yet.
- Dependencies: automatic update and vulnerability checks are not set up yet.
- Logging: nothing sensitive in logs, how long they are kept, where alerts go.
- Backups, restore test and the incident plan.

Later steps to add to this list as they are built
- Fees maths (step 4, `src/lib/fees.ts`): 1.95% assumed, rounded up, gross-up so the church gets the gift; confirm rate, rounding and any levy with Paystack in writing; compare with the real fee Paystack reports per payment (step 6); payout fees (GH₵1 to mobile money, GH₵8 to bank) belong to step 7.
- The checkout page and receipts (step 5), reconciliation and refunds (step 6), church sub-accounts and payouts (step 7), the Church Manager link (step 8), the church dashboard and its sign-in (step 9).
