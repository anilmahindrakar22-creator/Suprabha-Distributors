begin;
set local statement_timeout='60s';

create function pg_temp.m_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Observed price changes: %',label; end if; end$$;

create temp table observed_run on commit drop as
with added as (
 insert into private.stockflow_company_gp_runs(company_id,source_watermark,status,completed_at)
 select 'observed-test-company',clock_timestamp(),'complete',
  greatest(clock_timestamp(),coalesce(max(completed_at),clock_timestamp()))+interval '1 day'
 from private.stockflow_company_gp_runs returning id
) select id from added;

create function pg_temp.observed_line(lab text,d date,rate bigint,qty numeric,
 line_status text default 'costed',line_kind text default 'sale') returns void language sql as $$
 insert into private.stockflow_company_gp_lines(run_id,source_line_id,business_date,customer_source_id,
  product_id,kind,quantity,revenue_paise,cost_paise,gp_paise,status)
 select id,gen_random_uuid(),d,lab,lab,line_kind,qty,(rate*qty)::bigint,
  case when line_status='costed' then (rate*qty/2)::bigint end,
  case when line_status='costed' then (rate*qty)::bigint-(rate*qty/2)::bigint end,line_status
 from pg_temp.observed_run;
$$;

-- Standard shape: three bills before June 1, three after; median lab gap 30 days => W=90.
-- At 10000 paise and qty 10: before qty=30, revenue=300000, GP=150000.
create function pg_temp.observed_shape(lab text,after_rate bigint default 11000,
 after_qty numeric default 10,changed date default '2026-06-01') returns void language plpgsql as $$
declare offset_days integer;
begin
 foreach offset_days in array array[-75,-45,-15] loop
  perform pg_temp.observed_line(lab,changed+offset_days,10000,10);
 end loop;
 foreach offset_days in array array[0,20,40] loop
  perform pg_temp.observed_line(lab,changed+offset_days,after_rate,after_qty);
 end loop;
end$$;

insert into private.stockflow_customers(id,name,tally_key,created_by_email)
select ('fa000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 'Test Lab '||chr(64+i),'observed-lab-'||chr(64+i),'fixture' from generate_series(1,11) i;
insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
select 'observed-test-company',chr(64+i),('fa000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 'fixture' from generate_series(1,11) i;
insert into private.stockflow_products(tally_item_key,name,item_group)
select 'Reagent '||chr(64+i),'Reagent '||chr(64+i),'Observed fixture' from generate_series(1,11) i;
insert into private.stockflow_economic_item_catalogs(company_id,source_version,observed_at,content)
values('observed-test-company','old','2026-01-01','{"products":[{"id":"A","name":"Old reagent"}]}');
insert into private.stockflow_economic_item_catalogs(company_id,source_version,observed_at,content)
select 'observed-test-company','latest','2026-02-01',
 jsonb_build_object('products',jsonb_agg(jsonb_build_object('id',chr(64+i),'name','Reagent '||chr(64+i))))
from generate_series(1,11) i;

-- 1: 10000 -> 11000 (+10%); qty 30 -> 15, revenue 300000 -> 165000, GP 150000 -> 82500.
select pg_temp.observed_shape('A',11000,5);
-- 2: same 10% increase, qty 30 -> 30 => held.
select pg_temp.observed_shape('B');
-- 3: one 11000 bill amongst 10000 bills: both window medians=10000 => excluded.
select pg_temp.observed_line('C',date '2026-06-01'+d,case when d=0 then 11000 else 10000 end,10)
from unnest(array[-75,-45,-15,0,20,40]) d;
-- 4: October 20 is only 30 days old on November 19, despite two after bills => excluded.
select pg_temp.observed_line('D',date '2026-10-20'+d,case when d<0 then 10000 else 11000 end,10)
from unnest(array[-75,-45,-15,0,5,10]) d;
-- 5: approved June 10 is nine days from the observed change => excluded.
select pg_temp.observed_shape('E');
insert into private.stockflow_customer_product_prices(customer_id,tally_item_key,price_amount,valid_from,
 status,source_type,reason,created_by_email,approved_by_email,approved_at)
values('fa000000-0000-4000-8000-000000000005','Reagent E',110,'2026-06-10',
 'approved','customer_contract','Observed fixture','fixture','fixture','2026-06-10');
-- 6: distinct bill dates are 60 days apart => W=180, L=min(180,171)=171.
-- Before includes -120,-60 (qty20); after includes 0,60,120 (qty30) => rose.
select pg_temp.observed_line('F',date '2026-06-01'+d,case when d<0 then 10000 else 11000 end,10)
from unnest(array[-180,-120,-60,0,60,120]) d;
-- 7: 10000 -> 30000 is a unit switch, not a listed change; unitChanges=1.
select pg_temp.observed_shape('G',30000);
-- 8: sales qty30 less return qty6 = afterQty24 => fell; sales revenue stays330000.
select pg_temp.observed_shape('H');
select pg_temp.observed_line('H','2026-06-25',11000,-6,'cost_unavailable','return');
-- 9: after costed revenue220000 / total330000 = 2/3 < 80% => null after GP.
select pg_temp.observed_line('I',date '2026-06-01'+d,case when d<0 then 10000 else 11000 end,10,
 case when d=40 then 'cost_unavailable' else 'costed' end)
from unnest(array[-75,-45,-15,0,20,40]) d;
-- Additional decrease: -10%, qty30 -> 30 held; rise: +10%, qty30 -> 36 rose.
select pg_temp.observed_shape('J',9000);
select pg_temp.observed_shape('K',11000,12);

insert into private.stockflow_gateway_config(name,secret_sha256)
values('orders',encode(extensions.digest('observed-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,roles,status)
select 'observed-'||r||'@test.local',r,array[r],'active'
from unnest(array['administrator','management','accounts','operations']) r;
do $$declare target record; patched integer:=0; begin
 for target in
  select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname like 'stockflow_pricing_gateway%'
   and p.prosrc like '%private.stockflow_observed_price_changes(%'
 loop
  execute replace(pg_get_functiondef(target.oid), '(now() at time zone ''Asia/Kolkata'')::date', '''2026-11-19''::date');
  patched:=patched+1;
 end loop;
 perform pg_temp.m_assert(patched=1,'one observed price changes gateway patched');
end$$;

do $tests$
declare r jsonb; row jsonb; filtered jsonb; payload jsonb; role_name text;
begin
 r:=private.stockflow_observed_price_changes('2026-11-19',1,null,null);
 -- Listed A,B,F,H,I,J,K: seven labs, six increases (2 fell,2 held,2 rose), one decrease.
 perform pg_temp.m_assert(r->'summary'='{"changes":7,"increases":6,"decreases":1,"increasesFell":2,"increasesHeld":2,"increasesRose":2,"labs":7,"unitChanges":1}'::jsonb,'global summary');
 perform pg_temp.m_assert(r->>'view'='observed_changes' and r->>'asOf'='2026-11-19'
  and r->>'salesThrough'='2026-10-30' and r->>'page'='1' and r->>'pageSize'='10'
  and r->>'total'='7' and jsonb_array_length(r->'rows')=7,'metadata and total');
 select x into row from jsonb_array_elements(r->'rows') x where x->>'itemKey'='Reagent A';
 perform pg_temp.m_assert(row='{"customerName":"Test Lab A","itemKey":"Reagent A","changedOn":"2026-06-01","windowDays":90,"direction":"up","volume":"fell","beforeRatePaise":10000,"afterRatePaise":11000,"changePct":10.0,"beforeQty":30,"afterQty":15,"beforeRevenuePaise":300000,"afterRevenuePaise":165000,"beforeGpPaise":150000,"afterGpPaise":82500}'::jsonb,'1 exact increase and volume fall');
 perform pg_temp.m_assert(r->'rows'->0->>'itemKey'='Reagent A' and r->'rows'->1->>'itemKey'='Reagent H','priority and name ordering');
 perform pg_temp.m_assert(exists(select 1 from jsonb_array_elements(r->'rows') x
  where x->>'itemKey'='Reagent B' and x->>'volume'='held' and x->>'afterQty'='30'),'2 held');
 perform pg_temp.m_assert(not exists(select 1 from jsonb_array_elements(r->'rows') x
  where x->>'itemKey' in ('Reagent C','Reagent D','Reagent E','Reagent G')),'3/4/5/7 exclusions');
 perform pg_temp.m_assert(exists(select 1 from jsonb_array_elements(r->'rows') x where x->>'itemKey'='Reagent F'
  and x->>'windowDays'='171' and x->>'beforeQty'='20' and x->>'afterQty'='30'),'6 slow lab');
 perform pg_temp.m_assert(exists(select 1 from jsonb_array_elements(r->'rows') x where x->>'itemKey'='Reagent H'
  and x->>'afterQty'='24' and x->>'afterRevenuePaise'='330000' and x->>'afterGpPaise'='165000'),'8 net return');
 perform pg_temp.m_assert(exists(select 1 from jsonb_array_elements(r->'rows') x where x->>'itemKey'='Reagent I'
  and x->'afterGpPaise'='null'::jsonb and x->>'beforeGpPaise'='150000'),'9 coverage null');
 -- 10: down => J only; fell => A,H only; combining down+fell => empty. Summary unchanged.
 filtered:=private.stockflow_observed_price_changes('2026-11-19',1,'down',null);
 perform pg_temp.m_assert(filtered->>'total'='1' and jsonb_array_length(filtered->'rows')=1
  and filtered->'rows'->0->>'itemKey'='Reagent J' and filtered->'summary'=r->'summary','10 direction filter');
 filtered:=private.stockflow_observed_price_changes('2026-11-19',1,null,'fell');
 perform pg_temp.m_assert(filtered->>'total'='2' and jsonb_array_length(filtered->'rows')=2
  and filtered->'summary'=r->'summary','10 volume filter');
 filtered:=private.stockflow_observed_price_changes('2026-11-19',1,'down','fell');
 perform pg_temp.m_assert(filtered->>'total'='0' and filtered->'rows'='[]'::jsonb
  and filtered->'summary'=r->'summary','10 combined filter');
 perform pg_temp.m_assert(private.stockflow_observed_price_changes('2026-11-19',2,null,null)->'rows'='[]'::jsonb,'empty page');
 begin perform private.stockflow_observed_price_changes('2026-11-19',1,'bad',null);
  raise exception 'Invalid direction accepted'; exception when sqlstate '22023' then null; end;
 begin perform private.stockflow_observed_price_changes('2026-11-19',101,null,null);
  raise exception 'Invalid page accepted'; exception when sqlstate '22023' then null; end;
 begin perform private.stockflow_observed_price_changes('2026-11-19',1,null,'bad');
  raise exception 'Invalid volume accepted'; exception when sqlstate '22023' then null; end;
 -- 11: roles, key, strict payload, successful dispatch and unchanged previous-view delegation.
 foreach role_name in array array['accounts','operations'] loop
  begin perform public.stockflow_pricing_gateway('observed-key','observed-'||role_name||'@test.local',
   'get_order_pricing','{"view":"observed_changes","page":1}');
   raise exception 'Restricted role accepted'; exception when sqlstate '42501' then null; end;
 end loop;
 foreach role_name in array array['administrator','management'] loop
  perform pg_temp.m_assert(public.stockflow_pricing_gateway('observed-key','observed-'||role_name||'@test.local',
   'get_order_pricing','{"view":"observed_changes","page":1}')=r,'11 allowed role');
 end loop;
 begin perform public.stockflow_pricing_gateway('bad-key','observed-management@test.local',
  'get_order_pricing','{"view":"observed_changes","page":1}');
  raise exception 'Bad key accepted'; exception when sqlstate '42501' then null; end;
 for payload in select x from jsonb_array_elements('[{"view":"observed_changes","page":1,"extra":true},
  {"view":"observed_changes","page":"1"},{"view":"observed_changes","page":101},
  {"view":"observed_changes","page":0},{"view":"observed_changes","page":1.5},
  {"view":"observed_changes","page":1000000},{"view":"observed_changes","page":1,"direction":null},
  {"view":"observed_changes","page":1,"direction":"bad"},{"view":"observed_changes","page":1,"volume":"bad"},
  {"view":"observed_changes","page":1,"volume":null}]') x loop
  begin perform public.stockflow_pricing_gateway('observed-key','observed-management@test.local','get_order_pricing',payload);
   raise exception 'Invalid payload accepted: %',payload; exception when sqlstate '22023' then null; end;
 end loop;
 perform pg_temp.m_assert(public.stockflow_pricing_gateway('observed-key','observed-accounts@test.local',
  'get_order_pricing','{"view":"price_outcomes","page":1}')=
  public.stockflow_pricing_gateway_before_observed_changes('observed-key','observed-accounts@test.local',
  'get_order_pricing','{"view":"price_outcomes","page":1}'),'11 prior view delegation');
 -- 12: neither API role can bypass gateway checks, including through the renamed wrapper.
 foreach role_name in array array['anon','authenticated','service_role'] loop
  perform pg_temp.m_assert(not has_function_privilege(role_name,
   'private.stockflow_observed_price_changes(date,integer,text,text)','execute'),'12 private ACL');
  perform pg_temp.m_assert(not has_function_privilege(role_name,
   'public.stockflow_pricing_gateway_before_observed_changes(text,text,text,jsonb)','execute'),'12 wrapped ACL');
 end loop;
end$tests$;
rollback;
