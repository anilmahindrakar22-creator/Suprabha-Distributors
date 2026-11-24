begin;
set local statement_timeout='300s';

create function pg_temp.gp_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Growth period assertion failed: %',label;end if;end$$;
create function pg_temp.gp_voucher(src text,lab text,d date,net bigint,kind text default 'sale',
 revision integer default 1,cancelled boolean default false,company text default 'gp-co') returns void language plpgsql as $$
declare voucher uuid;
begin
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,kind,cancelled,evidence)
 values(company,src,revision,d,lab,kind,cancelled,'{}') returning id into voucher;
 insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
 values(voucher,'1','gp-item',case when net<0 then -1 else 1 end,'pack',net,'{}');
end$$;
create function pg_temp.gp_call(payload jsonb,actor text default 'management',key text default 'growth-period-key') returns jsonb language sql as $$
 select public.stockflow_growth_gateway(key,'gp-'||actor||'@test.local','get_growth_period',payload)
$$;
insert into private.stockflow_gateway_config(name,secret_sha256)
values('orders',encode(extensions.digest('growth-period-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,roles,status)
select 'gp-'||r||'@test.local',r,array[r],'active'
from unnest(array['administrator','management','sales','operations','accounts','warehouse']) r;

do $periods$
declare p jsonb; args jsonb;
begin
 p:=private.stockflow_growth_period('2027-03-31','fy',2026,null);
 perform pg_temp.gp_assert(p->>'to'='2027-03-31' and p->'running'='false','FY end');
 perform pg_temp.gp_assert(private.stockflow_growth_period('2027-04-01','fy',2027,null)->>'from'='2027-04-01','FY rollover');
 p:=private.stockflow_growth_period('2026-11-22','quarter',2026,3);
 perform pg_temp.gp_assert(p->>'from'='2026-10-01' and p->>'to'='2026-11-22' and p->'running'='true'
  and p->>'label'='Q3 FY 2026-27 to 22 Nov','running quarter');
 perform pg_temp.gp_assert(p->'comparisons'='[{"key":"last_year","label":"Q3 FY 2025-26 (same days)","from":"2025-10-01","to":"2025-11-22"},{"key":"previous","label":"Q2 FY 2026-27 (same days)","from":"2026-07-01","to":"2026-08-22"}]','same days');
 p:=private.stockflow_growth_period('2027-03-31','quarter',2026,4);
 perform pg_temp.gp_assert(p#>>'{comparisons,1,from}'='2026-10-01' and p#>>'{comparisons,1,to}'='2026-12-29','90 day quarter');
 p:=private.stockflow_growth_period('2027-04-01','quarter',2027,1);
 perform pg_temp.gp_assert(p#>>'{comparisons,1,label}'='Q4 FY 2026-27 (same days)' and p#>>'{comparisons,1,from}'='2027-01-01','previous FY quarter');
 p:=private.stockflow_growth_period('2028-03-31','quarter',2027,4);
 perform pg_temp.gp_assert(p#>>'{comparisons,0,from}'='2027-01-01' and p#>>'{comparisons,0,to}'='2027-03-31','leap cap');
 for args in select value from jsonb_array_elements('[{"kind":"fy","fy":2027},{"kind":"h1","fy":2026},{"kind":"fy","fy":2026,"quarter":1},{"kind":"quarter","fy":2026},{"kind":"fy","fy":2016},{"kind":"quarter","fy":2026,"quarter":4}]') loop
  begin perform private.stockflow_growth_period('2026-11-22',args->>'kind',(args->>'fy')::int,(args->>'quarter')::int);
   raise exception 'Accepted invalid period %',args;
  exception when sqlstate '22023' then perform pg_temp.gp_assert(sqlerrm='Invalid growth period','validation message');end;
 end loop;
 begin perform private.stockflow_growth_period('2027-03-31','fy',2027,null);raise exception 'Accepted future FY';
 exception when sqlstate '22023' then null;end;
end$periods$;

do $fixture$
begin
 perform pg_temp.gp_voucher('first','history','2026-05-01',1);
 perform pg_temp.gp_voucher('grew-prev','grew','2026-07-10',100);
 perform pg_temp.gp_voucher('grew-cur','grew','2026-10-10',200);
 perform pg_temp.gp_voucher('grew-return','grew','2026-10-11',-50,'return');
 perform pg_temp.gp_voucher('fell-prev','fell','2026-07-10',300);
 perform pg_temp.gp_voucher('fell-cur','fell','2026-10-10',100);
 perform pg_temp.gp_voucher('same-prev','same','2026-07-10',50);
 perform pg_temp.gp_voucher('same-cur','same','2026-10-10',50);
 perform pg_temp.gp_voucher('stopped-jul','stopped','2026-07-10',100);
 perform pg_temp.gp_voucher('stopped-aug','stopped','2026-08-10',100);
 perform pg_temp.gp_voucher('stopped-sep','stopped','2026-09-10',100);
 perform pg_temp.gp_voucher('stopped-cur','stopped','2026-10-10',-20,'credit');
 perform pg_temp.gp_voucher('new-cur','new','2026-10-10',400);
 perform pg_temp.gp_voucher('other-prev','other','2026-07-10',-30,'credit');
 perform pg_temp.gp_voucher('other-cur','other','2026-10-10',-10,'credit');
 perform pg_temp.gp_voucher('bulk','bulk','2026-10-10',20000000);
 perform pg_temp.gp_voucher('below','below','2026-10-10',19999999);
 perform pg_temp.gp_voucher('null-prev',null,'2026-07-10',70);
 perform pg_temp.gp_voucher('null-cur',null,'2026-10-10',90);
 perform pg_temp.gp_voucher('revision','revision','2026-07-10',9000);
 perform pg_temp.gp_voucher('revision','revision','2026-10-10',250,revision=>2);
 perform pg_temp.gp_voucher('cancel','cancel','2026-10-10',9000,cancelled=>true);
 perform pg_temp.gp_voucher('void','cancel','2026-07-10',9000);
 perform pg_temp.gp_voucher('void','cancel','2026-10-10',9000,revision=>2,cancelled=>true);
 perform pg_temp.gp_voucher('moved','moved','2026-10-10',9000);
 perform pg_temp.gp_voucher('moved','moved','2027-01-10',9000,revision=>2);
end$fixture$;


-- Cost evidence precedes both periods. Catalog/product/price evidence makes
-- detail, brand lines and billed-below parity nonempty.
select pg_temp.gp_voucher('purchase',null,'2020-01-01',50,'purchase');
insert into private.stockflow_economic_item_catalogs(company_id,source_version,observed_at,content)
values('gp-co','p4a',now()+interval '1 day','{"products":[{"id":"gp-item","name":"P4a item"}],"groups":[]}');
insert into private.stockflow_products(tally_item_key,name,item_group,base_unit)
values('P4a item','P4a item','P4a group','pack');
insert into private.stockflow_customers(id,name,tally_key,created_by_email)
values('f4000000-0000-4000-8000-000000000001','P4a lab','p4a-lab','fixture');
insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
values('gp-co','grew','f4000000-0000-4000-8000-000000000001','fixture');
insert into private.stockflow_customer_product_prices(customer_id,tally_item_key,price_amount,status,
 approved_at,valid_from,version,source_type,reason,created_by_email,approved_by_email)
values('f4000000-0000-4000-8000-000000000001','P4a item',3,'approved',
 '2026-01-01','2026-01-01',1,'customer_contract','fixture','fixture','fixture');

-- Capture immutable originals and compare after every period read.
create temporary table original_functions as
select oid,pg_get_functiondef(oid) definition from pg_proc where oid=any(array[
 'private.stockflow_growth_costed_lines(date)'::regprocedure,
 'private.stockflow_growth_margin_model(date)'::regprocedure,
 'private.stockflow_growth_margin_read(date,jsonb)'::regprocedure,
 'private.stockflow_growth_margin_detail(date,jsonb)'::regprocedure,
 'private.stockflow_growth_billed_below(date,jsonb)'::regprocedure,
 'private.stockflow_growth_brands_read(date)'::regprocedure,
 'private.stockflow_growth_gp(date)'::regprocedure]);

do $parity$
declare t date:='2026-12-22'; s date:='2025-12-01'; e date:='2026-12-01'; h date:='2026-06-01';
 a jsonb; b jsonb; x jsonb; y jsonb; line jsonb; matched jsonb; payload jsonb; k text;
begin
 perform pg_temp.gp_assert(private.stockflow_growth_margin_model_window(s,e)=private.stockflow_growth_margin_model(t),'rolling model exact JSON parity');
 perform pg_temp.gp_assert(
  (select jsonb_agg(to_jsonb(c) order by to_jsonb(c)::text collate "C") from private.stockflow_growth_costed_lines_window(s,e) c)
  =(select jsonb_agg(to_jsonb(c) order by to_jsonb(c)::text collate "C") from private.stockflow_growth_costed_lines(t) c),'rolling ordered costed rows');
 for payload in select value from jsonb_array_elements('[{"view":"items","page":1},{"view":"labs","page":1},{"view":"items","page":1,"sort":"gp","filter":"all","q":"P4a"}]') loop
  perform pg_temp.gp_assert(private.stockflow_growth_margin_read_window(s,e,payload)=private.stockflow_growth_margin_read(t,payload),'rolling margin read exact parity');
 end loop;
 for payload in select value from jsonb_array_elements('[{"itemKey":"gp-co|gp-item|pack","page":1},{"labKey":"gp-co|grew","page":1},{"tallyItemKey":"P4a item","page":1}]') loop
  perform pg_temp.gp_assert(private.stockflow_growth_margin_detail_window(s,e,t,payload)=private.stockflow_growth_margin_detail(t,payload),'rolling detail exact parity');
 end loop;
 a:=private.stockflow_growth_billed_below_window(s,e,t,'{"page":1}');
 perform pg_temp.gp_assert(a=private.stockflow_growth_billed_below(t,'{"page":1}') and (a->>'lines')::int>0,'rolling nonempty billed below exact parity');
 a:=private.stockflow_growth_brands_window(s,s,s,e); b:=private.stockflow_growth_brands_read(t);
 perform pg_temp.gp_assert(a->'totals'=b->'totals','rolling brands all current totals');
 for x in select value from jsonb_array_elements(b->'rows') loop
  select value into y from jsonb_array_elements(a->'rows') where value->>'key'=x->>'key';
  perform pg_temp.gp_assert(x-array['h1Paise','h2Paise','lines']=y-array['h1Paise','h2Paise','lines'],'rolling brands all current row measures');
  for line in select value from jsonb_array_elements(x->'lines') loop
   select value into matched from jsonb_array_elements(y->'lines') where value->>'kind'=line->>'kind' and value->'group'=line->'group';
   perform pg_temp.gp_assert(line-array['h1Paise','h2Paise']=matched-array['h1Paise','h2Paise'],'rolling brands all current line measures');
  end loop;
 end loop;
 a:=private.stockflow_growth_brands_window(s,h,h,e);
 for x in select value from jsonb_array_elements(b->'rows') loop
  select value into y from jsonb_array_elements(a->'rows') where value->>'key'=x->>'key';
  perform pg_temp.gp_assert(x->'h1Paise'=y->'h1Paise' and x->'h2Paise'=y->'h2Paise','rolling brands halves row');
  for line in select value from jsonb_array_elements(x->'lines') loop
   select value into matched from jsonb_array_elements(y->'lines') where value->>'kind'=line->>'kind' and value->'group'=line->'group';
   perform pg_temp.gp_assert(line->'h1Paise'=matched->'h1Paise' and line->'h2Paise'=matched->'h2Paise','rolling brands halves line');
  end loop;
 end loop;
 a:=private.stockflow_growth_gp_window(s,e);b:=private.stockflow_growth_gp(t);
 foreach k in array array['window','repeat','bulk','consumables','instruments','months'] loop
  perform pg_temp.gp_assert(a->k=b->k,'rolling GP '||k);
 end loop;
end$parity$;

do $windows$
declare r jsonb; before_gap jsonb; v record;
begin
 -- Only October-November rows, with all pre-window purchases retained.
 perform pg_temp.gp_assert(not exists(select 1 from private.stockflow_growth_costed_lines_window('2026-10-01','2026-11-23')
  where business_date<'2026-10-01' or business_date>='2026-11-23'),'Q3 only Oct-Nov');
 select * into v from private.stockflow_growth_costed_lines_window('2026-10-01','2026-11-23') where customer_source_id='grew' and kind='sale';
 perform pg_temp.gp_assert(v.net=200 and v.cost=50,'pre-window purchase sets average cost');
 select * into v from private.stockflow_growth_costed_lines_window('2026-10-01','2026-11-23') where customer_source_id='grew' and kind='return';
 perform pg_temp.gp_assert(v.net=-50 and v.cost=-50,'return nets original sale cost');
 r:=private.stockflow_growth_margin_detail_window('2026-10-01','2026-11-23','2026-11-22','{"labKey":"gp-co|grew","page":1}');
 perform pg_temp.gp_assert(r#>>'{rows,0,salesPaise}'='150','Q3 margin nets in-window return');
 r:=private.stockflow_growth_gp_window('2026-10-01','2026-11-26');
 perform pg_temp.gp_assert(jsonb_array_length(r->'months')=2 and r#>>'{months,1,month}'='2026-11','running GP includes November');
 before_gap:=private.stockflow_growth_brands_window('2026-07-01','2026-08-23','2026-10-01','2026-11-23');
 perform pg_temp.gp_voucher('gap','gap','2026-09-15',999999);
 r:=private.stockflow_growth_brands_window('2026-07-01','2026-08-23','2026-10-01','2026-11-23');
 perform pg_temp.gp_assert(r=before_gap,'gap excluded from comparison and current');
 perform pg_temp.gp_assert(not exists(select 1 from jsonb_array_elements(r->'rows') where value->'salesPaise'<>value->'h2Paise'),'brands sales equals current');
 perform pg_temp.gp_assert((select sum((value->>'h1Paise')::numeric) from jsonb_array_elements(r->'rows'))
  =(select sum(net) from private.stockflow_growth_costed_lines_window('2026-07-01','2026-08-23')),'h1 only comparison window');
 begin perform private.stockflow_growth_brands_window('2026-07-01','2026-10-02','2026-10-01','2026-11-23');raise exception 'Accepted overlapping windows';
 exception when sqlstate '22023' then null;end;
end$windows$;

do $gateway$
declare f text; action_name text; payload jsonb; r jsonb; p jsonb:='{"kind":"quarter","fy":2026,"quarter":3}'; signature text; role_name text;
begin
 select pg_get_functiondef('public.stockflow_growth_gateway(text,text,text,jsonb)'::regprocedure) into f;
 execute replace(f,'(now() at time zone ''Asia/Kolkata'')::date','''2026-11-22''::date');
 foreach action_name in array array['get_growth_margin_period','get_growth_brands_period'] loop
  payload:=jsonb_build_object('period',p)||case when action_name='get_growth_margin_period' then '{"read":"gp"}'::jsonb else '{"comparison":"previous"}'::jsonb end;
  begin perform public.stockflow_growth_gateway('wrong','gp-management@test.local',action_name,payload);raise exception 'Accepted wrong key';
  exception when sqlstate '42501' then null;end;
  foreach role_name in array array['sales','missing'] loop
   begin perform public.stockflow_growth_gateway('growth-period-key','gp-'||role_name||'@test.local',action_name,payload);raise exception 'Accepted non-management';
   exception when sqlstate 'PT403' then null;end;
  end loop;
  r:=public.stockflow_growth_gateway('growth-period-key','gp-management@test.local',action_name,payload);
  perform pg_temp.gp_assert(r#>>'{period,to}'='2026-11-22' and not (r->'period' ? 'comparisons'),'gateway period metadata');
  if action_name='get_growth_brands_period' then
   perform pg_temp.gp_assert(r#>>'{comparison,key}'='previous' and r#>>'{comparisonWindow,to}'='2026-08-23','gateway comparison exclusive end');
   perform pg_temp.gp_assert(r#>>'{comparison,state}'=private.stockflow_growth_period_read('2026-11-22',array['management'],p)#>>'{comparisons,1,check,state}','comparison check matches period read');
  else
   perform pg_temp.gp_assert(r-'period'=private.stockflow_growth_integer_paise(private.stockflow_growth_gp_window('2026-10-01','2026-11-23')),'gateway GP dispatch');
  end if;
 end loop;
 r:=public.stockflow_growth_gateway('growth-period-key','gp-management@test.local','get_growth_brands_period',
  jsonb_build_object('period',p,'comparison','last_year'));
 perform pg_temp.gp_assert(r#>>'{comparison,state}'='no_history' and (r#>>'{totals,salesPaise}')::numeric>0,
  'no-history comparison retains current brand figures');
 for payload in select value from jsonb_array_elements('[{},{"read":"x"},{"read":1},{"read":"gp","extra":1},{"read":"margin","view":"items","page":0}]') loop
  begin perform public.stockflow_growth_gateway('growth-period-key','gp-management@test.local','get_growth_margin_period',jsonb_build_object('period',p)||payload);raise exception 'Accepted bad margin %',payload;
  exception when sqlstate '22023' then null;end;
 end loop;
 for payload in select value from jsonb_array_elements('[{"period":{"kind":"quarter","fy":2026,"quarter":3},"comparison":"previous","extra":1},{"period":{"kind":"fy","fy":2026},"comparison":"previous"}]') loop
  begin perform public.stockflow_growth_gateway('growth-period-key','gp-management@test.local','get_growth_brands_period',payload);raise exception 'Accepted bad brands';
  exception when sqlstate '22023' then perform pg_temp.gp_assert(sqlerrm='Invalid growth brands request','brands error message');end;
 end loop;
 foreach action_name in array array['get_growth_margin_period','get_growth_brands_period'] loop
  for payload in select value from jsonb_array_elements('[null,{"kind":"fy","fy":"2026"},{"kind":"fy","fy":2026.5},{"kind":"fy","fy":2026,"quarter":null},{"kind":"quarter","fy":2026,"quarter":2.5},{"kind":"fy","fy":2016}]') loop
   begin perform public.stockflow_growth_gateway('growth-period-key','gp-management@test.local',action_name,jsonb_build_object('period',payload,'read','gp','comparison','last_year'));raise exception 'Accepted bad period';
   exception when sqlstate '22023' then perform pg_temp.gp_assert(sqlerrm='Invalid growth period','P1 exact period checks');end;
  end loop;
 end loop;
 -- Verify each margin dispatch and integer-paise conversion.
 for payload in select value from jsonb_array_elements('[{"read":"margin","view":"items","page":1},{"read":"detail","itemKey":"gp-co|gp-item|pack","page":1},{"read":"billed_below","page":1}]') loop
  r:=public.stockflow_growth_gateway('growth-period-key','gp-management@test.local','get_growth_margin_period',jsonb_build_object('period',p)||payload);
  perform pg_temp.gp_assert(r-'period'=private.stockflow_growth_integer_paise(case payload->>'read'
   when 'margin' then private.stockflow_growth_margin_read_window('2026-10-01','2026-11-23',payload-'read')
   when 'detail' then private.stockflow_growth_margin_detail_window('2026-10-01','2026-11-23','2026-11-22',payload-'read')
   else private.stockflow_growth_billed_below_window('2026-10-01','2026-11-23','2026-11-22',payload-'read') end),'margin dispatch '||(payload->>'read'));
 end loop;
 for action_name,payload in select * from (values
  ('get_growth_margin','{"view":"items","page":1}'::jsonb),('get_growth_brands','{}'::jsonb),
  ('get_growth_labs_period',jsonb_build_object('period',p,'list','window_labs','page',1)),
  ('get_growth_period',jsonb_build_object('period',p))
 ) x(a,b) loop
  perform pg_temp.gp_assert(public.stockflow_growth_gateway('growth-period-key','gp-management@test.local',action_name,payload)
   =public.stockflow_growth_gateway_before_period_profit('growth-period-key','gp-management@test.local',action_name,payload),'unchanged action '||action_name);
 end loop;
 perform pg_temp.gp_assert((select 'statement_timeout=20s'=any(proconfig) from pg_proc where oid='public.stockflow_growth_gateway(text,text,text,jsonb)'::regprocedure),'gateway timeout 20s');
 foreach signature in array array[
  'private.stockflow_growth_costed_lines_window(date,date)','private.stockflow_growth_margin_model_window(date,date)',
  'private.stockflow_growth_margin_read_window(date,date,jsonb)','private.stockflow_growth_margin_detail_window(date,date,date,jsonb)',
  'private.stockflow_growth_billed_below_window(date,date,date,jsonb)','private.stockflow_growth_brands_window(date,date,date,date)',
  'private.stockflow_growth_gp_window(date,date)','public.stockflow_growth_gateway_before_period_profit(text,text,text,jsonb)'] loop
  foreach role_name in array array['anon','authenticated','service_role'] loop
   perform pg_temp.gp_assert(not has_function_privilege(role_name,signature,'execute'),'private function ACL '||signature||role_name);
  end loop;
 end loop;
 perform pg_temp.gp_assert(has_function_privilege('service_role','public.stockflow_growth_gateway(text,text,text,jsonb)','execute')
  and not has_function_privilege('anon','public.stockflow_growth_gateway(text,text,text,jsonb)','execute')
  and not has_function_privilege('authenticated','public.stockflow_growth_gateway(text,text,text,jsonb)','execute'),'gateway ACL');
 perform pg_temp.gp_assert(not exists(select 1 from original_functions where definition<>pg_get_functiondef(oid)),'original functions unchanged');
 raise notice 'PASS growth period profit rolling parity, windows, return costs, brands gap, dispatch and privacy';
end$gateway$;
rollback;
