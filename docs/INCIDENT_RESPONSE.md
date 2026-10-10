# Maizz incident response plan

Keep this short and keep it where Isaac can find it on a phone. Fill in the names and numbers marked **TO FILL IN** before the first real church. Review it every three months and after every incident.

## Who to call

| Role | Name | Phone | Email |
| --- | --- | --- | --- |
| Owner (decides, tells churches) | Isaac | **TO FILL IN** | **TO FILL IN** |
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
   - Or suspend a single church from the setup page (Churches, Suspend church).
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

1. Run **Run daily check now** on the setup page. It asks Paystack about every waiting gift and re-checks recent paid gifts.
2. Compare the Maizz books with the Paystack dashboard. Use **Download the books** on the setup page for a copy.
3. Never edit the ledger. It is append-only on purpose. A wrong gift is fixed by a refund through the setup page (test mode) or in the Paystack dashboard, which then arrives as a refund notice.
4. Tell the affected churches what happened, in plain words, before they find out themselves.

## Data problems (names, phone numbers, emails)

1. Work out which churches and which givers may be affected. The audit log (setup page) shows sign-ins, exports and changes. It never holds names, phone numbers or emails.
2. Remove access: rotate keys, remove the people who may have been involved (church dashboard, Team, Remove access, which signs them out at once).
3. **Tell the Data Protection Commission and the affected people** as the law requires, within the time the law allows. **TO FILL IN after legal advice: exact deadline and how to report.**

## Backups and restore

- Today: Supabase Free has **no automatic backups**. Until paid backups are on, download the books from the setup page at least weekly and keep the file somewhere safe.
- Before the first real church: upgrade Supabase to Pro (daily backups kept for 7 days), then do one **test restore** into a separate project and check the gift counts match. Write the date of the test below.
- Last test restore: **not done yet**.

## After the incident

1. Write what happened, when, what you did and what it cost. Keep it with this file.
2. Fix the cause, add a test or an alert so it cannot happen quietly again.
3. Update this plan.
4. Tell the independent security reviewer.
