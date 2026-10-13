-- Maizz: a fresh emailed code for changing a church's payout account (security review fix A1).
-- Run after 0008. Nothing here changes or removes existing data. It only allows one more kind of one-use code for Maizz owners.

alter table owner_tokens drop constraint owner_tokens_kind_check;
alter table owner_tokens add constraint owner_tokens_kind_check check (kind in ('invite', 'code', 'session', 'reset', 'payout'));
