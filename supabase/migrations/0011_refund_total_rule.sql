-- Review fix C2: the database itself refuses refunds that add up to more than the gift amount (fees are never refunded),
-- and refunds on a gift that was never paid. App code checks the same, but two refund messages arriving at the same
-- instant could both pass the app check. The lock below makes them go through the rule one at a time.

create function maizz_check_refund() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  gift_amount bigint;
  already bigint;
  paid boolean;
begin
  if new.status <> 'refunded' then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('refund|' || new.gift_id::text, 0));

  select amount_pesewas into gift_amount from gifts where id = new.gift_id;
  select exists (select 1 from gift_events where gift_id = new.gift_id and status = 'succeeded') into paid;
  select coalesce(sum(amount_pesewas), 0) into already from gift_events where gift_id = new.gift_id and status = 'refunded';

  if gift_amount is null or not paid or new.amount_pesewas is null or new.amount_pesewas <= 0
     or already + new.amount_pesewas > gift_amount then
    raise exception 'maizz_refund_exceeds_gift' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger gift_events_check_refund
  before insert on gift_events
  for each row execute function maizz_check_refund();
