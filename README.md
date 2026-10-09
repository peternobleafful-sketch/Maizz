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

## Running it
```
npm install
npm run dev
```
