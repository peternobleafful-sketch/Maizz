-- Maizz: the Maizz owner's own sign-in, church applications, and a church-side "pause giving".
-- Run after 0007. Nothing here changes or removes existing data.

------------------------------------------------------------------------------
-- 1. The Maizz owner's own people (kept apart from church staff on purpose)
------------------------------------------------------------------------------

create table owner_users (
  id              uuid primary key default gen_random_uuid(),
  email           text not null check (email = lower(email) and length(email) <= 200 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  full_name       text not null check (length(full_name) between 1 and 120),
  status          text not null default 'invited' check (status in ('invited', 'active', 'disabled')),
  password_hash   text,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until    timestamptz,
  created_at      timestamptz not null default now()
);

create unique index owner_users_email_uniq on owner_users (email);

create table owner_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references owner_users (id) on delete cascade,
  kind        text not null check (kind in ('invite', 'code', 'session', 'reset')),
  token_hash  text not null,
  attempts    integer not null default 0 check (attempts >= 0),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

create unique index owner_tokens_hash_uniq on owner_tokens (token_hash) where kind in ('invite', 'session', 'reset');
create index owner_tokens_user_idx on owner_tokens (user_id, kind);

-- Every new owner and every change is recorded. No emails, names or hashes are written.
create function maizz_audit_owner_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (actor, action, target, outcome, detail)
  values ('database', 'owner.user_created', new.id::text, 'ok', '{}'::jsonb);
  return new;
end;
$$;

create trigger owner_users_audit_insert
  after insert on owner_users
  for each row execute function maizz_audit_owner_created();

create function maizz_audit_owner_updated() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  fields text[] := '{}';
begin
  if old.status is distinct from new.status then fields := array_append(fields, 'status'); end if;
  if old.password_hash is distinct from new.password_hash then fields := array_append(fields, 'password'); end if;
  if old.email is distinct from new.email then fields := array_append(fields, 'email'); end if;
  if cardinality(fields) > 0 then
    insert into audit_log (actor, action, target, outcome, detail)
    values ('database', 'owner.user_changed', new.id::text, 'ok',
            jsonb_build_object('changed_fields', to_jsonb(fields), 'status', new.status));
  end if;
  return new;
end;
$$;

create trigger owner_users_audit_update
  after update on owner_users
  for each row execute function maizz_audit_owner_updated();

------------------------------------------------------------------------------
-- 2. Church applications (the public "register your church" form)
------------------------------------------------------------------------------

create table church_applications (
  id            uuid primary key default gen_random_uuid(),
  church_name   text not null check (length(church_name) between 2 and 100),
  town          text check (town is null or length(town) <= 100),
  contact_name  text not null check (length(contact_name) between 1 and 120),
  contact_email text not null check (contact_email = lower(contact_email) and length(contact_email) <= 200 and contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  contact_phone text not null check (contact_phone ~ '^[0-9+ ()-]{7,20}$'),
  note          text check (note is null or length(note) <= 500),
  status        text not null default 'new' check (status in ('new', 'accepted', 'declined')),
  church_id     uuid references churches (id),
  created_at    timestamptz not null default now(),
  decided_at    timestamptz
);

create index church_applications_status_idx on church_applications (status, created_at);

-- Applications are recorded without any personal details.
create function maizz_audit_application() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into audit_log (actor, action, target, outcome, detail)
    values ('database', 'church.application_received', new.id::text, 'ok', '{}'::jsonb);
  elsif old.status is distinct from new.status then
    insert into audit_log (actor, action, target, outcome, detail)
    values ('database', 'church.application_decided', new.id::text, 'ok',
            jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  return new;
end;
$$;

create trigger church_applications_audit
  after insert or update on church_applications
  for each row execute function maizz_audit_application();

------------------------------------------------------------------------------
-- 3. A church can pause its own giving page (separate from Maizz suspending it)
------------------------------------------------------------------------------

alter table churches add column giving_paused boolean not null default false;

create or replace function maizz_audit_church_updated() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status is distinct from new.status then
    insert into audit_log (actor, action, target, outcome, detail)
    values ('database', 'church.status_changed', new.id::text, 'ok',
            jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  if old.giving_paused is distinct from new.giving_paused then
    insert into audit_log (actor, action, target, outcome, detail)
    values ('database', case when new.giving_paused then 'church.giving_paused' else 'church.giving_resumed' end,
            new.id::text, 'ok', '{}'::jsonb);
  end if;
  insert into audit_log (actor, action, target, outcome, detail)
  values (
    'database', 'church.updated', new.id::text, 'ok',
    jsonb_build_object(
      'changed_fields',
      coalesce((
        select jsonb_agg(n.key order by n.key)
        from jsonb_each(to_jsonb(new)) as n
        where n.value is distinct from (to_jsonb(old) -> n.key)
      ), '[]'::jsonb)
    )
  );
  return new;
end;
$$;

------------------------------------------------------------------------------
-- 4. The owner dashboard needs Maizz's own part of each fee in the gift view (a new column at the end; nothing else changes)
------------------------------------------------------------------------------

create or replace view gift_status with (security_invoker = true) as
select
  g.id as gift_id,
  g.reference,
  g.church_id,
  g.giver_id,
  g.gift_type,
  g.amount_pesewas,
  g.fee_pesewas,
  g.total_pesewas,
  case
    when paid.was_paid and refunds.refunded > 0 then 'refunded'
    when paid.was_paid then 'succeeded'
    else coalesce(latest.status, 'pending')
  end as status,
  paid.was_paid as was_paid,
  refunds.refunded::bigint as refunded_pesewas,
  g.created_at,
  g.maizz_fee_pesewas
from gifts g
left join lateral (
  select e.status from gift_events e where e.gift_id = g.id order by e.id desc limit 1
) latest on true
cross join lateral (
  select exists (select 1 from gift_events e where e.gift_id = g.id and e.status = 'succeeded') as was_paid
) paid
cross join lateral (
  select coalesce(sum(e.amount_pesewas), 0) as refunded
  from gift_events e where e.gift_id = g.id and e.status = 'refunded'
) refunds;

------------------------------------------------------------------------------
-- 5. Locked down like everything else: only the server's service role can reach these
------------------------------------------------------------------------------

alter table owner_users enable row level security;
alter table owner_tokens enable row level security;
alter table church_applications enable row level security;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on owner_users, owner_tokens, church_applications from %I', r);
    end if;
  end loop;
end;
$$;
