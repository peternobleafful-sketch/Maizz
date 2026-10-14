-- Review finding #1: the owner's email inbox must not be enough to get in or to change where churches are paid.
-- The owner can switch on an authenticator app. Its secret is kept encrypted by the app (never readable here),
-- and recovery codes (for a lost phone) are kept only as keyed hashes.

alter table owner_users add column totp_secret text;
alter table owner_users add column totp_enabled_at timestamptz;
-- The newest 30-second step already used, so each code works once.
alter table owner_users add column totp_last_step bigint not null default 0;

create table owner_recovery_codes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references owner_users (id) on delete cascade,
  code_hash   text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  used_at     timestamptz,
  created_at  timestamptz not null default now(),
  unique (user_id, code_hash)
);

alter table owner_recovery_codes enable row level security;

-- Switching the app on or off is recorded by the database itself, whoever does it.
create function maizz_audit_owner_totp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.totp_enabled_at is distinct from new.totp_enabled_at then
    insert into audit_log (actor, action, target, outcome, detail)
    values ('database',
            case when new.totp_enabled_at is null then 'owner.authenticator_off' else 'owner.authenticator_on' end,
            new.id::text, 'ok', '{}'::jsonb);
  end if;
  return new;
end;
$$;

create trigger owner_users_audit_totp
  after update on owner_users
  for each row
  when (old.totp_enabled_at is distinct from new.totp_enabled_at)
  execute function maizz_audit_owner_totp();

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on owner_recovery_codes from %I', r);
    end if;
  end loop;
end;
$$;

------------------------------------------------------------------------------
-- Waiting period after a church's payout account is CHANGED (not the first time it is set).
-- The church cannot be opened for gifts again until 24 hours have passed, which gives the church's
-- own owners (who are emailed) and Maizz time to notice and undo a change nobody asked for.
-- Enforced by the database itself, so no bug or stolen sign-in in the app can skip it.
------------------------------------------------------------------------------

alter table churches add column payout_changed_at timestamptz;

create function maizz_payout_cooldown() returns trigger
language plpgsql as $$
begin
  if old.provider_subaccount_code is not null and new.provider_subaccount_code is distinct from old.provider_subaccount_code then
    new.payout_changed_at := now();
  end if;
  if new.status = 'active' and old.status is distinct from 'active'
     and new.payout_changed_at is not null and new.payout_changed_at > now() - interval '24 hours' then
    raise exception 'maizz_payout_cooldown' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger churches_payout_cooldown
  before update on churches
  for each row execute function maizz_payout_cooldown();
