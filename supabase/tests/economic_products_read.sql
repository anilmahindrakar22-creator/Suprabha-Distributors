-- Disposable replay only; fixtures and gateway key roll back.
begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

create function pg_temp.products_assert(ok boolean,label text) returns void language plpgsql as $$
begin
 if ok is distinct from true then raise exception 'Economics products read: %',label; end if;
end $$;
create function pg_temp.products_constraints(relation regclass) returns void language plpgsql as $$
declare c record;
begin
 for c in select conname,pg_get_constraintdef(oid) definition from pg_constraint where conrelid=relation order by conname loop
  raise notice 'Fixture constraint %.%: %',relation,c.conname,c.definition;
 end loop;
end $$;
create function pg_temp.products_call(payload jsonb default '{}'::jsonb) returns jsonb language sql as $$
 select public.stockflow_economics_gateway('products-key','products-manager@test.local','get_economic_products',payload)
$$;

update private.stockflow_gateway_config
 set secret_sha256=encode(extensions.digest('products-key','sha256'),'hex') where name='orders';
select pg_temp.products_constraints('public.stockflow_members');
-- Unique normalized emails; allowed role/roles; active status.
insert into public.stockflow_members(email,role,roles,status) values
 ('products-manager@test.local','management',array['management'],'active'),
 ('products-admin@test.local','administrator',array['administrator'],'active'),
 ('products-accounts@test.local','accounts',array['accounts'],'active'),
 ('products-sales@test.local','sales',array['sales'],'active'),
 ('products-ops@test.local','operations',array['operations'],'active');

do $test$
declare
 company_a text:='products-a-'||extensions.gen_random_uuid()::text;
 company_b text:='products-b-'||extensions.gen_random_uuid()::text;
 fixture record; voucher uuid; result jsonb; expected jsonb; companies jsonb; payload jsonb;
 walked jsonb:='[]'; actor text; db_role text; signature text; i integer;
begin
 raise notice 'Economics products read phase: constraint-checked fixtures';
 for fixture in select * from (values
  (company_a,'old',0,false,'2026-12-19'::date,'speed-p1','Old name'),
  (company_a,'new',0,false,'2026-12-20'::date,'speed-p1','New name'),
  (company_a,'cancelled',0,true,'2026-12-21'::date,'speed-p2','Cancelled'),
  (company_a,'revision',0,false,'2026-12-21'::date,'speed-p3','Stale'),
  (company_a,'revision',1,false,'2026-12-21'::date,'speed-p3','Current'),
  (company_b,'other',0,false,'2026-12-20'::date,'speed-p1','B name')
 ) f(company,source_id,revision,cancelled,business_date,product_id,label) loop
  perform pg_temp.products_constraints('private.stockflow_economic_source_vouchers');
  -- Unique company/source/revision; revision 0/1 >=0; sale enum; INR default; required date/evidence.
  insert into private.stockflow_economic_source_vouchers
   (company_id,source_id,source_revision,business_date,kind,cancelled,evidence)
  values(fixture.company,fixture.source_id,fixture.revision,fixture.business_date,'sale',fixture.cancelled,'{}') returning id into voucher;
  perform pg_temp.products_constraints('private.stockflow_economic_source_lines');
  -- Voucher FK; unique line_key 1; product 1..240; unit pack 1..80; numeric quantity/net; required evidence.
  insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
  values(voucher,'1',fixture.product_id,1,'pack',100,jsonb_build_object('label',fixture.label));
 end loop;

 raise notice 'Economics products read phase: latest names and sourceLines parity';
 result:=pg_temp.products_call(jsonb_build_object('companyId',company_a));
 perform pg_temp.products_assert(result->>'total'='2' and result->>'limit'='200' and result->>'offset'='0','company scope and defaults');
 perform pg_temp.products_assert(result->'rows'=jsonb_build_array(
  jsonb_build_object('companyId',company_a,'productId','speed-p3','productName','Current','lastDate','2026-12-21'),
  jsonb_build_object('companyId',company_a,'productId','speed-p1','productName','New name','lastDate','2026-12-20')),'latest names, dates, cancelled and superseded excluded');
 result:=pg_temp.products_call(jsonb_build_object('companyId',company_b));
 perform pg_temp.products_assert(result->>'total'='1' and result#>>'{rows,0,productName}'='B name','same product separate company');
 select jsonb_agg(pair order by pair::text) into expected from (
  select distinct jsonb_build_array(x->>'companyId',x->>'productId') pair
  from jsonb_array_elements(private.stockflow_economic_workspace_read('{management}',false)->'sourceLines') x
  where x->>'companyId'=company_a) pairs;
 result:=pg_temp.products_call(jsonb_build_object('companyId',company_a));
 perform pg_temp.products_assert(expected=(select jsonb_agg(jsonb_build_array(x->>'companyId',x->>'productId') order by jsonb_build_array(x->>'companyId',x->>'productId')::text) from jsonb_array_elements(result->'rows') x),'sourceLines pair parity');
 companies:=result->'companies';
 perform pg_temp.products_assert(companies @> jsonb_build_array(company_a,company_b),'both fixture companies');
 select jsonb_agg(x order by (x#>>'{}') collate "C") into expected from jsonb_array_elements(companies) x;
 perform pg_temp.products_assert(companies=expected and jsonb_array_length(companies)=(select count(distinct x) from jsonb_array_elements(companies) x),'distinct companies C order');

 raise notice 'Economics products read phase: filters and global companies';
 for fixture in select * from (values
  ('{"q":"new"}'::jsonb,1),('{"q":"p1 new"}',1),('{"q":"p1 zzq"}',0),
  ('{"q":"old"}',0),('{"q":"stale"}',0),('{"q":"%"}',0),('{"q":"_"}',0)
 ) f(filter,total) loop
  result:=pg_temp.products_call(fixture.filter||jsonb_build_object('companyId',company_a));
  perform pg_temp.products_assert((result->>'total')::integer=fixture.total and result->'companies'=companies,'filter '||fixture.filter::text);
  if fixture.total=1 then
   perform pg_temp.products_assert(result#>>'{rows,0,productId}'='speed-p1' and result#>>'{rows,0,companyId}'=company_a,'matching pair');
  end if;
 end loop;
 result:=pg_temp.products_call('{"productIds":["speed-p1"]}');
 perform pg_temp.products_assert(result->>'total'='2' and jsonb_array_length(result->'rows')=2
  and result#>>'{rows,0,companyId}'=company_b and result#>>'{rows,1,companyId}'=company_a and result->'companies'=companies,'productIds both companies');

 raise notice 'Economics products read phase: deterministic paging';
 for i in 0..1 loop
  result:=pg_temp.products_call(jsonb_build_object('companyId',company_a,'limit',1,'offset',i));
  perform pg_temp.products_assert(result->>'total'='2' and result->>'limit'='1' and (result->>'offset')::integer=i and jsonb_array_length(result->'rows')=1 and result->'companies'=companies,'page metadata');
  walked:=walked||(result->'rows');
 end loop;
 result:=pg_temp.products_call(jsonb_build_object('companyId',company_a));
 perform pg_temp.products_assert(walked=result->'rows','documented order each pair once');
 result:=pg_temp.products_call(jsonb_build_object('companyId',company_a,'offset',2));
 perform pg_temp.products_assert(result->'rows'='[]'::jsonb and result->>'total'='2' and result->'companies'=companies,'empty final page');

 raise notice 'Economics products read phase: payload validation';
 for payload in select x from (values
  ('{"unknown":1}'::jsonb),('{"q":""}'),('{"q":"one two three four five six seven"}'),
  ('{"productIds":[]}'),(jsonb_build_object('productIds',to_jsonb(array_fill('speed-p1'::text,array[201])))),
  ('{"limit":0}'),('{"limit":501}'),('{"offset":-1}'),('{"offset":100001}'),
  ('{"limit":1.5}'),('{"limit":"1"}'),('{"offset":null}'),('[]'),('null'),
  ('{"companyId":" "}'),('{"companyId":null}'),('{"companyId":1}'),(jsonb_build_object('companyId',repeat('x',241))),
  ('{"q":null}'),('{"q":1}'),(jsonb_build_object('q',repeat('x',81))),
  ('{"productIds":null}'),('{"productIds":"x"}'),('{"productIds":[null]}'),('{"productIds":[1]}'),
  ('{"productIds":[""]}'),('{"productIds":[" "]}'),(jsonb_build_object('productIds',jsonb_build_array(repeat('x',241))))
 ) invalid(x) loop
  begin
   perform pg_temp.products_call(payload);
   raise exception 'Invalid products payload accepted: %',payload;
  exception when sqlstate '22023' then
   perform pg_temp.products_assert(sqlerrm='Invalid products payload','exact validation message');
  end;
 end loop;

 raise notice 'Economics products read phase: access and delegation';
 foreach actor in array array['manager','admin','accounts'] loop
  perform public.stockflow_economics_gateway('products-key','products-'||actor||'@test.local','get_economic_products','{}');
 end loop;
 foreach actor in array array['sales','ops'] loop
  begin
   perform public.stockflow_economics_gateway('products-key','products-'||actor||'@test.local','get_economic_products','{"unknown":1}');
   raise exception 'Restricted member accepted';
  exception when sqlstate '42501' then
   perform pg_temp.products_assert(sqlerrm='Economics evidence is restricted','role before validation');
  end;
 end loop;
 begin
  perform public.stockflow_economics_gateway('wrong-key','products-sales@test.local','get_economic_products','{"unknown":1}');
  raise exception 'Wrong key accepted';
 exception when sqlstate '42501' then
  perform pg_temp.products_assert(sqlerrm='Unauthorized gateway','key before role and validation');
 end;
 result:=public.stockflow_economics_gateway('products-key','products-manager@test.local','get_economic_source_lines',jsonb_build_object('companyId',company_a));
 perform pg_temp.products_assert(result->>'total'='3','source lines still routed');
 result:=public.stockflow_economics_gateway('products-key','products-manager@test.local','get_instrument_economics','{"view":"summary"}');
 perform pg_temp.products_assert(result->>'readView'='summary','summary still routed');

 raise notice 'Economics products read phase: settings and privileges';
 perform pg_temp.products_assert((select 'statement_timeout=20s'=any(proconfig) from pg_proc where oid='public.stockflow_economics_gateway(text,text,text,jsonb)'::regprocedure),'gateway timeout');
 foreach signature in array array['public.stockflow_economics_gateway(text,text,text,jsonb)','public.stockflow_economics_gateway_before_products(text,text,text,jsonb)'] loop
  foreach db_role in array array['anon','authenticated'] loop
   perform pg_temp.products_assert(not has_function_privilege(db_role,signature,'EXECUTE'),'gateway privilege '||signature||' '||db_role);
  end loop;
 end loop;
 foreach db_role in array array['anon','authenticated','service_role'] loop
  perform pg_temp.products_assert(not has_function_privilege(db_role,'private.stockflow_economic_products_read(jsonb)','EXECUTE'),'private privilege '||db_role);
 end loop;
 perform pg_temp.products_assert(has_function_privilege('service_role','public.stockflow_economics_gateway(text,text,text,jsonb)','EXECUTE'),'service gateway grant');
 raise notice 'Economics products read phase: complete (rollback follows)';
end $test$;
rollback;
