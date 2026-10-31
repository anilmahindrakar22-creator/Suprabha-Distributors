begin;
set local timezone = 'UTC';
create temporary table auto_link_results(label text, passed boolean, detail text) on commit drop;
insert into public.stockflow_snapshots(id,company,fetched_at,payload)
 values('suprabha','SUPRABHA TEST',now()::text,jsonb_build_object()) on conflict(id) do nothing;
insert into private.stockflow_customers(id,name,tally_key,created_by_email) values
 ('18100000-0000-4000-8000-000000000001','Auto A','Auto A','test'),
 ('18100000-0000-4000-8000-000000000002','Auto B','Auto B','test'),
 ('18100000-0000-4000-8000-000000000003','Auto C','Auto C','test'),
 ('18100000-0000-4000-8000-000000000004','Auto D','Auto D','test'),
 ('18100000-0000-4000-8000-000000000005','Auto Visit',null,'test'),
 ('18100000-0000-4000-8000-000000000006','Auto Existing','Auto Existing','test'),
 ('18100000-0000-4000-8000-000000000007','Auto Occupied','Auto Occupied','test'),
 ('18100000-0000-4000-8000-000000000008','Auto Holder','Auto Holder','test');

do $test$
declare v_payload jsonb; v_ledgers jsonb; v_read jsonb; v_suggested uuid[];
 v_identities bigint; v_events bigint; v_exceptions bigint; v_start timestamptz; v_elapsed interval;
 v_error text; v_ok boolean; v_fail boolean:=false;
begin
 select count(*) into v_exceptions from private.stockflow_economic_import_exceptions;
 v_ledgers:=jsonb_build_array(
  jsonb_build_object('guid','GA1','name','Auto A'),jsonb_build_object('guid','GA2','name','Auto B'),
  jsonb_build_object('guid','GC','name','Auto C'),jsonb_build_object('guid','GD','name','Auto D'),
  jsonb_build_object('guid','GV','name','Auto Visit'),jsonb_build_object('guid','GE','name','Auto Existing'),
  jsonb_build_object('guid','GO','name','Auto Occupied'),jsonb_build_object('guid','GH','name','Auto Holder'));
 update public.stockflow_snapshots set payload=jsonb_build_object('economicEvidence',jsonb_build_object(
  'schemaVersion','1','companyId','auto-link-company','sourceVersion','2026-10-25T10:00:00Z',
  'vouchers',jsonb_build_array(),'customerLedgers',v_ledgers)) where id='suprabha';
 -- Seed existing links with the real manual command before moving their names.
 perform private.stockflow_customer_link_command('test',array['management'],'confirm_customer_links',jsonb_build_object(
  'companyId','auto-link-company','sourceVersion','2026-10-25T10:00:00Z','reason','Manual fixture review',
  'idempotencyKey','auto-link-manual-fixture-0001','rows',jsonb_build_array(
   jsonb_build_object('customerId','18100000-0000-4000-8000-000000000006','ledgerGuid','GE'),
   jsonb_build_object('customerId','18100000-0000-4000-8000-000000000008','ledgerGuid','GH'))));
 -- GE no longer matches the existing customer; GH now matches the unlinked customer.
 v_ledgers:=jsonb_build_array(
  jsonb_build_object('guid','GA1','name','Auto A'),jsonb_build_object('guid','GA2','name','Auto B'),
  jsonb_build_object('guid','GC','name','Auto C'),jsonb_build_object('guid','GD','name','Auto D'),
  jsonb_build_object('guid','GV','name','Auto Visit'),jsonb_build_object('guid','GE','name','Auto Old'),
  jsonb_build_object('guid','GNEW','name','Auto Existing'),jsonb_build_object('guid','GH','name','Auto Occupied'));
 update public.stockflow_snapshots set payload=jsonb_build_object('economicEvidence',jsonb_build_object(
  'schemaVersion','1','companyId','auto-link-company','sourceVersion','2026-10-26T10:00:00Z',
  'vouchers',jsonb_build_array(),'customerLedgers',v_ledgers)) where id='suprabha';
 v_read:=private.stockflow_customer_link_command('test',array['management'],'get_link_suggestions',
  jsonb_build_object('companyId','auto-link-company'));
 select array_agg((r->>'customerId')::uuid) into v_suggested from jsonb_array_elements(v_read->'rows') r where r->>'state'='suggested';
 v_payload:=jsonb_build_object('marker','al1','customers',jsonb_build_array(
  jsonb_build_object('tallyKey','Auto A','name','Auto A','guid','GA1'),
  jsonb_build_object('tallyKey','Auto B','name','Auto B','guid','GA2'),
  jsonb_build_object('tallyKey','Auto C','name','Auto C'),
  jsonb_build_object('tallyKey','Auto D','name','Auto D','guid','GX'),
  jsonb_build_object('tallyKey','Auto Visit','name','Auto Visit','guid','GV'),
  jsonb_build_object('tallyKey','Auto Existing','name','Auto Existing','guid','GNEW'),
  jsonb_build_object('tallyKey','Auto Occupied','name','Auto Occupied','guid','GH')));
 update public.stockflow_snapshots set payload=v_payload where id='suprabha';
 insert into auto_link_results values('AL1',
  (select count(*) from private.stockflow_economic_customer_identities where company_id='auto-link-company'
   and ((source_id='GA1' and customer_id='18100000-0000-4000-8000-000000000001')
    or (source_id='GA2' and customer_id='18100000-0000-4000-8000-000000000002')) and verified_by='tally-auto-link')=2
  and (select count(*) from private.stockflow_customer_identity_events where company_id='auto-link-company' and source_id in ('GA1','GA2'))=2
  and (select count(*) from private.stockflow_customer_identity_events where company_id='auto-link-company'
   and ((source_id='GA1' and ledger_name_at_confirmation='Auto A') or (source_id='GA2' and ledger_name_at_confirmation='Auto B'))
   and action='confirmed' and actor='tally-auto-link'
   and reason='Automatic exact Tally ledger and GUID match (owner direction, 31 Oct 2026)'
   and source_version='2026-10-26T10:00:00Z' and request_id='tally-auto-link:2026-10-26T10:00:00Z')=2,
  'exact names and GUIDs link with immutable provenance');
 insert into auto_link_results values('AL2',not exists(select 1 from private.stockflow_economic_customer_identities
  where company_id='auto-link-company' and customer_id='18100000-0000-4000-8000-000000000003'),'missing payload GUID stays manual');
 insert into auto_link_results values('AL3',not exists(select 1 from private.stockflow_economic_customer_identities
  where company_id='auto-link-company' and customer_id='18100000-0000-4000-8000-000000000004'),'mismatching GUID stays manual');
 insert into auto_link_results values('AL4',not exists(select 1 from private.stockflow_economic_customer_identities
  where company_id='auto-link-company' and source_id='GV') and exists(select 1 from private.stockflow_customers
  where id='18100000-0000-4000-8000-000000000005' and tally_key is null),'visit customer stays manual');
 insert into auto_link_results values('AL5',
  (select count(*) from private.stockflow_economic_customer_identities where company_id='auto-link-company' and customer_id='18100000-0000-4000-8000-000000000006')=1
  and exists(select 1 from private.stockflow_economic_customer_identities where company_id='auto-link-company' and source_id='GE'
   and customer_id='18100000-0000-4000-8000-000000000006' and verified_by='test')
  and exists(select 1 from private.stockflow_economic_customer_identities where company_id='auto-link-company' and source_id='GH'
   and customer_id='18100000-0000-4000-8000-000000000008' and verified_by='test')
  and not exists(select 1 from private.stockflow_economic_customer_identities where company_id='auto-link-company'
   and customer_id='18100000-0000-4000-8000-000000000007'),'existing customer and GUID identities preserved');
 select count(*) into v_identities from private.stockflow_economic_customer_identities;
 select count(*) into v_events from private.stockflow_customer_identity_events;
 update public.stockflow_snapshots set payload=v_payload where id='suprabha';
 insert into auto_link_results values('AL6',(select count(*) from private.stockflow_economic_customer_identities)=v_identities
  and (select count(*) from private.stockflow_customer_identity_events)=v_events,'repeat adds no identities or events');
 insert into auto_link_results values('AL7',
  array['18100000-0000-4000-8000-000000000001'::uuid,'18100000-0000-4000-8000-000000000002'::uuid] <@ v_suggested
  and not exists(select 1 from private.stockflow_economic_customer_identities where company_id='auto-link-company'
   and verified_by='tally-auto-link' and not(customer_id=any(v_suggested))),'AL1 customers were manually suggested before sync');

 -- A test-only failing event constraint forces an error after identity insertion.
 -- The exception subtransaction must roll back that identity, preserving customer upserts.
 alter table private.stockflow_customer_identity_events add constraint auto_link_test_failure
  check(actor <> 'tally-auto-link') not valid;
 update public.stockflow_snapshots set payload=jsonb_build_object('marker','al8-committed','customers',jsonb_build_array(
  jsonb_build_object('tallyKey','Auto C','name','Auto C','guid','GC'),
  jsonb_build_object('tallyKey','Auto Failure Upsert','name','Auto Failure Upsert'))) where id='suprabha';
 alter table private.stockflow_customer_identity_events drop constraint auto_link_test_failure;
 insert into auto_link_results values('AL8',
  (select payload->>'marker' from public.stockflow_snapshots where id='suprabha')='al8-committed'
  and exists(select 1 from private.stockflow_customers where tally_key='Auto Failure Upsert' and active)
  and exists(select 1 from private.stockflow_customers where tally_key='Auto C' and active)
  and not exists(select 1 from private.stockflow_economic_customer_identities where company_id='auto-link-company' and source_id='GC'),
  'forced event failure preserves snapshot and upserts; identity rolled back');
 -- Verify recovery after restoring the constraint, so AL8 cannot pass by skipping all links.
 update public.stockflow_snapshots set payload=jsonb_build_object('customers',jsonb_build_array(
  jsonb_build_object('tallyKey','Auto C','name','Auto C','guid','GC'))) where id='suprabha';
 update auto_link_results set passed=passed and exists(select 1 from private.stockflow_economic_customer_identities
  where company_id='auto-link-company' and source_id='GC' and verified_by='tally-auto-link') where label='AL8';

 select jsonb_agg(jsonb_build_object('guid','AUTO-TIME-'||n,'name','Auto Time '||n)) into v_ledgers from generate_series(1,400) n;
 select jsonb_build_object('customers',jsonb_agg(jsonb_build_object('tallyKey','Auto Time '||n,'name','Auto Time '||n,'guid','AUTO-TIME-'||n)),
  'economicEvidence',jsonb_build_object('schemaVersion','1','companyId','auto-link-company','sourceVersion','2026-10-27T10:00:00Z',
   'vouchers',jsonb_build_array(),'customerLedgers',v_ledgers)) into v_payload from generate_series(1,400) n;
 v_start:=clock_timestamp();
 update public.stockflow_snapshots set payload=v_payload where id='suprabha';
 v_elapsed:=clock_timestamp()-v_start;
 insert into auto_link_results values('AL9',v_elapsed<interval '2 seconds'
  and (select count(*) from private.stockflow_economic_customer_identities where company_id='auto-link-company' and source_id like 'AUTO-TIME-%' and verified_by='tally-auto-link')=400,
  '400 links; elapsed '||v_elapsed::text);
 insert into auto_link_results values('AL10',(select count(*) from private.stockflow_economic_import_exceptions)=v_exceptions,
  'no economic import exceptions');
 for v_error,v_ok in select label||': '||detail,passed from auto_link_results order by substring(label from 3)::integer loop
  raise notice '% %',case when v_ok then 'PASS' else 'FAIL' end,v_error;
  v_fail:=v_fail or v_ok is distinct from true;
 end loop;
 if v_fail then raise exception 'Customer auto-link regression failures: %',
  (select string_agg(label,', ' order by substring(label from 3)::integer) from auto_link_results where passed is distinct from true);end if;
end$test$;
rollback;
