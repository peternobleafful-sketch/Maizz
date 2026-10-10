-- Maizz step 6: a late or out-of-order notice can never un-pay a gift.
-- Replaces the two read-only views. No gift or event row is changed.
--   * Once a gift has a 'succeeded' event it stays succeeded (or refunded), whatever arrives later.
--   * A church is only ever debited up to the gift amount, never the fee.

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
  g.created_at
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

create or replace view church_totals with (security_invoker = true) as
select
  c.id as church_id,
  coalesce(sum(s.amount_pesewas - least(s.refunded_pesewas, s.amount_pesewas)) filter (where s.was_paid), 0)::bigint as received_pesewas,
  count(*) filter (where s.was_paid) as paid_gift_count
from churches c
left join gift_status s on s.church_id = c.id
group by c.id;
