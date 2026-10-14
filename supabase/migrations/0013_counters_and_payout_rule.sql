-- Third review fixes. Run after 0012.
-- 1. Attempt counters get their own small table, cleared every night, so noise never fills the permanent audit log (finding 2).
-- 2. The old "person locked for everyone" state is cleared; the app no longer uses it (finding 1).
-- 3. The database refuses any payout-account change while a church is open for gifts (finding 7).
-- 4. Recovery codes are replaced in one step, so a failure can never leave an owner with none (finding 18).
-- Nothing here edits or removes ledger or audit rows.

------------------------------------------------------------------------------
-- 1. Counters
------------------------------------------------------------------------------

create table limit_hits (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  action      text not null check (length(action) between 1 and 80),
  source_key  text not null check (length(source_key) between 1 and 64)
);

create index limit_hits_lookup_idx on limit_hits (action, source_key, at);
create index limit_hits_at_idx on limit_hits (at);

alter table limit_hits enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on limit_hits from %I', r);
    end if;
  end loop;
end;
$$;

-- The old version wrote every hit to the permanent audit log. Replace it.
drop function maizz_hit(text, text, integer, text, text, text);

-- Records one hit and returns how many hits this action and source have had in the last p_minutes, including this one.
-- The advisory lock means two requests can never both see "0 so far".
create function maizz_hit(p_action text, p_source_key text, p_minutes integer) returns integer
language plpgsql
set search_path = public
as $$
declare
  n integer;
begin
  if p_action is null or p_source_key is null or p_minutes is null or p_minutes < 1 or p_minutes > 1440 then
    raise exception 'maizz_hit: bad input';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_action || '|' || p_source_key, 0));
  insert into limit_hits (action, source_key) values (p_action, p_source_key);
  select count(*)::integer into n
  from limit_hits
  where action = p_action
    and source_key = p_source_key
    and at >= clock_timestamp() - make_interval(mins => p_minutes);
  return n;
end;
$$;

do $$
declare
  r text;
begin
  revoke all on function maizz_hit(text, text, integer) from public;
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function maizz_hit(text, text, integer) from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function maizz_hit(text, text, integer) to service_role;
  end if;
end;
$$;

-- The nightly clean-up now also empties old counters. (Same grants as before; only the body changes.)
create or replace function maizz_clean_up(p_giver_days integer, p_application_days integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  g integer;
  a integer;
  c integer;
begin
  if p_giver_days is null or p_giver_days < 1 or p_application_days is null or p_application_days < 1 then
    raise exception 'maizz_clean_up: bad periods';
  end if;

  with old_unpaid as (
    select v.id
    from givers v
    where v.anonymised_at is null
      and v.created_at < now() - make_interval(days => p_giver_days)
      and not exists (select 1 from gift_status s where s.giver_id = v.id and s.was_paid)
      and not exists (select 1 from gifts x where x.giver_id = v.id and x.created_at >= now() - make_interval(days => p_giver_days))
  ), done as (
    update givers v
       set full_name = null, phone = null, email = null, anonymised_at = now()
      from old_unpaid o
     where v.id = o.id
    returning v.id
  )
  select count(*) into g from done;

  with done as (
    update church_applications
       set contact_name = null, contact_email = null, contact_phone = null, note = null, contact_removed_at = now()
     where status = 'declined'
       and contact_removed_at is null
       and coalesce(decided_at, created_at) < now() - make_interval(days => p_application_days)
    returning id
  )
  select count(*) into a from done;

  -- Counters are only ever needed for the last day (the longest window is 24 hours). Keep two days to be safe.
  with gone as (
    delete from limit_hits where at < now() - interval '2 days' returning id
  )
  select count(*) into c from gone;

  return jsonb_build_object('givers', g, 'applications', a, 'counters', c);
end;
$$;

------------------------------------------------------------------------------
-- 2. Clear the old person-wide lock
------------------------------------------------------------------------------

update owner_users set locked_until = null, failed_attempts = 0 where locked_until is not null or failed_attempts <> 0;
update church_users set locked_until = null, failed_attempts = 0 where locked_until is not null or failed_attempts <> 0;

------------------------------------------------------------------------------
-- 3. Payout account cannot change while the church is open for gifts
--    (the church must be suspended first; the 24-hour wait from 0012 then applies to opening it again).
------------------------------------------------------------------------------

create or replace function maizz_payout_cooldown() returns trigger
language plpgsql as $$
begin
  if old.status = 'active' and new.provider_subaccount_code is distinct from old.provider_subaccount_code then
    raise exception 'maizz_payout_active' using errcode = 'P0001';
  end if;
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

------------------------------------------------------------------------------
-- 4. Recovery codes replaced in one step
------------------------------------------------------------------------------

create function maizz_replace_recovery_codes(p_user uuid, p_hashes text[]) returns integer
language plpgsql
set search_path = public
as $$
declare
  n integer;
begin
  if p_user is null or p_hashes is null or cardinality(p_hashes) < 1 or cardinality(p_hashes) > 20 then
    raise exception 'maizz_replace_recovery_codes: bad input';
  end if;
  delete from owner_recovery_codes where user_id = p_user;
  insert into owner_recovery_codes (user_id, code_hash)
  select p_user, h from unnest(p_hashes) as h;
  select count(*)::integer into n from owner_recovery_codes where user_id = p_user;
  return n;
end;
$$;

do $$
declare
  r text;
begin
  revoke all on function maizz_replace_recovery_codes(uuid, text[]) from public;
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function maizz_replace_recovery_codes(uuid, text[]) from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function maizz_replace_recovery_codes(uuid, text[]) to service_role;
  end if;
end;
$$;
