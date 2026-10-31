-- All assertions use only these transaction-local fixtures.
begin;
set local timezone='UTC';
insert into private.stockflow_gateway_config(name,secret_sha256)
values('orders',encode(extensions.digest('checkin-fixture-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,status)
select 'checkin-'||r||'@test.local',case when r in ('owner','other','inactive') then 'sales' else r end,
  case when r='inactive' then 'suspended' else 'active' end
from unnest(array['administrator','management','owner','other','operations','billing','inactive']) r;

create function pg_temp.k_id(n int) returns uuid language sql immutable as $$
 select ('c11ec11e-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
insert into private.stockflow_customers(id,name,created_by_email)
select pg_temp.k_id(n),'GPS fixture '||n,'checkin-owner@test.local' from generate_series(1,4) n;
insert into private.stockflow_customer_locations(customer_id,precision,latitude,longitude,source,verified_by)
values(pg_temp.k_id(1),'pin',17,76,'manual_pin','checkin-owner@test.local');

create function pg_temp.k_call(action text,payload jsonb,actor text default 'owner') returns jsonb language sql as $$
 select public.stockflow_accounts_gateway('checkin-fixture-key','checkin-'||actor||'@test.local',action,payload)
$$;
create function pg_temp.k_payload(request text,customer int default 1,lat numeric default 17,lng numeric default 76,accuracy int default 100)
returns jsonb language sql as $$
 select jsonb_build_object('customerId',pg_temp.k_id(customer),'latitude',lat,'longitude',lng,'accuracyM',accuracy,'requestId',request)
$$;
create function pg_temp.k_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.k_error(payload jsonb,expected text,actor text default 'owner') returns void language plpgsql as $$
begin
 begin perform pg_temp.k_call('check_in',payload,actor);
 exception when others then if sqlstate=expected then return;end if;raise;end;
 raise exception 'Expected SQLSTATE %',expected;
end$$;
create function pg_temp.k_visit(request text,customer int default 3,actor text default 'owner') returns jsonb language sql as $$
 select pg_temp.k_call('log_visit',jsonb_build_object('customerId',pg_temp.k_id(customer),
  'visitedOn',(now() at time zone 'Asia/Kolkata')::date,'outcome','met','idempotencyKey',request),actor)
$$;

do $checks$
declare response jsonb; replay jsonb; row_data jsonb; sheet jsonb; visit uuid; latest uuid; today date:=(now() at time zone 'Asia/Kolkata')::date;
begin
 perform pg_temp.k_error(pg_temp.k_payload('k1-verified')||'{"verified":true}', '22023');
 perform pg_temp.k_error(pg_temp.k_payload('k1-verified-null')||'{"verified":null}', '22023');
 perform pg_temp.k_error(pg_temp.k_payload('k1-distance')||'{"distanceM":0}', '22023');
 perform pg_temp.k_error(pg_temp.k_payload('k1-distance-null')||'{"distanceM":null}', '22023');
 response:=pg_temp.k_call('check_in',pg_temp.k_payload('k1-server'));
 perform pg_temp.k_assert(response->>'verified'='true' and response->>'distanceM'='0','server computes verified');
 raise notice 'K1 PASS: verified and distanceM keys rejected with 22023; verification is server computed';

 -- Earth radius 6371000 m: due-north offsets rounded to six decimals.
 -- 0.001349 degrees = 150.002 m; 0.001358 = 151.003 m; 0.000090 = 10.008 m.
 response:=pg_temp.k_call('check_in',pg_temp.k_payload('k2-150',1,17.001349,76,100));
 perform pg_temp.k_assert(response->>'distanceM'='150' and response->>'verified'='true','150 m / 100 m accuracy');
 response:=pg_temp.k_call('check_in',pg_temp.k_payload('k2-151',1,17.001358,76,100));
 perform pg_temp.k_assert(response->>'distanceM'='151' and response->>'verified'='false','151 m');
 response:=pg_temp.k_call('check_in',pg_temp.k_payload('k2-accuracy',1,17.000090,76,101));
 perform pg_temp.k_assert(response->>'distanceM'='10' and response->>'verified'='false','10 m / 101 m accuracy');
 raise notice 'K2 PASS: 150 m / accuracy 100 verified; 151 m and accuracy 101 at 10 m unverified';

 response:=pg_temp.k_call('check_in',pg_temp.k_payload('k3-no-pin',2));
 perform pg_temp.k_assert(response->'distanceM'='null'::jsonb and response->>'verified'='false' and response->>'hasPin'='false','no pin response');
 perform pg_temp.k_assert(exists(select 1 from private.stockflow_visit_checkins where id=(response->>'checkinId')::uuid and distance_m is null and not verified),'no pin stored');
 raise notice 'K3 PASS: no pin gives null distance, unverified, hasPin false';

 perform pg_temp.k_error(pg_temp.k_payload('k4-south',1,15.399999,76),'22023');
 perform pg_temp.k_error(pg_temp.k_payload('k4-north',1,18.600001,76),'22023');
 perform pg_temp.k_error(pg_temp.k_payload('k4-west',1,17,74.999999),'22023');
 perform pg_temp.k_error(pg_temp.k_payload('k4-east',1,17,77.900001),'22023');
 raise notice 'K4 PASS: all four market boundaries reject outside coordinates with 22023';

 response:=pg_temp.k_call('check_in',pg_temp.k_payload('k5-retry'));
 update private.stockflow_customer_locations set latitude=18 where customer_id=pg_temp.k_id(1);
 replay:=pg_temp.k_call('check_in',pg_temp.k_payload('k5-retry',2,17.1,76.1,5000));
 perform pg_temp.k_assert(response=replay,'retry returns first result after pin and payload changes');
 perform pg_temp.k_assert((select count(*)=1 from private.stockflow_visit_checkins where checked_in_by='checkin-owner@test.local' and request_id='k5-retry'),'one retry row');
 perform pg_temp.k_call('check_in',pg_temp.k_payload('k5-retry',2),'other');
 perform pg_temp.k_assert((select count(*)=2 from private.stockflow_visit_checkins where request_id='k5-retry'),'request is scoped to user');
 raise notice 'K5 PASS: identical first response and one row per user/request despite changed pin and payload';

 perform pg_temp.k_call('check_in',pg_temp.k_payload('k6-old',3));
 perform pg_temp.k_call('check_in',pg_temp.k_payload('k6-earlier',3));
 response:=pg_temp.k_call('check_in',pg_temp.k_payload('k6-latest',3)); latest:=(response->>'checkinId')::uuid;
 perform pg_temp.k_call('check_in',pg_temp.k_payload('k6-other',3),'other');
 perform pg_temp.k_call('check_in',pg_temp.k_payload('k6-customer',4));
 update private.stockflow_visit_checkins set checked_in_at=case request_id
  when 'k6-old' then (today-1+time '23:59') at time zone 'Asia/Kolkata'
  when 'k6-earlier' then (today+time '00:01') at time zone 'Asia/Kolkata'
  when 'k6-latest' then (today+time '00:05') at time zone 'Asia/Kolkata'
  else (today+time '00:10') at time zone 'Asia/Kolkata' end
 where request_id like 'k6-%';
 visit:=(pg_temp.k_visit('checkin-visit-k6-first')->>'visitId')::uuid;
 perform pg_temp.k_assert((select visit_id=visit from private.stockflow_visit_checkins where id=latest),'latest owner check-in linked across UTC midnight');
 perform pg_temp.k_assert((select count(*)=1 from private.stockflow_visit_checkins where visit_id=visit),'only one linked');
 perform pg_temp.k_assert(not exists(select 1 from private.stockflow_visit_checkins where request_id in ('k6-old','k6-earlier','k6-other','k6-customer') and visit_id is not null),'others remain unlinked');
 replay:=pg_temp.k_visit('checkin-visit-k6-first');
 perform pg_temp.k_assert((replay->>'visitId')::uuid=visit and (select visit_id is null from private.stockflow_visit_checkins where request_id='k6-earlier'),'visit retry does not link another check-in');
 -- A second visit consumes only the remaining same-day owner check-in.
 perform pg_temp.k_visit('checkin-visit-k6-second');
 perform pg_temp.k_assert((select visit_id is not null from private.stockflow_visit_checkins where request_id='k6-earlier'),'latest remaining unlinked');
 perform pg_temp.k_assert(not exists(select 1 from private.stockflow_visit_checkins where request_id in ('k6-old','k6-other','k6-customer') and visit_id is not null),'previous day/user/customer excluded');
 raise notice 'K6 PASS: same Kolkata day and actor links only latest unlinked; retry, other user/day/customer excluded';

 perform pg_temp.k_call('check_in',pg_temp.k_payload('k7-sales',3));
 perform pg_temp.k_call('check_in',pg_temp.k_payload('k7-operations',3),'operations');
 perform pg_temp.k_error(pg_temp.k_payload('k7-denied'),'PT403','billing');
 perform pg_temp.k_error(pg_temp.k_payload('k7-inactive'),'PT403','inactive');
 perform pg_temp.k_error(pg_temp.k_payload('k7-missing'),'PT403','missing');
 -- Use the gateway's latest ordering without mutating immutable visit rows.
 select id into visit from private.stockflow_customer_visits where customer_id=pg_temp.k_id(3)
  order by visited_on desc,created_at desc,id desc limit 1;
 update private.stockflow_visit_checkins set visit_id=null where customer_id=pg_temp.k_id(3) and id<>latest;
 update private.stockflow_visit_checkins set visit_id=visit where id=latest;
 for row_data in select to_jsonb(r) from unnest(array['owner','other','administrator','management','operations']) r loop
  response:=pg_temp.k_call('get_accounts',jsonb_build_object('search','GPS fixture 3'),row_data#>>'{}');
  select value#>'{lastVisit,checkin}' into replay from jsonb_array_elements(response->'accounts') where value->>'id'=pg_temp.k_id(3)::text;
  sheet:=public.stockflow_customer_map_gateway('checkin-fixture-key','checkin-'||(row_data#>>'{}')||'@test.local','get_customer_sheet',jsonb_build_object('customerId',pg_temp.k_id(3)));
  perform pg_temp.k_assert(replay=sheet#>'{tiles,lastVisit,checkin}','Accounts and sheet expose the same check-in');
  perform pg_temp.k_assert(replay ?& array['verified','distanceM','checkedInAt'],'summary for every admitted role');
  perform pg_temp.k_assert((replay ? 'latitude')=((row_data#>>'{}') in ('owner','administrator','management'))
   and (replay ? 'longitude')=((row_data#>>'{}') in ('owner','administrator','management')),'coordinate privacy');
 end loop;
 response:=pg_temp.k_call('check_in',pg_temp.k_payload('k7-response'));
 perform pg_temp.k_assert(not (response ?| array['latitude','longitude'])
  and response ?& array['checkinId','checkedInAt','verified','distanceM','hasPin']
  and (select count(*)=5 from jsonb_object_keys(response)),'write response contains only the five result fields');
 perform pg_temp.k_assert((select relrowsecurity from pg_class where oid='private.stockflow_visit_checkins'::regclass)
  and not exists(select 1 from pg_policy where polrelid='private.stockflow_visit_checkins'::regclass),'RLS without policies');
 perform pg_temp.k_assert(not has_table_privilege('authenticated','private.stockflow_visit_checkins','SELECT')
  and not has_table_privilege('anon','private.stockflow_visit_checkins','SELECT')
  and not has_function_privilege('service_role','private.stockflow_check_in(text,jsonb)','EXECUTE')
  and not has_function_privilege('service_role','private.stockflow_visit_checkin_read(uuid,text,text[])','EXECUTE'),'private access only via gateways');
 raise notice 'K7 PASS: sales/operations admitted; disallowed/inactive PT403; owner/admin/management coordinates only; write never echoes coordinates';
end $checks$;
rollback;
