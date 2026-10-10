-- Maizz audit log (safety fix). Run after 0001_ledger.sql.
--
-- Rules:
--   * audit_log is APPEND-ONLY, like the ledger. Rows are added, never edited or deleted.
--   * It records who did what and when: admin actions, refused sign-in attempts, refused or
--     odd payment notices, changes to giver details, new churches.
--   * It never holds keys, tokens, phone numbers, emails or names. The app scrubs what it
--     writes, and the database triggers below record only the NAMES of changed fields.
--   * Only the server (Supabase service role) can reach it.

create table audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  -- Who: 'admin', 'webhook', 'database', 'unknown'.
  actor       text not null check (length(actor) between 1 and 60),
  action      text not null check (length(action) between 1 and 80),
  -- What it was about (a gift reference, giver id, church id). Never personal details.
  target      text check (target is null or length(target) <= 200),
  outcome     text not null default 'ok' check (outcome in ('ok', 'denied', 'failed')),
  -- A one-way fingerprint of where a request came from, used to limit repeated attempts.
  source_key  text check (source_key is null or length(source_key) <= 64),
  detail      jsonb not null default '{}'::jsonb
);

create index audit_log_action_idx on audit_log (action, at);
create index audit_log_source_idx on audit_log (action, source_key, at) where source_key is not null;

------------------------------------------------------------------------------
-- Append-only protection (uses the function made in 0001)
------------------------------------------------------------------------------

create trigger audit_log_append_only
  before update or delete on audit_log
  for each row execute function maizz_block_change();
create trigger audit_log_no_truncate
  before truncate on audit_log
  for each statement execute function maizz_block_change();

------------------------------------------------------------------------------
-- Automatic records the app cannot forget to write
------------------------------------------------------------------------------

-- Any change to a giver's details is recorded: which fields changed (names only, never values),
-- and whether this was an anonymisation.
create function maizz_audit_giver_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (actor, action, target, outcome, detail)
  values (
    'database',
    case when old.anonymised_at is null and new.anonymised_at is not null
         then 'giver.anonymised' else 'giver.updated' end,
    new.id::text,
    'ok',
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

create trigger givers_audit_update
  after update on givers
  for each row
  when (old.* is distinct from new.*)
  execute function maizz_audit_giver_update();

create function maizz_audit_church_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (actor, action, target, outcome, detail)
  values ('database', 'church.created', new.id::text, 'ok', jsonb_build_object('slug', new.slug));
  return new;
end;
$$;

create trigger churches_audit_insert
  after insert on churches
  for each row execute function maizz_audit_church_created();

------------------------------------------------------------------------------
-- Locked-down access
------------------------------------------------------------------------------

alter table audit_log enable row level security;
-- No policies on purpose: the public and logged-in roles can see and change nothing.

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on audit_log from %I', r);
      -- The counters behind the id columns are not for them either.
      execute format('revoke all on sequence audit_log_id_seq from %I', r);
      execute format('revoke all on sequence gift_events_id_seq from %I', r);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke update, delete, truncate on audit_log from service_role;
  end if;
end;
$$;
