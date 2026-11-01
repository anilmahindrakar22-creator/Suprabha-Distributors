-- Isolated gateway writes; every fixture and change rolls back.
begin;
insert into private.stockflow_gateway_config(name,secret_sha256)
values('orders',encode(extensions.digest('pin-move-test-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,status)
select 'pin-move-'||r||'@test.local',r,'active'
from unnest(array['sales','operations','management','administrator']) r;
insert into private.stockflow_customers(id,name,created_by_email) values
 ('19300000-0000-4000-8000-000000000001','Pin move fixture','test'),
 ('19300000-0000-4000-8000-000000000002','Town upgrade fixture','test');

create function pg_temp.pm_call(payload jsonb,actor text default 'sales') returns jsonb language sql as $$
 select public.stockflow_accounts_gateway('pin-move-test-key','pin-move-'||actor||'@test.local','set_location',payload)
$$;
create function pg_temp.pm_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL %',label;end if;end$$;
create function pg_temp.pm_denied(payload jsonb,actor text default 'sales') returns void language plpgsql as $$
begin
 begin perform pg_temp.pm_call(payload,actor);
 exception when sqlstate 'PT403' then
  if sqlerrm='Only management can move a pin' then return;end if;
  raise;
 end;
 raise exception 'Expected PT403 Only management can move a pin';
end$$;

do $checks$
declare customer uuid:='19300000-0000-4000-8000-000000000001';
 town_customer uuid:='19300000-0000-4000-8000-000000000002';
 payload jsonb; before_location jsonb; before_events bigint; version_before integer; actor text;
begin
 payload:=jsonb_build_object('customerId',customer,'idempotencyKey','pin-move-first-pin-001','expectedVersion',null,
  'precision','pin','latitude','17.300000','longitude','76.800000','source','manual_pin');
 perform pg_temp.pm_call(payload);
 select to_jsonb(l),l.version into before_location,version_before
 from private.stockflow_customer_locations l where customer_id=customer;
 perform pg_temp.pm_assert(before_location->>'precision'='pin' and version_before=1,'sales places first pin');
 select count(*) into before_events from private.stockflow_customer_location_events where customer_id=customer;
 foreach actor in array array['sales','operations'] loop
  perform pg_temp.pm_denied(payload||jsonb_build_object('idempotencyKey','pin-move-denied-'||actor,
   'expectedVersion',version_before,'latitude','17.400000'),actor);
  perform pg_temp.pm_denied(jsonb_build_object('customerId',customer,'idempotencyKey','pin-town-denied-'||actor,
   'expectedVersion',version_before,'precision','town','town','Fixture Town','source','town'),actor);
 end loop;
 perform pg_temp.pm_assert((select to_jsonb(l)=before_location from private.stockflow_customer_locations l
  where customer_id=customer),'denied moves and town downgrade leave full location unchanged');
 perform pg_temp.pm_assert((select count(*)=before_events from private.stockflow_customer_location_events
  where customer_id=customer),'denied writes leave no location events');
 foreach actor in array array['management','administrator'] loop
  perform pg_temp.pm_call(payload||jsonb_build_object('idempotencyKey','pin-move-allowed-'||actor,
   'expectedVersion',version_before,'latitude',case when actor='management' then '17.400000' else '17.500000' end),actor);
  perform pg_temp.pm_assert((select version=version_before+1 and latitude=
   case when actor='management' then 17.4 else 17.5 end from private.stockflow_customer_locations
   where customer_id=customer),'management and administrator move pin and increment version');
  version_before:=version_before+1;
 end loop;
 perform pg_temp.pm_call(jsonb_build_object('customerId',town_customer,'idempotencyKey','pin-move-town-first-001',
  'expectedVersion',null,'precision','town','town','Fixture Town','source','town'));
 perform pg_temp.pm_call(payload||jsonb_build_object('customerId',town_customer,
  'idempotencyKey','pin-move-town-upgrade','expectedVersion',1));
 perform pg_temp.pm_assert((select precision='pin' and version=2 and latitude=17.3
  from private.stockflow_customer_locations where customer_id=town_customer),'sales upgrades town to first pin');
 raise notice 'PASS pin placement, protected moves and downgrade, management versioning, town upgrade';
end $checks$;
rollback;
