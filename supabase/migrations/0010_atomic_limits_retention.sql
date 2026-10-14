-- Maizz: security review group B. Run after 0009.
-- 1. Atomic attempt counters (B1): count and record in one step, so a burst of simultaneous requests cannot slip past a limit.
-- 2. Room to remove a declined applicant's contact details after 90 days (B3).
-- Nothing here changes or removes existing data.

------------------------------------------------------------------------------
-- 1. Atomic counters
------------------------------------------------------------------------------

-- Records one hit (an audit row) and returns how many hits this action and source have had in the last p_minutes, including this one.
-- Callers hold an advisory lock on (action, source), so two requests can never both see "0 so far".
create function maizz_hit(
  p_action text,
  p_source_key text,
  p_minutes integer,
  p_outcome text default 'ok',
  p_target text default null,
  p_actor text default 'system'
) returns integer
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
  insert into audit_log (actor, action, target, outcome, source_key)
  values (p_actor, p_action, p_target, p_outcome, p_source_key);
  select count(*)::integer into n
  from audit_log
  where action = p_action
    and source_key = p_source_key
    and at >= clock_timestamp() - make_interval(mins => p_minutes);
  return n;
end;
$$;

-- Adds one to a person's wrong-attempt count and returns the new number, in one statement.
create function maizz_staff_fail(p_user uuid, p_area text) returns integer
language plpgsql
set search_path = public
as $$
declare
  n integer;
begin
  if p_area = 'owner' then
    update owner_users set failed_attempts = failed_attempts + 1 where id = p_user returning failed_attempts into n;
  elsif p_area = 'church' then
    update church_users set failed_attempts = failed_attempts + 1 where id = p_user returning failed_attempts into n;
  else
    raise exception 'maizz_staff_fail: bad area';
  end if;
  return n;
end;
$$;

-- Adds one to a code's try count and returns the new number, in one statement.
create function maizz_code_attempt(p_token uuid, p_area text) returns integer
language plpgsql
set search_path = public
as $$
declare
  n integer;
begin
  if p_area = 'owner' then
    update owner_tokens set attempts = attempts + 1 where id = p_token returning attempts into n;
  elsif p_area = 'church' then
    update staff_tokens set attempts = attempts + 1 where id = p_token returning attempts into n;
  else
    raise exception 'maizz_code_attempt: bad area';
  end if;
  return n;
end;
$$;

-- Only the server (service role) may call these.
do $$
declare
  r text;
begin
  revoke all on function maizz_hit(text, text, integer, text, text, text) from public;
  revoke all on function maizz_staff_fail(uuid, text) from public;
  revoke all on function maizz_code_attempt(uuid, text) from public;
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function maizz_hit(text, text, integer, text, text, text) from %I', r);
      execute format('revoke all on function maizz_staff_fail(uuid, text) from %I', r);
      execute format('revoke all on function maizz_code_attempt(uuid, text) from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function maizz_hit(text, text, integer, text, text, text) to service_role;
    grant execute on function maizz_staff_fail(uuid, text) to service_role;
    grant execute on function maizz_code_attempt(uuid, text) to service_role;
  end if;
end;
$$;

------------------------------------------------------------------------------
-- 2. Declined applicants: contact details can be removed after 90 days
------------------------------------------------------------------------------

alter table church_applications alter column contact_name drop not null;
alter table church_applications alter column contact_email drop not null;
alter table church_applications alter column contact_phone drop not null;
alter table church_applications add column contact_removed_at timestamptz;

-- Removing contact details is recorded (no details, only the fact).
create or replace function maizz_audit_application() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into audit_log (actor, action, target, outcome, detail)
    values ('database', 'church.application_received', new.id::text, 'ok', '{}'::jsonb);
  else
    if old.status is distinct from new.status then
      insert into audit_log (actor, action, target, outcome, detail)
      values ('database', 'church.application_decided', new.id::text, 'ok',
              jsonb_build_object('from', old.status, 'to', new.status));
    end if;
    if old.contact_removed_at is null and new.contact_removed_at is not null then
      insert into audit_log (actor, action, target, outcome, detail)
      values ('database', 'church.application_contact_removed', new.id::text, 'ok', '{}'::jsonb);
    end if;
  end if;
  return new;
end;
$$;

------------------------------------------------------------------------------
-- 3. Daily clean-up of personal details
--    * Givers whose gifts were never paid, and whose newest gift is older than p_giver_days,
--      are anonymised (name, phone, email removed). Paid gifts and their givers are never touched here.
--    * Declined applications older than p_application_days lose their contact details.
--    The giver trigger from 0002 records each anonymisation.
------------------------------------------------------------------------------

create function maizz_clean_up(p_giver_days integer, p_application_days integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  g integer;
  a integer;
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

  return jsonb_build_object('givers', g, 'applications', a);
end;
$$;

do $$
declare
  r text;
begin
  revoke all on function maizz_clean_up(integer, integer) from public;
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function maizz_clean_up(integer, integer) from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function maizz_clean_up(integer, integer) to service_role;
  end if;
end;
$$;
