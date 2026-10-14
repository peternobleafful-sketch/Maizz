-- Step 8: the Church Manager "My giving" link. Run after 0013.
-- A member who taps "Give now" in Church Manager arrives with a signed tag. A gift made that way carries an opaque
-- member reference (no name, no phone), so Church Manager can later ask "what has this member given at my church?".
-- Nothing here edits or removes existing rows.

-- The reference is an opaque id chosen by Church Manager (letters, digits, - and _ only). It is set when the gift is created.
alter table gifts add column member_ref text
  check (member_ref is null or member_ref ~ '^[A-Za-z0-9_-]{1,64}$');

create index gifts_member_idx on gifts (church_id, member_ref, created_at) where member_ref is not null;

-- Per church: the link is off until Maizz switches it on. "Version" lets Maizz replace the church's signing key
-- (if it leaks) without touching any gift.
alter table churches add column member_link_enabled boolean not null default false;
alter table churches add column member_link_version integer not null default 1 check (member_link_version >= 1);

-- Same view as before, with the member reference added at the end.
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
  g.maizz_fee_pesewas,
  g.member_ref
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

-- Switching the link on or off, or replacing the church's key, is recorded by the database itself.
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
  if old.member_link_enabled is distinct from new.member_link_enabled then
    insert into audit_log (actor, action, target, outcome, detail)
    values ('database', case when new.member_link_enabled then 'church.member_link_on' else 'church.member_link_off' end,
            new.id::text, 'ok', '{}'::jsonb);
  end if;
  if old.member_link_version is distinct from new.member_link_version then
    insert into audit_log (actor, action, target, outcome, detail)
    values ('database', 'church.member_link_key_replaced', new.id::text, 'ok', '{}'::jsonb);
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
