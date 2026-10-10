-- Maizz step 7: church accounts.
-- A church starts "pending" and cannot receive gifts until it is made "active".
-- Maizz keeps only the last 4 digits of a church's payout account number. Paystack holds the rest.
-- Existing churches (the test church) stay active.

alter table churches add column status text not null default 'active'
  check (status in ('pending', 'active', 'suspended'));
alter table churches alter column status set default 'pending';

alter table churches
  add column provider_subaccount_code text,
  add column payout_bank_code         text,
  add column payout_bank_name         text,
  add column payout_account_last4     text check (payout_account_last4 is null or payout_account_last4 ~ '^[0-9]{4}$'),
  add column payout_account_name      text;

create unique index churches_subaccount_uniq on churches (provider_subaccount_code)
  where provider_subaccount_code is not null;

-- The part of each gift's fee that is Maizz's own (the rest covers the payment provider).
alter table gifts add column maizz_fee_pesewas bigint not null default 0
  check (maizz_fee_pesewas >= 0 and maizz_fee_pesewas <= fee_pesewas);

-- A church's web address never changes.
create function maizz_block_slug_change() returns trigger
language plpgsql as $$
begin
  raise exception 'A church slug cannot be changed';
end;
$$;

create trigger churches_slug_fixed
  before update of slug on churches
  for each row
  when (old.slug is distinct from new.slug)
  execute function maizz_block_slug_change();

-- Every change to a church is recorded: status changes with from/to, other changes as field names only.
create function maizz_audit_church_updated() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status is distinct from new.status then
    insert into audit_log (actor, action, target, outcome, detail)
    values ('database', 'church.status_changed', new.id::text, 'ok',
            jsonb_build_object('from', old.status, 'to', new.status));
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

create trigger churches_audit_update
  after update on churches
  for each row
  when (old.* is distinct from new.*)
  execute function maizz_audit_church_updated();
