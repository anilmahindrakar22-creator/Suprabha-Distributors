begin;
set local timezone = 'UTC';
create temporary table rename_guid_results(label text, passed boolean, detail text) on commit drop;
insert into public.stockflow_snapshots(id,company,fetched_at,payload)
 values('suprabha','SUPRABHA TEST',now()::text,jsonb_build_object()) on conflict(id) do nothing;
insert into private.stockflow_customers(id,name,tally_key,created_by_email) values
 ('17100000-0000-4000-8000-000000000001','Ren A','Ren A','test'),
 ('17100000-0000-4000-8000-000000000002','Old A','Old A','test'),
 ('17100000-0000-4000-8000-000000000003','Busy A','Busy A','test'),
 ('17100000-0000-4000-8000-000000000004','Busy B','Busy B','test');
update public.stockflow_snapshots set payload=jsonb_build_object('economicEvidence',jsonb_build_object(
 'schemaVersion','1','companyId','rename-guid-company','sourceVersion','2026-10-20T10:00:00Z',
 'vouchers',jsonb_build_array(),'customerLedgers',jsonb_build_array(
 jsonb_build_object('guid','G1','name','Ren A'),jsonb_build_object('guid','G2','name','Old A'),
 jsonb_build_object('guid','G3','name','Busy A')))) where id='suprabha';
select private.stockflow_customer_link_command('test',array['management'],'confirm_customer_links',jsonb_build_object(
 'companyId','rename-guid-company','sourceVersion','2026-10-20T10:00:00Z','reason','Reviewed exact names',
 'idempotencyKey','rename-guid-confirm-0001','rows',jsonb_build_array(
 jsonb_build_object('customerId','17100000-0000-4000-8000-000000000001','ledgerGuid','G1'),
 jsonb_build_object('customerId','17100000-0000-4000-8000-000000000002','ledgerGuid','G2'),
 jsonb_build_object('customerId','17100000-0000-4000-8000-000000000003','ledgerGuid','G3'))));

do $test$
declare v_count bigint; v_identities bigint; v_events bigint; v_payload jsonb; v_before jsonb; v_after jsonb;
 v_duplicate uuid; v_error text; v_ok boolean; v_import_exceptions bigint; v_update_blocked boolean:=false; v_delete_blocked boolean:=false;
begin
 select count(*) into v_count from private.stockflow_customers;
 update public.stockflow_snapshots set payload=jsonb_build_object('marker','rg1','customers',jsonb_build_array(
  jsonb_build_object('tallyKey','Ren B','name','Ren B','guid','G1'))) where id='suprabha';
 insert into rename_guid_results values('RG1',
  exists(select 1 from private.stockflow_customers where id='17100000-0000-4000-8000-000000000001' and tally_key='Ren B' and name='Ren B' and active)
  and not exists(select 1 from private.stockflow_customers where tally_key='Ren B' and id<>'17100000-0000-4000-8000-000000000001')
  and (select count(*) from private.stockflow_customers)=v_count,'customer list first preserves linked UUID and count');
 v_payload:=jsonb_build_object('marker','rg2','customers',jsonb_build_array(jsonb_build_object('tallyKey','Ren B','name','Ren B','guid','G1')),
  'economicEvidence',jsonb_build_object('schemaVersion','1','companyId','rename-guid-company','sourceVersion','2026-10-21T10:00:00Z',
  'vouchers',jsonb_build_array(),'customerLedgers',jsonb_build_array(jsonb_build_object('guid','G1','name','Ren B'),
  jsonb_build_object('guid','G2','name','Old A'),jsonb_build_object('guid','G3','name','Busy A'))));
 begin update public.stockflow_snapshots set payload=v_payload where id='suprabha';
 exception when others then v_error:=sqlstate||': '||sqlerrm; end;
 insert into rename_guid_results values('RG2',v_error is null
  and (select payload->>'marker' from public.stockflow_snapshots where id='suprabha')='rg2'
  and exists(select 1 from private.stockflow_customers where id='17100000-0000-4000-8000-000000000001' and tally_key='Ren B' and name='Ren B' and active),
  coalesce(v_error,'ledger catch-up upload commits'));

 -- Old connector still follows the name path, producing a split before catch-up.
 select count(*) into v_import_exceptions from private.stockflow_economic_import_exceptions;
 update public.stockflow_snapshots set payload=jsonb_build_object('marker','old-split','customers',jsonb_build_array(
  jsonb_build_object('tallyKey','Old B','name','Old B'))) where id='suprabha';
 select id into strict v_duplicate from private.stockflow_customers where tally_key='Old B';
 if v_duplicate='17100000-0000-4000-8000-000000000002' or
  (select active from private.stockflow_customers where id='17100000-0000-4000-8000-000000000002') then
  raise exception 'RG3 fixture did not reproduce old-connector split';end if;
 select jsonb_agg(to_jsonb(c) order by id) into v_before from private.stockflow_customers c
  where id in ('17100000-0000-4000-8000-000000000002',v_duplicate);
 v_payload:=jsonb_build_object('marker','rg3','customers',jsonb_build_array(jsonb_build_object('tallyKey','Old B','name','Changed by conflict')),
  'economicEvidence',jsonb_build_object('schemaVersion','1','companyId','rename-guid-company','sourceVersion','2026-10-22T10:00:00Z',
  'vouchers',jsonb_build_array(),'customerLedgers',jsonb_build_array(jsonb_build_object('guid','G1','name','Ren B'),
  jsonb_build_object('guid','G2','name','Old B'),jsonb_build_object('guid','G3','name','Busy A'))));
 v_error:=null;
 begin
  update public.stockflow_snapshots set payload=v_payload where id='suprabha';
  update public.stockflow_snapshots set payload=v_payload where id='suprabha';
 exception when others then v_error:=sqlstate||': '||sqlerrm;end;
 select jsonb_agg(to_jsonb(c) order by id) into v_after from private.stockflow_customers c
  where id in ('17100000-0000-4000-8000-000000000002',v_duplicate);
 insert into rename_guid_results values('RG3',v_error is null and v_before=v_after
  and (select payload->>'marker' from public.stockflow_snapshots where id='suprabha')='rg3'
  and (select count(*) from private.stockflow_customer_sync_conflicts
   where customer_id='17100000-0000-4000-8000-000000000002'
   and tally_key='Old B' and conflicting_customer_id=v_duplicate
   and nullif(reason,'') is not null and recorded_on=(clock_timestamp() at time zone 'UTC')::date)=1,
  coalesce(v_error,'old split untouched; conflict recorded once per UTC day'));

 select count(*) into v_identities from private.stockflow_economic_customer_identities;
 select count(*) into v_events from private.stockflow_customer_identity_events;
 update public.stockflow_snapshots set payload=jsonb_build_object('customers',jsonb_build_array(
  jsonb_build_object('tallyKey','Free X','name','Free X','guid','G9'))) where id='suprabha';
 insert into rename_guid_results values('RG4',exists(select 1 from private.stockflow_customers where tally_key='Free X' and active)
  and (select count(*) from private.stockflow_economic_customer_identities)=v_identities
  and (select count(*) from private.stockflow_customer_identity_events)=v_events,'unlinked guid creates no identity or identity event');

 select jsonb_agg(to_jsonb(c) order by id) into v_before from private.stockflow_customers c
  where id in ('17100000-0000-4000-8000-000000000003','17100000-0000-4000-8000-000000000004');
 v_payload:=jsonb_build_object('marker','rg5','customers',jsonb_build_array(
  jsonb_build_object('tallyKey','Busy B','name','Changed by guid conflict','guid','G3')));
 v_error:=null;
 begin
  update public.stockflow_snapshots set payload=v_payload where id='suprabha';
  update public.stockflow_snapshots set payload=v_payload where id='suprabha';
 exception when others then v_error:=sqlstate||': '||sqlerrm;end;
 select jsonb_agg(to_jsonb(c) order by id) into v_after from private.stockflow_customers c
  where id in ('17100000-0000-4000-8000-000000000003','17100000-0000-4000-8000-000000000004');
 insert into rename_guid_results values('RG5',v_error is null and v_before=v_after
  and (select payload->>'marker' from public.stockflow_snapshots where id='suprabha')='rg5'
  and (select count(*) from private.stockflow_customer_sync_conflicts
   where customer_id='17100000-0000-4000-8000-000000000003'
   and tally_key='Busy B' and conflicting_customer_id='17100000-0000-4000-8000-000000000004'
   and guid='G3' and nullif(reason,'') is not null and recorded_on=(clock_timestamp() at time zone 'UTC')::date)=1,
  coalesce(v_error,'guid conflict leaves both customers untouched and deduplicates'));
 insert into rename_guid_results values('RG7',
  (select count(*) from private.stockflow_economic_import_exceptions)=v_import_exceptions,
  'customer conflicts add no finance import exceptions');
 begin
  update private.stockflow_customer_sync_conflicts set reason='Changed'
   where customer_id='17100000-0000-4000-8000-000000000002' and tally_key='Old B';
 exception when insufficient_privilege then v_update_blocked:=true;end;
 begin
  delete from private.stockflow_customer_sync_conflicts
   where customer_id='17100000-0000-4000-8000-000000000002' and tally_key='Old B';
 exception when insufficient_privilege then v_delete_blocked:=true;end;
 insert into rename_guid_results values('RG8',v_update_blocked and v_delete_blocked,
  'direct conflict update and delete both raise');
 -- Isolate the selector assertion from earlier upload rollback on the unfixed code.
 update public.stockflow_snapshots set payload=v_payload-'customers'||jsonb_build_object('economicEvidence',jsonb_build_object(
  'schemaVersion','1','companyId','rename-guid-company','sourceVersion','2026-10-22T10:00:00Z','vouchers',jsonb_build_array(),
  'customerLedgers',jsonb_build_array(jsonb_build_object('guid','G1','name','Ren B'),jsonb_build_object('guid','G2','name','Old B'),
  jsonb_build_object('guid','G3','name','Busy A')))) where id='suprabha';
 insert into rename_guid_results values('RG6',
  exists(select 1 from private.stockflow_customer_sync_conflicts where customer_id='17100000-0000-4000-8000-000000000002' and tally_key='Old B')
  and exists(select 1 from private.stockflow_customer_sync_conflicts where customer_id='17100000-0000-4000-8000-000000000003' and tally_key='Busy B')
  and private.stockflow_current_ledger_generation('rename-guid-company')='2026-10-22T10:00:00Z',
  'sync conflict evidence does not reject ledger generation');
 for v_error,v_ok in select label||': '||detail,passed from rename_guid_results order by label loop
  raise notice '% %',case when v_ok then 'PASS' else 'FAIL' end,v_error;
 end loop;
 if exists(select 1 from rename_guid_results where passed is distinct from true) then
  raise exception 'Customer rename regression failures: %',(select string_agg(label,', ' order by label) from rename_guid_results where passed is distinct from true);
 end if;
end$test$;
rollback;
