-- Maizz: password reset links for church sign-in.
-- A reset link is a one-use token (kind 'reset'), stored only as a keyed hash like invites and sessions.

alter table staff_tokens drop constraint staff_tokens_kind_check;
alter table staff_tokens add constraint staff_tokens_kind_check check (kind in ('invite', 'code', 'session', 'reset'));

drop index staff_tokens_hash_uniq;
create unique index staff_tokens_hash_uniq on staff_tokens (token_hash) where kind in ('invite', 'session', 'reset');
