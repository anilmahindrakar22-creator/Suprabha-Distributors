-- Disposable fixtures only; all writes roll back. Envelope follows economic_omission_scope.sql.
begin;
set local statement_timeout='120s';
set local lock_timeout='10s';
create function pg_temp.ve_assert(ok boolean,label text) returns void language plpgsql as $$
begin
 if ok is distinct from true then raise exception 'Voucher exclusions: %',label; end if;
end $$;
create function pg_temp.ve_call(payload jsonb,actor text default 've-manager@test.local',gateway_key text default 've-key') returns jsonb language sql as $$
 select public.stockflow_economics_gateway(gateway_key,actor,'exclude_accounting_only_sale',payload)
$$;
create function pg_temp.ve_import(p_company text,p_voucher jsonb) returns void language sql as $$
 update public.stockflow_snapshots set payload=jsonb_build_object('catalog','[]'::jsonb,'economicEvidence',
  jsonb_build_object('schemaVersion',1,'companyId',p_company,'sourceVersion',clock_timestamp()::text,
   'completeWindow',false,'vouchers',jsonb_build_array(p_voucher))) where id='suprabha'
$$;
insert into public.stockflow_snapshots(id,company,fetched_at,payload)
 values('suprabha','SUPRABHA DISTRIBUTORS',now()::text,'{"catalog":[]}'::jsonb) on conflict(id) do nothing;
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('ve-key','sha256'),'hex') where name='orders';
insert into public.stockflow_members(email,role,roles,status) values
 ('ve-manager@test.local','management',array['management'],'active'),
 ('ve-ops@test.local','operations',array['operations'],'active');

do $test$
declare company text:='ve-company-'||extensions.gen_random_uuid()::text;
 voucher jsonb; payload jsonb; result jsonb; bad jsonb; problem_id bigint; prior_problem_id bigint; db_role text;
begin
 voucher:='{"sourceId":"GST-1","revision":"1","date":"2026-11-25","voucherNumber":"GST/1","kind":"non_economic","voucherType":"GST SALE","classificationPolicy":"owner_excluded_v1","exclusionReason":"Owner confirmed charges","amountStatus":"verified","lines":[]}'::jsonb;
 payload:=jsonb_build_object('companyId',company,'sourceId','GST-1','voucherNumber','GST/1','voucherDate','2026-11-25',
  'reason','Owner confirmed charges only','ownerDecisionRef','Owner decision 25 Nov 2026');
 perform pg_temp.ve_import(company,voucher);
 perform pg_temp.ve_assert(not exists(select 1 from private.stockflow_economic_source_vouchers where company_id=company),'unlisted voucher absent');
 select id into problem_id from private.stockflow_economic_import_exceptions where company_id=company and source_id='GST-1' and reason='Accounting-only sale needs owner exclusion';
 perform pg_temp.ve_assert(problem_id is not null and private.stockflow_economic_import_exception_open(problem_id),'unlisted voucher visible exception');
 insert into private.stockflow_economic_import_exceptions(company_id,source_id,reason,evidence,recorded_at)
  values(company,'GST-1','Accounting-only sale needs owner exclusion',voucher||'{"revision":"0","error":"Accounting-only sale needs owner exclusion"}'::jsonb,now()-interval '1 day')
  returning id into prior_problem_id;
 begin
  perform pg_temp.ve_call(payload,'ve-ops@test.local');
  raise exception 'Operations accepted';
 exception when sqlstate '42501' then
  perform pg_temp.ve_assert(sqlerrm='Data checks are restricted','operations denied');
 end;
 begin
  perform pg_temp.ve_call(payload,'ve-manager@test.local','wrong-key');
  raise exception 'Wrong key accepted';
 exception when sqlstate '42501' then null;
 end;
 for bad in select x from (values
  (payload||'{"extra":true}'::jsonb),(payload-'reason'),(payload||'{"voucherDate":"2026-02-30"}'::jsonb),
  (payload||'{"voucherDate":"25-11-2026"}'::jsonb),(payload||'{"reason":null}'::jsonb),
  (payload||'{"sourceId":"no-exception"}'::jsonb),('[]'::jsonb),('null'::jsonb),(null::jsonb)) invalid(x) loop
  begin
   perform pg_temp.ve_call(bad);
   raise exception 'Invalid exclusion accepted';
  exception when sqlstate '22023' then null;
  end;
 end loop;
 result:=pg_temp.ve_call(payload);
 perform pg_temp.ve_assert(result=jsonb_build_object('id',(result->>'id')::bigint,'sourceId','GST-1','voucherNumber','GST/1'),'action result');
 perform pg_temp.ve_assert((select approved_by='ve-manager@test.local' and reason=payload->>'reason' and owner_decision_ref=payload->>'ownerDecisionRef' and voucher_date='2026-11-25'::date
  from private.stockflow_economic_voucher_exclusions where company_id=company and source_id='GST-1'),'audit retained');
 perform pg_temp.ve_assert(pg_temp.ve_call(payload)=result,'idempotent before import');
 begin
  perform pg_temp.ve_call(payload||'{"reason":"Different owner reason"}'::jsonb);
  raise exception 'Changed values accepted';
 exception when sqlstate '23505' then null;
 end;
 perform pg_temp.ve_import(company,voucher);
 perform pg_temp.ve_assert((select count(*)=1 and bool_and(kind='non_economic') from private.stockflow_economic_source_vouchers where company_id=company and source_id='GST-1'),'listed charge imported');
 perform pg_temp.ve_assert(not exists(select 1 from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where v.company_id=company),'charge has no stock lines');
 perform pg_temp.ve_assert(not private.stockflow_economic_import_exception_open(prior_problem_id),'successful retry closes exception');
 perform pg_temp.ve_assert(pg_temp.ve_call(payload)=result,'idempotent after exception closes');
 perform pg_temp.ve_import(company,voucher||'{"revision":"2","lines":[{"lineKey":"1","productId":"ve-product","quantity":"1","unit":"pack","netSalesPaise":"10000"}]}'::jsonb);
 perform pg_temp.ve_assert(not exists(select 1 from private.stockflow_economic_source_vouchers where company_id=company and source_revision=2),'one line rejected');
 perform pg_temp.ve_assert(exists(select 1 from private.stockflow_economic_import_exceptions where company_id=company and evidence->>'revision'='2' and reason='Non-economic document needs explicit classification evidence and no economic lines'),'one line remains visible');
 -- Even a listed source cannot use the policy for purchases or credit notes.
 perform pg_temp.ve_import(company,voucher||'{"revision":"3","voucherType":"Purchase"}'::jsonb);
 perform pg_temp.ve_import(company,voucher||'{"revision":"4","voucherType":"Credit Note"}'::jsonb);
 perform pg_temp.ve_assert(not exists(select 1 from private.stockflow_economic_source_vouchers where company_id=company and source_revision in (3,4)),'purchase and credit rejected');
 perform pg_temp.ve_assert((select count(*)=2 from private.stockflow_economic_import_exceptions where company_id=company and evidence->>'revision' in ('3','4') and reason='Non-economic document needs explicit classification evidence and no economic lines'),'purchase and credit visible');
 begin
  update private.stockflow_economic_voucher_exclusions set reason=reason where company_id=company;
  raise exception 'Update accepted';
 exception when raise_exception then
  perform pg_temp.ve_assert(sqlerrm='Acknowledgements are append-only','update blocked');
 end;
 begin
  delete from private.stockflow_economic_voucher_exclusions where company_id=company;
  raise exception 'Delete accepted';
 exception when raise_exception then
  perform pg_temp.ve_assert(sqlerrm='Acknowledgements are append-only','delete blocked');
 end;
 foreach db_role in array array['anon','authenticated','service_role'] loop
  perform pg_temp.ve_assert(not has_table_privilege(db_role,'private.stockflow_economic_voucher_exclusions','SELECT,INSERT,UPDATE,DELETE'),'table private');
  perform pg_temp.ve_assert(not has_function_privilege(db_role,'private.stockflow_economic_exclude_voucher(text,jsonb)','EXECUTE'),'action private');
 end loop;
end $test$;
rollback;
