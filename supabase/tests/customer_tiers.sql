begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

create function pg_temp.ct_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Customer tiers assertion failed: %',label;end if;end $$;

insert into private.stockflow_gateway_config(name,secret_sha256)
values('orders',encode(extensions.digest('customer-tiers-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,roles,status) values
 ('customer-tiers-sales@test.local','sales',array['sales'],'active'),
 ('customer-tiers-other@test.local','sales',array['sales'],'active'),
 ('customer-tiers-ops@test.local','operations',array['operations'],'active');

do $checks$
declare
 ids uuid[]:='{}'; customer uuid; order_id uuid; n integer; actor text;
 bands text[]:=array['diamond','platinum','gold','silver','untiered','gold'];
 company text:='customer-tiers-'||extensions.gen_random_uuid()::text;
 m date; payload jsonb; bad jsonb; result jsonb; expected jsonb; role_name text;
begin
 select greatest(coalesce((max(month)+interval '1 month')::date,'2040-01-01'::date),'2040-01-01'::date)
 into m from private.stockflow_lab_tier_snapshots;
 for n in 1..8 loop
  actor:=case when n=2 then 'customer-tiers-other@test.local' else 'customer-tiers-sales@test.local' end;
  insert into private.stockflow_customers(name,created_by_email)
  values('Customer tiers fixture '||n,actor) returning id into customer;
  insert into private.stockflow_orders(customer_id,customer_name,created_by_email,updated_by_email,idempotency_key,archived_at)
  values(customer,'Customer tiers fixture '||n,actor,actor,company||'-order-'||n,
   case when n=8 then now() end) returning id into order_id;
  ids:=array_append(ids,order_id);
  if n<=6 or n=8 then
   insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
   values(company,'lab-'||n,customer,'fixture');
   insert into private.stockflow_lab_tier_snapshots(month,company_id,customer_source_id,tier,has_instrument,consumables_paise,computed_at)
   values(m,company,'lab-'||n,case when n=8 then 'diamond' else bands[n] end,false,123456789,now());
  end if;
  if n=6 then
   insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
   values(company||'-second','multi',customer,'fixture');
   insert into private.stockflow_lab_tier_snapshots values(m,company||'-second','multi','diamond',987654321,true,now());
  end if;
 end loop;
 -- A previous month and an unrelated company's identical source ID must not upgrade Silver.
 insert into private.stockflow_lab_tier_snapshots values
  ((m-interval '1 month')::date,company,'lab-4','diamond',999999999,true,now()),
  (m,company||'-decoy','lab-4','diamond',999999999,true,now());
 payload:=jsonb_build_object('orderIds',to_jsonb(ids));

 begin
  perform public.stockflow_customer_tier_gateway('bad','missing@test.local','wrong','[]');
  raise exception 'Accepted bad key';
 exception when sqlstate '42501' then
  perform pg_temp.ct_assert(sqlerrm='Unauthorized gateway','key checked first');
 end;
 begin
  perform public.stockflow_customer_tier_gateway('customer-tiers-key','missing@test.local','wrong','[]');
  raise exception 'Accepted wrong action';
 exception when sqlstate '22023' then
  perform pg_temp.ct_assert(sqlerrm='Invalid customer tiers action','action checked before member');
 end;
 begin
  perform public.stockflow_customer_tier_gateway('customer-tiers-key','missing@test.local','get_customer_tiers','[]');
  raise exception 'Accepted unknown member';
 exception when sqlstate '42501' then
  perform pg_temp.ct_assert(sqlerrm='Account is not approved','member checked before payload');
 end;
 raise notice 'PASS customer tiers key, action and member authorization';

 for bad in select x from (values
  ('{"orderIds":[]}'::jsonb),
  (jsonb_build_object('orderIds',(select jsonb_agg(extensions.gen_random_uuid()::text) from generate_series(1,101)))),
  ('{"orderIds":["not-a-uuid"]}'::jsonb),
  (jsonb_build_object('orderIds',jsonb_build_array(ids[1],ids[1]))),
  (payload||'{"extra":true}'::jsonb),
  ('[]'::jsonb),('null'::jsonb),(null::jsonb),('{}'::jsonb),
  ('{"orderIds":null}'::jsonb),('{"orderIds":{}}'::jsonb),
  ('{"orderIds":[1]}'::jsonb),('{"orderIds":[null]}'::jsonb),
  (jsonb_build_object('orderIds',jsonb_build_array(ids[1]::text,upper(ids[1]::text))))
 ) invalid(x) loop
  begin
   perform public.stockflow_customer_tier_gateway('customer-tiers-key','customer-tiers-sales@test.local','get_customer_tiers',bad);
   raise exception 'Accepted invalid payload %',bad;
  exception when sqlstate '22023' then
   perform pg_temp.ct_assert(sqlerrm='Invalid customer tiers request','payload error');
  end;
 end loop;
 perform public.stockflow_customer_tier_gateway('customer-tiers-key','customer-tiers-sales@test.local','get_customer_tiers',
  jsonb_build_object('orderIds',(select jsonb_agg(extensions.gen_random_uuid()::text) from generate_series(1,100))));
 raise notice 'PASS customer tiers payload validation and 100-ID boundary';

 result:=public.stockflow_customer_tier_gateway('customer-tiers-key',' CUSTOMER-TIERS-SALES@TEST.LOCAL ','get_customer_tiers',payload);
 expected:=jsonb_build_object(ids[1]::text,'diamond',ids[3]::text,'gold',ids[4]::text,'silver',ids[6]::text,'diamond');
 perform pg_temp.ct_assert(result=jsonb_build_object('month',to_char(m,'YYYY-MM-DD'),'tiers',expected),
  'Sales sees own readable orders; archived, untiered and unmatched omitted; highest identity wins');
 result:=public.stockflow_customer_tier_gateway('customer-tiers-key','customer-tiers-ops@test.local','get_customer_tiers',payload);
 expected:=expected||jsonb_build_object(ids[2]::text,'platinum');
 perform pg_temp.ct_assert(result=jsonb_build_object('month',to_char(m,'YYYY-MM-DD'),'tiers',expected),'Operations sees all readable orders');
 perform pg_temp.ct_assert((select array_agg(k order by k) from jsonb_object_keys(result) k)=array['month','tiers'],'exact top-level keys');
 -- The month is the sole digit-bearing string. UUIDs are object keys, never values.
 perform pg_temp.ct_assert(jsonb_typeof(result->'month')='string' and result->>'month'=to_char(m,'YYYY-MM-DD')
  and not jsonb_path_exists(result,'$.** ? (@.type() == "number")')
  and not exists(select 1 from jsonb_each(result->'tiers') t where jsonb_typeof(t.value)<>'string'
   or t.value #>> '{}' not in ('diamond','platinum','gold','silver') or t.value #>> '{}' ~ '[0-9]'),
  'only month and tier words as scalar values, no numeric values or internal IDs');
 result:=public.stockflow_customer_tier_gateway('customer-tiers-key','customer-tiers-sales@test.local','get_customer_tiers',
  jsonb_build_object('orderIds',jsonb_build_array(ids[2])));
 perform pg_temp.ct_assert(result->'tiers'='{}'::jsonb,'unreadable requested order yields empty object');
 result:=public.stockflow_customer_tier_gateway('customer-tiers-key','customer-tiers-ops@test.local','get_customer_tiers',
  jsonb_build_object('orderIds',jsonb_build_array(ids[3])));
 perform pg_temp.ct_assert(result->'tiers'=jsonb_build_object(ids[3]::text,'gold'),'only requested IDs returned');
 raise notice 'PASS customer tiers visibility, ranking, month and response privacy';

 foreach role_name in array array['anon','authenticated'] loop
  perform pg_temp.ct_assert(not has_function_privilege(role_name,'public.stockflow_customer_tier_gateway(text,text,text,jsonb)','execute'),'gateway ACL '||role_name);
 end loop;
 perform pg_temp.ct_assert(has_function_privilege('service_role','public.stockflow_customer_tier_gateway(text,text,text,jsonb)','execute'),'service role gateway ACL');
 delete from private.stockflow_lab_tier_snapshots;
 result:=public.stockflow_customer_tier_gateway('customer-tiers-key','customer-tiers-ops@test.local','get_customer_tiers',payload);
 perform pg_temp.ct_assert(result='{"month":null,"tiers":{}}'::jsonb,'no snapshots yields null month and empty tiers');
 raise notice 'PASS customer tiers ACL and empty snapshots';
end $checks$;
rollback;
