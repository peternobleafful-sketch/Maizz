-- Maizz step 9, part 1: people who sign in for a church.
-- Sign-in is a password plus a six-digit code sent to the person's email (two steps).
-- Passwords are stored only as salted scrypt hashes. Codes, invite links and sessions are stored only as one-way hashes.

create table church_users (
  id              uuid primary key default gen_random_uuid(),
  church_id       uuid not null references churches (id),
  email           text not null check (email = lower(email) and length(email) <= 200 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  full_name       text not null check (length(full_name) between 1 and 120),
  role            text not null check (role in ('owner', 'finance', 'viewer')),
  status          text not null default 'invited' check (status in ('invited', 'active', 'disabled')),
  password_hash   text,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until    timestamptz,
  created_at      timestamptz not null default now()
);

create unique index church_users_email_uniq on church_users (email);
create index church_users_church_idx on church_users (church_id);

create table staff_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references church_users (id) on delete cascade,
  kind        text not null check (kind in ('invite', 'code', 'session')),
  token_hash  text not null,
  attempts    integer not null default 0 check (attempts >= 0),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

create unique index staff_tokens_hash_uniq on staff_tokens (token_hash) where kind in ('invite', 'session');
create index staff_tokens_user_idx on staff_tokens (user_id, kind);

-- Every new person and every change to role, status, church or password is recorded. No emails, names or hashes are written.
create function maizz_audit_staff_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (actor, action, target, outcome, detail)
  values ('database', 'staff.user_created', new.id::text, 'ok',
          jsonb_build_object('church_id', new.church_id, 'role', new.role));
  return new;
end;
$$;

create trigger church_users_audit_insert
  after insert on church_users
  for each row execute function maizz_audit_staff_created();

create function maizz_audit_staff_updated() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  fields text[] := '{}';
begin
  if old.church_id is distinct from new.church_id then fields := array_append(fields, 'church_id'); end if;
  if old.role is distinct from new.role then fields := array_append(fields, 'role'); end if;
  if old.status is distinct from new.status then fields := array_append(fields, 'status'); end if;
  if old.password_hash is distinct from new.password_hash then fields := array_append(fields, 'password'); end if;
  if old.email is distinct from new.email then fields := array_append(fields, 'email'); end if;
  if cardinality(fields) > 0 then
    insert into audit_log (actor, action, target, outcome, detail)
    values ('database', 'staff.user_changed', new.id::text, 'ok',
            jsonb_build_object('changed_fields', to_jsonb(fields), 'status', new.status, 'role', new.role));
  end if;
  return new;
end;
$$;

create trigger church_users_audit_update
  after update on church_users
  for each row execute function maizz_audit_staff_updated();

alter table church_users enable row level security;
alter table staff_tokens enable row level security;
-- No policies on purpose: only the server's service role can reach these tables.

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on church_users, staff_tokens from %I', r);
    end if;
  end loop;
end;
$$;
