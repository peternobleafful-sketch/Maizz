-- Maizz ledger (step 2). No payments yet.
--
-- Rules:
--   * Money is stored as whole pesewas (1 GH₵ = 100 pesewas) in bigint columns. Never decimals.
--   * gifts and gift_events are APPEND-ONLY. Rows are added, never edited or deleted.
--     A gift's progress (pending, succeeded, ...) is recorded by adding a new gift_events row.
--   * Only the server (Supabase service role) may touch these tables. The public/anon and
--     logged-in roles get no access at all.
--   * churches and givers can never be deleted. Givers can be updated so their personal
--     details can be anonymised later without touching any money record.

------------------------------------------------------------------------------
-- Tables
------------------------------------------------------------------------------

create table churches (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  created_at  timestamptz not null default now()
);

create table givers (
  id             uuid primary key default gen_random_uuid(),
  full_name      text,
  phone          text,
  email          text,
  anonymised_at  timestamptz,
  created_at     timestamptz not null default now()
);

create table gifts (
  id              uuid primary key default gen_random_uuid(),
  -- Our own reference for the gift. Sent to the payment provider and used to find it again.
  reference       text not null unique check (length(reference) between 8 and 100),
  church_id       uuid not null references churches (id),
  giver_id        uuid references givers (id),
  gift_type       text not null check (gift_type in ('tithe', 'offering', 'thanksgiving', 'project', 'other')),
  provider        text not null default 'paystack',
  -- What the church receives, exactly.
  amount_pesewas  bigint not null check (amount_pesewas > 0),
  -- What the giver pays on top to cover fees (step 4 fills this in).
  fee_pesewas     bigint not null default 0 check (fee_pesewas >= 0),
  total_pesewas   bigint not null,
  currency        text not null default 'GHS' check (currency = 'GHS'),
  created_at      timestamptz not null default now(),
  constraint gifts_total_matches check (total_pesewas = amount_pesewas + fee_pesewas)
);

create index gifts_church_idx on gifts (church_id, created_at);
create index gifts_giver_idx on gifts (giver_id);

create table gift_events (
  id                 bigint generated always as identity primary key,
  gift_id            uuid not null references gifts (id),
  status             text not null check (status in ('pending', 'succeeded', 'failed', 'abandoned', 'refunded')),
  -- Used for refunds only: how much was refunded, in pesewas. Refund rules are finalised in step 6.
  amount_pesewas     bigint check (amount_pesewas is null or amount_pesewas > 0),
  -- The provider's own id for this event, so a repeated notice is never recorded twice.
  provider_event_id  text,
  detail             jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  constraint gift_events_refund_has_amount check (status <> 'refunded' or amount_pesewas is not null)
);

create index gift_events_gift_idx on gift_events (gift_id, id);
create unique index gift_events_provider_event_uniq
  on gift_events (provider_event_id) where provider_event_id is not null;

------------------------------------------------------------------------------
-- Append-only protection
------------------------------------------------------------------------------

create function maizz_block_change() returns trigger
language plpgsql as $$
begin
  raise exception 'Maizz ledger is append-only: % on % is not allowed', tg_op, tg_table_name;
end;
$$;

-- gifts and gift_events: no edits, no deletes, no truncating.
create trigger gifts_append_only
  before update or delete on gifts
  for each row execute function maizz_block_change();
create trigger gifts_no_truncate
  before truncate on gifts
  for each statement execute function maizz_block_change();

create trigger gift_events_append_only
  before update or delete on gift_events
  for each row execute function maizz_block_change();
create trigger gift_events_no_truncate
  before truncate on gift_events
  for each statement execute function maizz_block_change();

-- churches and givers: never deleted.
create trigger churches_no_delete
  before delete on churches
  for each row execute function maizz_block_change();
create trigger churches_no_truncate
  before truncate on churches
  for each statement execute function maizz_block_change();

create trigger givers_no_delete
  before delete on givers
  for each row execute function maizz_block_change();
create trigger givers_no_truncate
  before truncate on givers
  for each statement execute function maizz_block_change();

------------------------------------------------------------------------------
-- Read-only views (security_invoker, so they never bypass the access rules)
------------------------------------------------------------------------------

-- One row per gift with its current status (the latest event; 'pending' if none yet).
create view gift_status with (security_invoker = true) as
select
  g.id as gift_id,
  g.reference,
  g.church_id,
  g.giver_id,
  g.gift_type,
  g.amount_pesewas,
  g.fee_pesewas,
  g.total_pesewas,
  coalesce(latest.status, 'pending') as status,
  exists (
    select 1 from gift_events e where e.gift_id = g.id and e.status = 'succeeded'
  ) as was_paid,
  coalesce((
    select sum(e.amount_pesewas) from gift_events e
    where e.gift_id = g.id and e.status = 'refunded'
  ), 0)::bigint as refunded_pesewas,
  g.created_at
from gifts g
left join lateral (
  select e.status from gift_events e where e.gift_id = g.id order by e.id desc limit 1
) latest on true;

-- What each church has received so far, in pesewas (paid gifts less refunds).
create view church_totals with (security_invoker = true) as
select
  c.id as church_id,
  coalesce(sum(s.amount_pesewas - s.refunded_pesewas) filter (where s.was_paid), 0)::bigint as received_pesewas,
  count(*) filter (where s.was_paid) as paid_gift_count
from churches c
left join gift_status s on s.church_id = c.id
group by c.id;

------------------------------------------------------------------------------
-- Locked-down access
------------------------------------------------------------------------------

alter table churches    enable row level security;
alter table givers      enable row level security;
alter table gifts       enable row level security;
alter table gift_events enable row level security;
-- No policies are created on purpose: with row level security on and no policies,
-- the public and logged-in roles can see and change nothing. The server's service
-- role bypasses row level security and is the only way in.

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format(
        'revoke all on churches, givers, gifts, gift_events, gift_status, church_totals from %I', r);
    end if;
  end loop;

  -- Belt and braces: even the server role is denied edits and deletes on the ledger tables.
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke update, delete, truncate on gifts, gift_events from service_role;
  end if;
end;
$$;
