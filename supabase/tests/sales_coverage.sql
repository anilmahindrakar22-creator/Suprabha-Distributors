begin;
create function pg_temp.sales_snapshot(extra jsonb) returns void language sql as $$
 select public.stockflow_sync_snapshot(jsonb_build_object('company','SUPRABHA DISTRIBUTORS',
  'fetchedAtIso',clock_timestamp(),'rows','[]'::jsonb,'groups','[]'::jsonb,'catalog',jsonb_build_object('retained',true))||extra);
$$;
create function pg_temp.sales_envelope(company text,version text,vouchers jsonb default '[]') returns jsonb language sql as $$
 select jsonb_build_object('economicEvidence',jsonb_build_object('schemaVersion',1,'companyId',company,
  'sourceVersion',version,'completeWindow',true,'windowFrom','2026-07-01','windowTo','2026-10-01','vouchers',vouchers));
$$;
create function pg_temp.sales_control(version text,net bigint) returns jsonb language sql as $$
 select jsonb_build_object('salesControlTotals',jsonb_build_object('companyId','sales-test','sourceVersion',version,
  'months',jsonb_build_array(jsonb_build_object('month','2026-07','salesLedgers',jsonb_build_array(
   jsonb_build_object('ledgerId','sales','name','Sales','openingPaise',1000,'closingPaise',1000+net,'netPaise',net)),
   'customers',jsonb_build_array(jsonb_build_object('customerSourceId','customer','grossPaise',net+18))))));
$$;
create function pg_temp.sales_line(source text,revision integer,amount bigint,cancelled boolean default false,kind text default 'sale') returns void language plpgsql as $$
declare voucher uuid;
begin
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,kind,cancelled,evidence)
 values('sales-test',source,revision,'2026-07-10','customer',kind,cancelled,'{}') returning id into voucher;
 insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,gst_paise,evidence)
 values(voucher,'1','sales-test-product',case when amount<0 then -1 else 1 end,'Nos',amount,case when source='sale' then 18 else 0 end,'{}');
end$$;

do $test$
declare result jsonb; company text; evidence jsonb; before_count bigint; payload jsonb;
begin
 -- CASE P3.1: a clean Jul-Sep envelope writes exactly one covering generation.
 perform pg_temp.sales_snapshot(pg_temp.sales_envelope('coverage-clean','2026-10-01T00:00:00Z'));
 if (select count(*) from private.stockflow_economic_source_coverage where company_id='coverage-clean')<>1 then raise exception 'Expected one coverage row';end if;
 result:=private.stockflow_sales_coverage_status('coverage-clean','2026-07-01','2026-09-30');
 if result->>'complete'<>'true' or result->>'coveredTo'<>'2026-09-30' then raise exception 'Clean coverage failed: %',result;end if;
 -- CASE P3.2: June does not block; August, absent and malformed dates block.
 foreach company in array array['date-june','date-august','date-undated','date-malformed'] loop
  perform pg_temp.sales_snapshot(pg_temp.sales_envelope(company,'2026-10-01T00:00:00Z'));
  evidence:=case company when 'date-june' then '{"date":"2026-06-30"}'::jsonb when 'date-august' then '{"date":"2026-08-01"}'::jsonb
   when 'date-malformed' then '{"date":"2026-99-99"}'::jsonb else '{}'::jsonb end;
  insert into private.stockflow_economic_import_exceptions(company_id,reason,evidence,recorded_at)
  values(company,'later exception',evidence,clock_timestamp());
  result:=private.stockflow_sales_coverage_status(company,'2026-07-01','2026-09-30');
  if (result->>'complete')::boolean is distinct from (company='date-june') then raise exception 'Exception date scope failed: % %',company,result;end if;
 end loop;
 -- CASE P3.3: adjacent generations cannot be unioned to cover the window.
 insert into private.stockflow_economic_source_coverage(company_id,window_from,window_to,source_version)
 values('split','2026-07-01','2026-09-01','a'),('split','2026-09-01','2026-10-01','b');
 result:=private.stockflow_sales_coverage_status('split','2026-07-01','2026-09-30');
 if result->>'complete'<>'false' or result->'coveredFrom'<>'null'::jsonb then raise exception 'Split generations certified';end if;
 -- CASE P3.4: omission names ordered missing vouchers and admits no coverage.
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,kind,evidence)
 select 'omission','missing-'||lpad(n::text,3,'0'),1,'2026-08-01','sale','{}'::jsonb from generate_series(1,55) n;
 perform pg_temp.sales_snapshot(pg_temp.sales_envelope('omission','2026-10-01T00:00:00Z'));
 select e.evidence into evidence from private.stockflow_economic_import_exceptions e where company_id='omission' order by id desc limit 1;
 if evidence->>'missingCount'<>'55' or jsonb_array_length(evidence->'missingSourceIds')<>50
  or evidence->'missingSourceIds'->>0<>'missing-001' or evidence ? 'vouchers' then raise exception 'Missing voucher evidence incorrect: %',evidence;end if;
 if exists(select 1 from private.stockflow_economic_source_coverage where company_id='omission') then raise exception 'Omission admitted coverage';end if;
 -- CASE P3.5: malformed controls commit snapshots, strip the key and count skips.
 select count(*) into before_count from private.stockflow_sales_control_imports where rejected_parts>0;
 perform pg_temp.sales_snapshot('{"salesControlTotals":{"months":"bad"}}');
 select p.payload into payload from public.stockflow_snapshots p where id='suprabha';
 if payload ? 'salesControlTotals' or payload->'catalog'->>'retained'<>'true' then raise exception 'Invalid control leaked or snapshot failed';end if;
 if (select count(*) from private.stockflow_sales_control_imports where rejected_parts>0)<>before_count+1 then raise exception 'Invalid envelope not counted';end if;
 -- CASE P3.6: valid controls strip payload; latest revision wins, cancelled latest
 -- revisions exclude their older active versions; returns/credits remain signed.
 perform pg_temp.sales_line('sale',1,999);
 perform pg_temp.sales_line('sale',2,150);
 perform pg_temp.sales_line('cancelled',1,500);
 perform pg_temp.sales_line('cancelled',2,500,true);
 perform pg_temp.sales_line('return',1,-30,false,'return');
 perform pg_temp.sales_line('credit',1,-20,false,'credit');
 result:=private.stockflow_sales_reconciliation('sales-test','2026-07-01');
 if result->>'appNetPaise'<>'100' or result->>'state'<>'no_control' or result->'tallyNetPaise'<>'null'::jsonb then raise exception 'App/latest revision calculation failed: %',result;end if;
 perform pg_temp.sales_snapshot(pg_temp.sales_control('2026-10-01T01:00:00Z',100));
 if (select p.payload ? 'salesControlTotals' from public.stockflow_snapshots p where id='suprabha') then raise exception 'Valid controls leaked';end if;
 result:=private.stockflow_sales_reconciliation('sales-test','2026-07-01');
 if result->>'state'<>'matches' or result->>'differencePaise'<>'0' then raise exception 'Exact match failed: %',result;end if;
 result:=private.stockflow_sales_customer_reconciliation('sales-test','2026-07-01');
 if result->0->>'state'<>'matches' or result->0->>'appGrossPaise'<>'118' then raise exception 'Customer gross did not include GST: %',result;end if;
 -- CASE P3.7: source-version replay cannot overwrite or append to a generation.
 perform pg_temp.sales_snapshot(pg_temp.sales_control('2026-10-01T01:00:00Z',999));
 result:=private.stockflow_sales_reconciliation('sales-test','2026-07-01');
 if result->>'state'<>'matches' then raise exception 'Reused version mutated controls';end if;
 perform pg_temp.sales_snapshot(pg_temp.sales_control('2026-10-01T02:00:00Z',101));
 result:=private.stockflow_sales_reconciliation('sales-test','2026-07-01');
 if result->>'state'<>'differs' or result->>'differencePaise'<>'-1' then raise exception 'One-paise difference hidden';end if;
 -- CASE P3.8: one invalid ledger invalidates its whole month, avoiding partial sums.
 payload:=pg_temp.sales_control('2026-10-01T03:00:00Z',100);
 payload:=jsonb_set(payload,'{salesControlTotals,months,0,salesLedgers}',payload#>'{salesControlTotals,months,0,salesLedgers}'||'[{"ledgerId":"bad"}]'::jsonb);
 perform pg_temp.sales_snapshot(payload);
 if exists(select 1 from private.stockflow_sales_control_totals where company_id='sales-test' and source_version='2026-10-01T03:00:00Z') then raise exception 'Partial ledger generation retained';end if;
 if not exists(select 1 from private.stockflow_sales_control_imports where company_id='sales-test' and source_version='2026-10-01T03:00:00Z' and rejected_parts=1 and cardinality(valid_months)=0) then raise exception 'Bad ledger month not counted';end if;
 -- CASE P3.9: rebuild pause is independent of source completeness.
 insert into private.stockflow_economic_rebuild_status(company_id,state,reason,since) values('coverage-clean','paused','test limit',clock_timestamp());
 result:=private.stockflow_sales_coverage_status('coverage-clean','2026-07-01','2026-09-30');
 if result->>'complete'<>'true' then raise exception 'Pause blocked coverage';end if;
 -- CASE P3.10: newest-first bounded blockers retain the full count.
 insert into private.stockflow_economic_import_exceptions(company_id,source_id,reason,evidence,recorded_at)
 select 'many-blockers',n::text,'test','{}',clock_timestamp()+n*interval '1 second' from generate_series(1,25) n;
 result:=private.stockflow_sales_coverage_status('many-blockers','2026-07-01','2026-09-30');
 if result->>'blockingCount'<>'25' or jsonb_array_length(result->'blockingExceptions')<>20
  or result->'blockingExceptions'->0->>'sourceId'<>'25' then raise exception 'Blocker bound/order failed';end if;
end$test$;

-- Keep identity resolution outside this gateway authorization test: temporarily
-- supply deterministic active-member roles, preserving the original definition.
-- The gateway's real secret check, role gate and read branch all remain intact.
do $authorization$
declare roles_definition text; argument_name text; role_name text; result jsonb; denied boolean;
 expected_keys text[]:=array['blockingCount','blockingItems','complete','coveredFrom','coveredTo','importedAt','months','rebuild','sourceVersion','window'];
 actual_keys text[]; row_value jsonb; ordinal integer; window_end date:=date_trunc('month',now() at time zone 'Asia/Kolkata')::date;
begin
 roles_definition:=pg_get_functiondef('private.stockflow_active_member_roles(text)'::regprocedure);
 select proargnames[1] into argument_name from pg_proc where oid='private.stockflow_active_member_roles(text)'::regprocedure;
 execute format($fixture$create or replace function private.stockflow_active_member_roles(%s text) returns text[]
 language sql stable security definer set search_path=pg_catalog as $body$
 select case $1
  when 'coverage-sales@test.invalid' then array['sales']
  when 'coverage-operations@test.invalid' then array['operations']
  when 'coverage-accounts@test.invalid' then array['accounts']
  when 'coverage-management@test.invalid' then array['management']
  when 'coverage-administrator@test.invalid' then array['administrator']
  else '{}'::text[] end;
 $body$;$fixture$,case when argument_name is null then '' else quote_ident(argument_name) end);
 insert into private.stockflow_gateway_config(name,secret_sha256)
 values('orders',encode(extensions.digest('sales-coverage-test-key','sha256'),'hex'))
 on conflict(name) do update set secret_sha256=excluded.secret_sha256;
 -- Establish an unambiguous latest canonical company independently of fixture
 -- transaction timestamps and the reporting month when the conductor replays.
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,kind,evidence,imported_at)
 values('gateway-coverage','gateway-source',1,window_end-1,'sale','{}',clock_timestamp()+interval '1 day');
 insert into private.stockflow_economic_source_coverage(company_id,window_from,window_to,source_version)
 values('gateway-coverage',(window_end-interval '3 months')::date,window_end,'2026-10-01T00:00:00Z');
 -- CASE P3.11: sales/operations receive 42501 through the public gateway.
 foreach role_name in array array['sales','operations'] loop
  denied:=false;
  begin
   perform public.stockflow_economics_gateway('sales-coverage-test-key','coverage-'||role_name||'@test.invalid','get_sales_coverage','{}');
  exception when sqlstate '42501' then denied:=true;
  end;
  if not denied then raise exception 'Sales coverage admitted %',role_name;end if;
 end loop;
 -- CASE P3.12: accounts, management and administrator get precisely the contract.
 foreach role_name in array array['accounts','management','administrator'] loop
  result:=public.stockflow_economics_gateway('sales-coverage-test-key','coverage-'||role_name||'@test.invalid','get_sales_coverage','{}');
  select array_agg(k order by k) into actual_keys from jsonb_object_keys(result) k;
  if actual_keys is distinct from expected_keys then raise exception 'Contract keys differ for %: %',role_name,result;end if;
  if result->>'complete' is distinct from 'true' or result->>'sourceVersion' is distinct from '2026-10-01T00:00:00Z'
   or result->'window' is distinct from jsonb_build_object('from',(window_end-interval '3 months')::date,'to',window_end-1)
   or result->'rebuild' is distinct from '{"state":"ok","since":null,"reason":null}'::jsonb
   or result->'blockingItems' is distinct from '[]'::jsonb or result->>'blockingCount' is distinct from '0'
   or result->>'coveredFrom' is distinct from ((window_end-interval '3 months')::date)::text
   or result->>'coveredTo' is distinct from (window_end-1)::text
   or result->>'importedAt' is null or jsonb_array_length(result->'months')<>3 then raise exception 'Gateway contract values differ: %',result;end if;
  ordinal:=0;
  for row_value in select value from jsonb_array_elements(result->'months') loop
   if row_value is distinct from jsonb_build_object('month',to_char(window_end-interval '3 months'+ordinal*interval '1 month','YYYY-MM'),
    'appNetPaise',0,'tallyNetPaise',null,'differencePaise',null,'state','no_control') then raise exception 'Month contract differs: %',row_value;end if;
   ordinal:=ordinal+1;
  end loop;
 end loop;
 -- CASE P3.13: gateway secret, caller-supplied scope and missing roles fail closed.
 denied:=false;
 begin
  perform public.stockflow_economics_gateway('wrong-key','coverage-accounts@test.invalid','get_sales_coverage','{}');
 exception when sqlstate '42501' then denied:=true;end;
 if not denied then raise exception 'Invalid gateway secret admitted';end if;
 denied:=false;
 begin
  perform public.stockflow_economics_gateway('sales-coverage-test-key','unknown@test.invalid','get_sales_coverage','{}');
 exception when sqlstate '42501' then denied:=true;end;
 if not denied then raise exception 'Missing member admitted';end if;
 denied:=false;
 begin
  perform public.stockflow_economics_gateway('sales-coverage-test-key','coverage-accounts@test.invalid','get_sales_coverage','{"companyId":"other"}');
 exception when sqlstate '22023' then denied:=true;end;
 if not denied then raise exception 'Caller company override admitted';end if;
 -- CASE P3.14: company-wide blockers remain valid contract string identifiers.
 insert into private.stockflow_economic_import_exceptions(company_id,reason,evidence,recorded_at)
 values('gateway-coverage','connector error','{}',clock_timestamp());
 result:=public.stockflow_economics_gateway('sales-coverage-test-key','coverage-accounts@test.invalid','get_sales_coverage','{}');
 if result->>'complete' is distinct from 'false' or result->'blockingItems'->0->>'sourceId' is distinct from 'Company-wide' then raise exception 'Company-wide contract blocker failed';end if;
 select array_agg(k order by k) into actual_keys from jsonb_object_keys(result->'blockingItems'->0) k;
 if actual_keys is distinct from array['reason','recordedAt','sourceId'] then raise exception 'Blocker contract keys differ';end if;
 execute roles_definition;
end$authorization$;
rollback;
