begin;
-- Dedicated fixture IDs; all fixture writes, including coverage, roll back.
insert into private.stockflow_gateway_config(name,secret_sha256)
values('orders',encode(extensions.digest('prospects-focus-test-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,status)
select 'pf-'||r||'@test.local',r,'active' from unnest(array['management','administrator','sales']) r;
insert into private.stockflow_customers(id,name,created_by_email)
select ('b4f10000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'PF lab '||lpad(n::text,2,'0'),'test' from generate_series(1,25) n;

create function pg_temp.pf_id(n integer) returns uuid language sql as $$
 select ('b4f10000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.pf_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL %',label;end if;end$$;
-- Gather every page, preserving server order and avoiding ambient total assumptions.
create function pg_temp.pf_rows(actor text default 'management') returns jsonb language plpgsql as $$
declare result jsonb:='[]'; response jsonb; page_number integer:=1;
begin
 loop
  response:=public.stockflow_customer_map_gateway('prospects-focus-test-key','pf-'||actor||'@test.local',
   'get_prospects',jsonb_build_object('brand','DIASYS','page',page_number));
  result:=result||(response->'rows');
  exit when page_number*20>=(response->>'total')::integer or page_number=4000;
  page_number:=page_number+1;
 end loop;
 return result;
end$$;

do $checks$
declare
 today date:=(now() at time zone 'Asia/Kolkata')::date;
 window_end date:=date_trunc('month',today)::date;
 window_start date:=(window_end-interval '3 months')::date;
 company text; month_start date; months date[]; net bigint; n integer;
 wallet jsonb; rows_data jsonb; sales_rows jsonb; admin_rows jsonb; expected jsonb; ids text[]; definition text;
begin
 for n in 1..25 loop
  perform public.stockflow_accounts_gateway('prospects-focus-test-key','pf-management@test.local','record_lab_mix',
   jsonb_build_object('customerId',pg_temp.pf_id(n),'areas',jsonb_build_array(
    jsonb_build_object('area','BIOCHEM','status','in_house','exact',n)),
    'idempotencyKey','PF-lab-mix-report-'||n));
  perform public.stockflow_wallet_gateway('prospects-focus-test-key','pf-management@test.local','record_wallet_snapshot',
   jsonb_build_object('requestId','PF-wallet-snapshot-'||n,'customerId',pg_temp.pf_id(n),
    'monthlyWalletPaise',case when n=1 then 9000000000000000::bigint else 0 end,
    'method','manager_estimate','source','Fixture source','confidence','medium','asOf',today,
    'note','Fixture estimate','loweredReason',null,'divisions','[]'::jsonb,'expectedCurrentSnapshotId',null));
 end loop;
 insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
 values('PF-company','PF-ledger',pg_temp.pf_id(1),'test');
 months:=array[window_start,(window_start+interval '1 month')::date,(window_start+interval '2 months')::date];
 -- Same certification fixture as wallet_v2: actual totals for every linked company.
 for company in select distinct company_id from private.stockflow_economic_customer_identities loop
  insert into private.stockflow_economic_source_coverage(company_id,window_from,window_to,source_version,imported_at)
  values(company,window_start,window_end,'PF-certified',clock_timestamp()+interval '1 day');
  insert into private.stockflow_sales_control_imports(company_id,source_version,valid_months,imported_at)
  values(company,'PF-certified',months,clock_timestamp()+interval '1 day');
  foreach month_start in array months loop
   net:=(private.stockflow_sales_reconciliation(company,month_start)->>'appNetPaise')::bigint;
   insert into private.stockflow_sales_control_totals(company_id,month,kind,source_key,net_paise,source_version,imported_at)
   values(company,month_start,'sales_ledger','sales',net,'PF-certified',clock_timestamp()+interval '1 day');
  end loop;
 end loop;
 wallet:=private.stockflow_wallet_read(today);
 perform pg_temp.pf_assert(wallet#>>'{coverage,certified}'='true','PF1 certified coverage');
 perform pg_temp.pf_assert((select value->'inFocusBand'='true'::jsonb from jsonb_array_elements(wallet->'rows')
  where value->>'customerId'=pg_temp.pf_id(1)::text),'PF1 real wallet Focus membership');
 perform pg_temp.pf_assert((select value->'inFocusBand'='false'::jsonb from jsonb_array_elements(wallet->'rows')
  where value->>'customerId'=pg_temp.pf_id(25)::text),'PF1 real wallet non-Focus membership');
 rows_data:=pg_temp.pf_rows();
 select array_agg(value->>'customerId' order by ord) into ids
 from jsonb_array_elements(rows_data) with ordinality t(value,ord);
 perform pg_temp.pf_assert(array_position(ids,pg_temp.pf_id(1)::text)<array_position(ids,pg_temp.pf_id(25)::text),
  'PF1 lower-volume Focus lab ranks above higher-volume non-Focus lab across pages');
 perform pg_temp.pf_assert((select value->'focus'='true'::jsonb and value->>'volume'='1'
  from jsonb_array_elements(rows_data) where value->>'customerId'=pg_temp.pf_id(1)::text),'PF1 row focus true');
 sales_rows:=pg_temp.pf_rows('sales');admin_rows:=pg_temp.pf_rows('administrator');
 perform pg_temp.pf_assert((select array_agg(value->>'customerId' order by ord)=ids
  from jsonb_array_elements(sales_rows) with ordinality t(value,ord)),'PF3 sales same order');
 perform pg_temp.pf_assert((select array_agg(value->>'customerId' order by ord)=ids
  from jsonb_array_elements(admin_rows) with ordinality t(value,ord)),'PF3 administrator same order');
 perform pg_temp.pf_assert((select bool_and(value ? 'focus' and not (value ? 'brandSalesPaise') and value ? 'buysBrand')
  from jsonb_array_elements(sales_rows)),'PF3 sales focus flag and no amounts');
 perform pg_temp.pf_assert((select jsonb_agg(value->'focus' order by ord) from jsonb_array_elements(sales_rows) with ordinality t(value,ord))
  =(select jsonb_agg(value->'focus' order by ord) from jsonb_array_elements(rows_data) with ordinality t(value,ord)),
  'PF3 sales same focus flags');

 -- A newer mismatching control closes certification without changing prospects.
 insert into private.stockflow_sales_control_imports(company_id,source_version,valid_months,imported_at)
 values('PF-company','PF-uncertified',array[window_start],clock_timestamp()+interval '2 days');
 insert into private.stockflow_sales_control_totals(company_id,month,kind,source_key,net_paise,source_version,imported_at)
 values('PF-company',window_start,'sales_ledger','sales',1,'PF-uncertified',clock_timestamp()+interval '2 days');
 perform pg_temp.pf_assert(private.stockflow_wallet_read(today)#>>'{coverage,certified}'='false','PF2 uncertified coverage');
 rows_data:=pg_temp.pf_rows();
 perform pg_temp.pf_assert((select bool_and(value->'focus'='false'::jsonb) from jsonb_array_elements(rows_data)),
  'PF2 every focus false');
 select jsonb_agg(value order by (value->>'hasOurMachine')::boolean,
  exists(select 1 from jsonb_array_elements(value->'areas') a where a->>'status'='in_house') desc,
  (value->>'volume')::numeric desc,value->>'name',value->>'customerId') into expected
 from jsonb_array_elements(rows_data);
 perform pg_temp.pf_assert(rows_data=expected,'PF2 original machine/in-house/volume/name/id order');
 definition:=pg_get_functiondef('private.stockflow_brand_prospects(text,text[],jsonb)'::regprocedure);
 perform pg_temp.pf_assert((length(definition)-length(replace(definition,'focus desc','')))/length('focus desc')=2,
  'PF4 both orderings contain focus desc');
 raise notice 'PASS PF1-PF4 Focus-first prospects, uncertified fallback and role boundary';
end $checks$;
rollback;
