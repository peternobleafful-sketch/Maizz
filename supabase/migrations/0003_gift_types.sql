-- Maizz step 5: more gift types for the checkout page (seed, building fund, missions).
-- Only widens the list of allowed values. No gift is changed or removed.
alter table gifts drop constraint if exists gifts_gift_type_check;
alter table gifts add constraint gifts_gift_type_check
  check (gift_type in ('tithe', 'offering', 'thanksgiving', 'seed', 'building', 'missions', 'project', 'other'));
