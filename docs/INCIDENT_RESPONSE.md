# Maizz incident response plan

Keep this short and keep it where Kobina can find it on a phone. Fill in the names and numbers marked **TO FILL IN** before the first real church. Review it every three months and after every incident.

## Who to call

| Role | Name | Phone | Email |
| --- | --- | --- | --- |
| Owner (decides, tells churches) | Kobina (Peter Noble Afful on documents) | **TO FILL IN** | **TO FILL IN** |
| Developer or reviewer on call | **TO FILL IN** | **TO FILL IN** | **TO FILL IN** |
| Payment provider support (Paystack Ghana) | Paystack | **TO FILL IN** | support@paystack.com (confirm) |
| Data Protection Commission (Ghana) | DPC | **TO FILL IN** | **TO FILL IN** |
| Accountant or lawyer | **TO FILL IN** | **TO FILL IN** | **TO FILL IN** |

## What counts as an incident

- Money moved wrongly, or a payment shows paid in one place and not the other.
- Someone may have seen or taken a secret key, a password or church or giver data.
- A security alert email you cannot explain (many failed sign-ins, a bad payment signature, a large unexpected gift, the daily check failing or not running).
- The site, the database or the payment provider is down for a long time.

When unsure, treat it as an incident. A false alarm costs little.

## First 15 minutes: stop the harm

1. **Write down the time** and what you saw. Do not delete anything.
2. **Pause giving if money or data may be at risk.** Fastest ways, in this order:
   - Vercel: Settings, Environment Variables, delete `PAYSTACK_SECRET_KEY` for Production, then Redeploy. Giving stops (the page cannot start payments).
   - Or suspend a single church from the owner dashboard (Churches, Manage, Suspend church). A church's own owner can also pause their page from Settings, but a pause is not a security tool: only a suspension cannot be undone by the church.
   - If someone may have got into the owner dashboard, ask Maizz owners to change their passwords (/owner/forgot). A new password signs that person out everywhere. Check the audit log for `staff.signin` by an `owner:` actor.
3. **If a key may have leaked, rotate it now** (see below).
4. **Tell the developer or reviewer** and keep a written log of every step you take.

## Rotating secrets

Do each in the service's own dashboard, then paste the new value into Vercel (Settings, Environment Variables, Production) and redeploy. Never paste a key in chat or email.

| Secret | Where it is made | What else to do |
| --- | --- | --- |
| `PAYSTACK_SECRET_KEY` | Paystack dashboard, Settings, API Keys | Webhook signatures use the same key, so Paystack's notices keep working after the swap |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase, Project Settings, API | Old key stops working at once |
| `SETUP_CHECK_TOKEN`, `CRON_SECRET`, `STAFF_SECRET` | Make up new long random strings | Changing `STAFF_SECRET` signs everyone out and makes every unused invite, reset link and code unusable. Re-send invites afterwards |
| `RESEND_API_KEY` | Resend dashboard, API Keys | |
| GitHub, Vercel, Supabase, Paystack passwords | Each service | Turn on 2FA if it was off. Sign out other sessions |

## Money problems

1. Run **Run the daily check now** on the owner dashboard (System). It asks Paystack about every waiting gift and re-checks recent paid gifts.
2. Compare the Maizz books with the Paystack dashboard. Use **Download the books** on the owner dashboard (System) for a copy.
3. Never edit the ledger. It is append-only on purpose. A wrong gift is fixed by a refund (test mode only, through the admin tool outside Production) or in the Paystack dashboard, which then arrives as a refund notice.
4. Tell the affected churches what happened, in plain words, before they find out themselves.

## Data problems (names, phone numbers, emails)

1. Work out which churches and which givers may be affected. The audit log (owner dashboard, Activity) shows sign-ins, exports and changes. It never holds names, phone numbers or emails.
2. Remove access: rotate keys, remove the people who may have been involved (church dashboard, Team, Remove access, which signs them out at once).
3. **Tell the Data Protection Commission and the affected people** as the law requires, within the time the law allows. **TO FILL IN after legal advice: exact deadline and how to report.**

## Backups and restore

- Today: Supabase Free has **no automatic backups**. Until paid backups are on, download the books from the owner dashboard (System) at least weekly and keep the file somewhere safe.
- Before the first real church: upgrade Supabase to Pro (daily backups kept for 7 days), then do one **test restore** into a separate project and check the gift counts match. Write the date of the test below.
- Last test restore: **not done yet**.

## After the incident

1. Write what happened, when, what you did and what it cost. Keep it with this file.
2. Fix the cause, add a test or an alert so it cannot happen quietly again.
3. Update this plan.
4. Tell the independent security reviewer.


## The owner lost their phone and their recovery codes

Use a recovery code first (System page, "Sign-in security", then sign in with a recovery code instead of the app code). If there are none left:

1. Open Supabase, SQL Editor, and run (with the owner's real email in place of the example):
   `update owner_users set totp_secret = null, totp_enabled_at = null where email = 'owner@example.com';`
2. The database records "owner.authenticator_off" in the audit log by itself.
3. Sign in with the email code, then set the app up again on the new phone and save the new recovery codes.
4. Treat it as an incident until you are sure nobody else asked for this: check the audit log for sign-ins you do not recognise.
