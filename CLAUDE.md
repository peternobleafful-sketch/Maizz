# Maizz: instructions for every session

Maizz is a giving platform for churches in Ghana. Its own service, separate from Church Manager (customer #1). Owner: Isaac, who is not a developer.

## How to work with Isaac
- Speak plainly. Keep replies short. Keep usage low. British spelling.
- Discuss new directions first. Build only when he says "build". Small fixes can go ahead.
- Tell him plainly what each step cost in time and what he needs to do. Walk him through dashboard clicks step by step.
- Never ask him to paste secret keys in chat. Keys go into settings boxes (Vercel) or GitHub repository secrets.

## Security rules (read `SECURITY.md` first)
Nine rules apply to all work: verify webhook signatures; no secrets in code or chat; limit sign-in attempts and use 2FA; never store card numbers or PINs; log every ledger change and admin action; alerts for odd things; least access; backups and a written incident plan; independent security review before any live money.
- Keep the status table and the reviewer list in `SECURITY.md` up to date at the end of every step. Say plainly if a change breaks one of the rules.
- Remind Isaac of the independent review before step 10, and whenever real money, a live key or a first church comes up.

## Money rules
- Test mode only until Isaac confirms the company, bank account and legal checks are done. No real money before then. Live Paystack keys are refused unless `MAIZZ_ALLOW_LIVE=yes`.
- Money is whole pesewas only. Never decimals. The ledger is append-only: nothing edited or deleted.
- Givers cover the fees; the church receives the exact gift. Paystack stays hidden: givers see only Maizz (mobile money first, charged directly from our page).
- Apple: the iPhone app opens a web checkout page. Never an in-app pay button.

## Design
Changed by Isaac on 10 Oct 2026 (he chose to drop Black and Gold). Brand: Maizz Blue (#011BFF), white and ink (#0A0A0F), inspired by atom.money's look: bold flat blue, soft gradients in hero areas, large confident type, rounded surfaces. Gradients are allowed, used sparingly. Logo files are in `public/brand` (ink and white versions). Fonts Outfit and DM Mono. Mobile first; givers use phones.

## Build order
1 project, 2 ledger, 3 Paystack connection (test mode), 4 fees, 5 checkout page, 6 safety (duplicates, late notices, failures, refunds, daily reconciliation), 7 church sub-accounts, 8 Church Manager link, 9 church dashboard, 10 security review + Data Protection Commission + tiny live pilot, 11 later (replace the GH₵5 collection, more churches, second provider). Build each step alone and test it before the next.

## Do not touch
The Church Manager and "The KA Staff" app repositories.
