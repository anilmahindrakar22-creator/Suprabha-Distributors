begin;
set local statement_timeout='60s';

create function pg_temp.outcome_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Price outcomes: %',label; end if; end$$;

create function pg_temp.outcome_line(src text,item text,net bigint,d date default '2031-07-14',
 revision bigint default 1,cancelled boolean default false) returns void language plpgsql as $$
declare voucher uuid;
begin
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,kind,cancelled,evidence)
 values('outcome-company',src,revision,d,'ledger','sale',cancelled,'{}') returning id into voucher;
 insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
 values(voucher,'1',item,1,'unit',net,'{}');
end$$;

create temp table outcome_baseline on commit drop as
select private.stockflow_price_outcomes('2031-07-15',1,null)->'counts' c,
 private.stockflow_price_outcomes('2031-07-15',1,null)->'matureCount' mature_count;

insert into private.stockflow_customers(id,name,tally_key,city,created_by_email) values
 ('f6000000-0000-4000-8000-000000000001','Outcome Customer','outcome-linked','Test Town','fixture'),
 ('f6000000-0000-4000-8000-000000000002','Unlinked Customer','outcome-unlinked','Test Town','fixture');
insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
values('outcome-company','ledger','f6000000-0000-4000-8000-000000000001','fixture');
insert into private.stockflow_products(tally_item_key,name,item_group)
select 'Outcome '||x,'Outcome '||x,'Outcome fixture' from unnest(array['different','unbilled','same','unlinked','unit']) x;
insert into private.stockflow_economic_item_catalogs(company_id,source_version,observed_at,content)
values('outcome-company','old','2031-07-01','{"products":[{"id":"different","name":"Old name"}]}');
insert into private.stockflow_economic_item_catalogs(company_id,source_version,observed_at,content)
select 'outcome-company','latest','2031-07-02',jsonb_build_object('products',jsonb_agg(jsonb_build_object('id',x,'name','Outcome '||x)))
from unnest(array['different','unbilled','same','unlinked','unit']) x;
insert into private.stockflow_customer_product_prices(customer_id,tally_item_key,price_amount,valid_from,
 status,source_type,reason,created_by_email,approved_by_email,approved_at)
select case when x='unlinked' then 'f6000000-0000-4000-8000-000000000002'::uuid
 else 'f6000000-0000-4000-8000-000000000001'::uuid end,'Outcome '||x,100,'2031-07-01',
 'approved','customer_contract','Outcome fixture','fixture','fixture','2031-07-10 00:15:00+05:30'
from unnest(array['different','unbilled','same','unlinked','unit']) x;

select pg_temp.outcome_line('different','different',9500);
select pg_temp.outcome_line('same','same',9500,'2031-07-14',1);
select pg_temp.outcome_line('same','same',10050,'2031-07-14',2);
select pg_temp.outcome_line('unit','unit',1000);
select pg_temp.outcome_line('cancelled','unbilled',9500,'2031-07-15',1,true);
select pg_temp.outcome_line('early','unbilled',9500,'2031-07-09');

insert into private.stockflow_gateway_config(name,secret_sha256)
values('orders',encode(extensions.digest('outcome-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,roles,status)
select 'outcome-'||r||'@test.local',r,array[r],'active'
from unnest(array['administrator','management','accounts','operations']) r;
do $$declare definition text; begin
 select pg_get_functiondef('public.stockflow_pricing_gateway(text,text,text,jsonb)'::regprocedure) into definition;
 execute replace(definition,'(now() at time zone ''Asia/Kolkata'')::date','''2031-07-15''::date');
end$$;

do $tests$
declare r jsonb; baseline jsonb; baseline_mature integer; expected jsonb; filtered jsonb; row jsonb; role_name text; payload jsonb;
begin
 select c,mature_count into baseline,baseline_mature from outcome_baseline;
 r:=private.stockflow_price_outcomes('2031-07-15',1,null);
 expected:=jsonb_build_object(
  'different',(baseline->>'different')::integer+1,
  'not_billed',(baseline->>'not_billed')::integer+1,
  'matches',(baseline->>'matches')::integer+1,
  'cannot_match',(baseline->>'cannot_match')::integer+2);
 perform pg_temp.outcome_assert(r->'counts'=expected,'fixture count deltas');
 perform pg_temp.outcome_assert((r->>'total')::integer=(baseline->>'different')::integer
  +(baseline->>'not_billed')::integer+(baseline->>'matches')::integer+(baseline->>'cannot_match')::integer+5
  and r->>'pageSize'='10' and r->>'page'='1','pagination');
 perform pg_temp.outcome_assert(r->>'view'='price_outcomes' and r->>'asOf'='2031-07-15'
  and r->>'toleranceRupees'='1' and r->>'salesThrough'='2031-07-14'
  and (r->>'matureCount')::integer=baseline_mature,'metadata');
 perform pg_temp.outcome_assert(r->'rows'->0->>'state'='different'
  and r->'rows'->0->>'itemKey'='Outcome different','different first');
 select x into row from jsonb_array_elements(private.stockflow_price_outcomes('2031-07-15',1,'different')->'rows') x where x->>'itemKey'='Outcome different';
 perform pg_temp.outcome_assert(row->>'state'='different' and row->'reason'='null'::jsonb
  and row->>'approvedPaise'='10000' and row->>'lastBilledPaise'='9500' and row->>'worstDiffPaise'='-500'
  and row->>'differentLines'='1' and row->>'lines'='1','different rate and signed difference');
 select x into row from jsonb_array_elements(private.stockflow_price_outcomes('2031-07-15',1,'not_billed')->'rows') x where x->>'itemKey'='Outcome unbilled';
 perform pg_temp.outcome_assert(row->>'state'='not_billed' and row->>'lines'='0'
  and row->>'effectiveFrom'='2031-07-10' and row->'lastBilledOn'='null'::jsonb,'cancelled and before effective date ignored');
 select x into row from jsonb_array_elements(private.stockflow_price_outcomes('2031-07-15',1,'matches')->'rows') x where x->>'itemKey'='Outcome same';
 perform pg_temp.outcome_assert(row->>'state'='matches' and row->>'lines'='1'
  and row->>'lastBilledPaise'='10050' and row->>'differentLines'='0','tolerance and latest revision');
 select x into row from jsonb_array_elements(private.stockflow_price_outcomes('2031-07-15',1,'cannot_match')->'rows') x where x->>'itemKey'='Outcome unlinked';
 perform pg_temp.outcome_assert(row->>'state'='cannot_match' and row->>'reason'='no_ledger_link','unlinked reason');
 select x into row from jsonb_array_elements(private.stockflow_price_outcomes('2031-07-15',1,'cannot_match')->'rows') x where x->>'itemKey'='Outcome unit';
 perform pg_temp.outcome_assert(row->>'state'='cannot_match' and row->>'reason'='unit_differs'
  and row->>'packLines'='1' and row->>'lines'='0' and row->'worstDiffPaise'='null'::jsonb,'unit reason and exclusion');
 filtered:=private.stockflow_price_outcomes('2031-07-15',1,'different');
 perform pg_temp.outcome_assert(filtered->>'total'=(expected->>'different') and jsonb_array_length(filtered->'rows')=(expected->>'different')::integer
  and filtered->'counts'=r->'counts','filter keeps global counts');
 perform pg_temp.outcome_assert(private.stockflow_price_outcomes('2031-07-15',2,null)->'rows'='[]'::jsonb,'empty second page');
 begin
  perform private.stockflow_price_outcomes('2031-07-15',1,'bad');
  raise exception 'Bad state accepted';
 exception when sqlstate '22023' then null; end;
 perform pg_temp.outcome_assert(position('cost' in lower(pg_get_functiondef('private.stockflow_price_outcomes(date,integer,text)'::regprocedure)))=0,'rates only source');
 foreach role_name in array array['administrator','management','accounts'] loop
  perform pg_temp.outcome_assert(public.stockflow_pricing_gateway('outcome-key','outcome-'||role_name||'@test.local',
   'get_order_pricing','{"view":"price_outcomes","page":1}')=private.stockflow_price_outcomes('2031-07-15',1,null),'allowed role '||role_name);
 end loop;
 begin
  perform public.stockflow_pricing_gateway('outcome-key','outcome-operations@test.local','get_order_pricing','{"view":"price_outcomes","page":1}');
  raise exception 'Operations accepted';
 exception when sqlstate '42501' then null; end;
 begin
  perform public.stockflow_pricing_gateway('wrong-key','outcome-accounts@test.local','get_order_pricing','{"view":"price_outcomes","page":1}');
  raise exception 'Wrong key accepted';
 exception when sqlstate '42501' then null; end;
 for payload in select x from jsonb_array_elements('[{"view":"price_outcomes","page":"1"},
  {"view":"price_outcomes","page":0},{"view":"price_outcomes","page":1.5},
  {"view":"price_outcomes","page":1000000},{"view":"price_outcomes","page":1,"extra":true},
  {"view":"price_outcomes","page":1,"state":"bad"},{"view":"price_outcomes","page":1,"state":null}]') x loop
  begin
   perform public.stockflow_pricing_gateway('outcome-key','outcome-accounts@test.local','get_order_pricing',payload);
   raise exception 'Invalid payload accepted: %',payload;
  exception when sqlstate '22023' then null; end;
 end loop;
 foreach role_name in array array['anon','authenticated','service_role'] loop
  perform pg_temp.outcome_assert(not has_function_privilege(role_name,'private.stockflow_price_outcomes(date,integer,text)','execute'),'private ACL');
  perform pg_temp.outcome_assert(not has_function_privilege(role_name,'public.stockflow_pricing_gateway_before_price_outcomes(text,text,text,jsonb)','execute'),'wrapped ACL');
 end loop;
end$tests$;
rollback;
