-- Disposable fixtures only; all writes roll back. Envelope follows voucher_exclusions.sql.
begin;
set local statement_timeout='120s';
set local lock_timeout='10s';
create function pg_temp.ev_assert(ok boolean,label text) returns void language plpgsql as $$
begin
 if ok is distinct from true then raise exception 'Errored voucher exclusion: %',label; end if;
end $$;
create function pg_temp.ev_call(payload jsonb,actor text default 'ev-manager@test.local',gateway_key text default 'ev-key') returns jsonb language sql as $$
 select public.stockflow_economics_gateway(gateway_key,actor,'exclude_errored_voucher',payload)
$$;
create function pg_temp.ev_import(p_company text,p_voucher jsonb,p_complete boolean default false) returns void language sql as $$
 update public.stockflow_snapshots set payload=jsonb_build_object('catalog','[]'::jsonb,'economicEvidence',
  jsonb_build_object('schemaVersion',1,'companyId',p_company,'sourceVersion',clock_timestamp()::text,
   'completeWindow',p_complete,'windowFrom','2024-11-01','windowTo','2024-12-01','vouchers',jsonb_build_array(p_voucher))) where id='suprabha'
$$;
insert into public.stockflow_snapshots(id,company,fetched_at,payload)
 values('suprabha','SUPRABHA DISTRIBUTORS',now()::text,'{"catalog":[]}'::jsonb) on conflict(id) do nothing;
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('ev-key','sha256'),'hex') where name='orders';
insert into public.stockflow_members(email,role,roles,status) values
 ('ev-manager@test.local','management',array['management'],'active'),
 ('ev-ops@test.local','operations',array['operations'],'active');

do $test$
declare company text:='ev-company-'||extensions.gen_random_uuid()::text;
 voucher jsonb; sale jsonb; payload jsonb; result jsonb; bad jsonb; db_role text; dn_exc_id bigint;
 exceptions_before bigint; coverage_before bigint;
begin
 voucher:='{"sourceId":"DN-1","revision":"100","date":"2024-11-18","voucherNumber":"DN/1","kind":"credit","voucherType":"Debit Note","amountStatus":"unverified","error":"Quantity/base-unit evidence unavailable.","lines":[]}'::jsonb;
 sale:='{"sourceId":"SALE-ERR","revision":"100","date":"2024-11-18","voucherNumber":"S/1","kind":"sale","voucherType":"Sales","amountStatus":"unverified","error":"Quantity/base-unit evidence unavailable.","lines":[]}'::jsonb;
 payload:=jsonb_build_object('companyId',company,'sourceId','DN-1','revision','100','voucherNumber','DN/1','voucherDate','2024-11-18',
  'reason','Value-only claim without quantity','ownerDecisionRef','Owner decision 28 Nov 2026');

 -- 1. Before exclusion the errored voucher is a visible exception and blocks the complete window.
 perform pg_temp.ev_import(company,voucher,true);
 select id into dn_exc_id from private.stockflow_economic_import_exceptions
  where company_id=company and source_id='DN-1' and evidence->>'revision'='100';
 perform pg_temp.ev_assert(dn_exc_id is not null and private.stockflow_economic_import_exception_open(dn_exc_id),'errored voucher visible exception');
 perform pg_temp.ev_assert(not exists(select 1 from private.stockflow_economic_source_coverage where company_id=company),'complete window not finalized');
 perform pg_temp.ev_import(company,sale);
 perform pg_temp.ev_assert(exists(select 1 from private.stockflow_economic_import_exceptions where company_id=company and source_id='SALE-ERR'),'sale exception recorded');

 -- 2. The action.
 begin
  perform pg_temp.ev_call(payload,'ev-ops@test.local');
  raise exception 'Operations accepted';
 exception when sqlstate '42501' then
  perform pg_temp.ev_assert(sqlerrm='Data checks are restricted','operations denied');
 end;
 begin
  perform pg_temp.ev_call(payload,'ev-manager@test.local','wrong-key');
  raise exception 'Wrong key accepted';
 exception when sqlstate '42501' then null;
 end;
 for bad in select x from (values
  (payload||'{"extra":true}'::jsonb),(payload-'reason'),(payload-'revision'),(payload||'{"revision":"x1"}'::jsonb),
  (payload||'{"revision":"1234567890123456789"}'::jsonb),(payload||'{"revision":100}'::jsonb),
  (payload||'{"voucherDate":"2024-02-30"}'::jsonb),(payload||'{"voucherDate":"18-11-2024"}'::jsonb),
  (payload||'{"reason":null}'::jsonb),(payload||'{"reason":"short"}'::jsonb),
  (payload||'{"sourceId":"no-exception"}'::jsonb),(payload||'{"revision":"99"}'::jsonb),
  (payload||'{"sourceId":"SALE-ERR","voucherNumber":"S/1"}'::jsonb),
  ('[]'::jsonb),('null'::jsonb),(null::jsonb)) invalid(x) loop
  begin
   perform pg_temp.ev_call(bad);
   raise exception 'Invalid exclusion accepted';
  exception when sqlstate '22023' then null;
  end;
 end loop;
 perform pg_temp.ev_assert(not exists(select 1 from private.stockflow_economic_errored_voucher_exclusions where company_id=company),'refusals recorded nothing');
 result:=pg_temp.ev_call(payload);
 perform pg_temp.ev_assert((result->>'acknowledged')::integer>=1 and result->>'sourceId'='DN-1' and result->>'revision'='100' and (result->>'id')::bigint>0,'action result');
 perform pg_temp.ev_assert((select approved_by='ev-manager@test.local' and reason=payload->>'reason' and owner_decision_ref=payload->>'ownerDecisionRef'
   and voucher_date='2024-11-18'::date and voucher_type='Debit Note' and source_revision=100
  from private.stockflow_economic_errored_voucher_exclusions where company_id=company and source_id='DN-1'),'audit retained');
 perform pg_temp.ev_assert(pg_temp.ev_call(payload)=result,'idempotent');
 begin
  perform pg_temp.ev_call(payload||'{"reason":"Different owner reason"}'::jsonb);
  raise exception 'Changed values accepted';
 exception when sqlstate '23505' then null;
 end;
 perform pg_temp.ev_assert((select count(*)=1 and bool_and(acknowledged_count=(result->>'acknowledged')::integer and acknowledged_by='ev-manager@test.local'
   and position('Owner decision 28 Nov 2026' in reason)>0)
  from private.stockflow_economic_import_exception_ack_actions where reason_group='errored_voucher_exclusion' and position('Owner decision 28 Nov 2026' in reason)>0
   and id in(select action_id from private.stockflow_economic_import_exception_acks a where a.exception_id=dn_exc_id)),'ack action audited');

 -- 3. After exclusion.
 perform pg_temp.ev_assert(not private.stockflow_economic_import_exception_open(dn_exc_id),'exception acknowledged');
 perform pg_temp.ev_assert(private.stockflow_economic_import_exception_open((select id from private.stockflow_economic_import_exceptions where company_id=company and source_id='SALE-ERR' limit 1)),'other exception stays open');
 select count(*) into exceptions_before from private.stockflow_economic_import_exceptions where company_id=company;
 select count(*) into coverage_before from private.stockflow_economic_source_coverage where company_id=company;
 perform pg_temp.ev_import(company,voucher,true);
 perform pg_temp.ev_assert((select count(*) from private.stockflow_economic_import_exceptions where company_id=company)=exceptions_before,'re-upload adds no exception');
 perform pg_temp.ev_assert((select count(*) from private.stockflow_economic_source_coverage where company_id=company)=coverage_before+1,'complete window finalizes');
 perform pg_temp.ev_assert(not exists(select 1 from private.stockflow_economic_source_vouchers where company_id=company and source_id='DN-1'),'skipped voucher imports nothing');
 perform pg_temp.ev_import(company,voucher||'{"revision":"101"}'::jsonb);
 perform pg_temp.ev_assert(exists(select 1 from private.stockflow_economic_import_exceptions e where e.company_id=company and e.source_id='DN-1' and e.evidence->>'revision'='101'
  and private.stockflow_economic_import_exception_open(e.id)),'later revision is a visible exception');
 perform pg_temp.ev_import(company,voucher||'{"revision":"102"}'::jsonb,true);
 perform pg_temp.ev_assert((select count(*) from private.stockflow_economic_source_coverage where company_id=company)=coverage_before+1,'later revision blocks the window');
 -- Only Debit Notes and the exact revision are covered.
 perform pg_temp.ev_import(company,voucher||'{"voucherType":"Sales","kind":"sale"}'::jsonb);
 perform pg_temp.ev_assert((select count(*)=1 from private.stockflow_economic_import_exceptions where company_id=company and source_id='DN-1' and evidence->>'revision'='100' and evidence->>'voucherType'='Sales'),'non Debit Note not covered');

 -- 4. Append-only and private.
 begin
  update private.stockflow_economic_errored_voucher_exclusions set reason=reason where company_id=company;
  raise exception 'Update accepted';
 exception when raise_exception then
  perform pg_temp.ev_assert(sqlerrm='Acknowledgements are append-only','update blocked');
 end;
 begin
  delete from private.stockflow_economic_errored_voucher_exclusions where company_id=company;
  raise exception 'Delete accepted';
 exception when raise_exception then
  perform pg_temp.ev_assert(sqlerrm='Acknowledgements are append-only','delete blocked');
 end;
 foreach db_role in array array['anon','authenticated','service_role'] loop
  perform pg_temp.ev_assert(not has_table_privilege(db_role,'private.stockflow_economic_errored_voucher_exclusions','SELECT,INSERT,UPDATE,DELETE'),'table private');
  perform pg_temp.ev_assert(not has_function_privilege(db_role,'private.stockflow_economic_exclude_errored_voucher(text,jsonb)','EXECUTE'),'action private');
 end loop;
 raise notice 'PASS errored voucher exclusion';
end $test$;
rollback;
