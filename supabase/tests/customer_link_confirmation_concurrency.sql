-- Disposable database, autocommit required: independent sessions need committed fixtures.
-- Append-only identities/events intentionally remain in this disposable database.
create extension if not exists dblink with schema public;
begin;
insert into public.stockflow_snapshots(id,company,fetched_at,payload)
 values('suprabha','SUPRABHA TEST',now()::text,'{}') on conflict(id) do nothing;
create temp table customer_link_lock_original as select payload from public.stockflow_snapshots where id='suprabha';
create temp table customer_link_original_activity as select id,active from private.stockflow_customers;
insert into private.stockflow_customers(id,name,tally_key,created_by_email) values
 ('15110000-0000-4000-8000-000000000001','Link Lock One','Link Lock One','test'),
 ('15110000-0000-4000-8000-000000000002','Link Lock Two','Link Lock Two','test');
update public.stockflow_snapshots set payload=jsonb_build_object('economicEvidence',jsonb_build_object(
 'schemaVersion','1','companyId','link-lock-company','sourceVersion','2026-10-15T12:00:00Z',
 'completeWindow',true,'windowFrom','2026-10-01','windowTo','2026-11-01','vouchers','[]'::jsonb,
 'customerLedgers','[{"guid":"lock-one","name":"Link Lock One"},{"guid":"lock-two","name":"Link Lock Two"}]'::jsonb)) where id='suprabha';
-- Capture SQLSTATE from each independent confirmer, including any deadlock.
create function private.stockflow_test_link_confirm(p_customer text,p_guid text,p_key text) returns text
language plpgsql set search_path=pg_catalog,private as $$
begin
 perform private.stockflow_customer_link_command('link-lock@test.local',array['management'],'confirm_customer_links',
  jsonb_build_object('companyId','link-lock-company','sourceVersion','2026-10-15T12:00:00Z',
   'rows',jsonb_build_array(jsonb_build_object('customerId',p_customer,'ledgerGuid',p_guid)),
   'reason','Concurrency fixture person confirmation','idempotencyKey',p_key));
 return 'ok';
exception when others then return sqlstate;
end$$;
commit;
set statement_timeout='15s';
do $concurrency$
declare v_connection text;v_result text;v_deadline timestamptz;v_waiting boolean;v_b_pid integer;
begin
 v_connection:=format('host=127.0.0.1 port=%s dbname=%s user=%s',current_setting('port'),current_database(),current_user);
 perform public.dblink_connect('link_a',v_connection);
 perform public.dblink_connect('link_b',v_connection);
 select pid into v_b_pid from public.dblink('link_b','select pg_backend_pid()') as t(pid integer);
 perform public.dblink_exec('link_a','set statement_timeout=''10s''');
 perform public.dblink_exec('link_b','set statement_timeout=''10s''');
 perform public.dblink_exec('link_a','begin');
 -- A owns economics; B owns the customer row first, as an overlapping snapshot can.
 perform r from public.dblink('link_a',$q$select pg_advisory_xact_lock(hashtextextended('instrument-economics-v1',0))::text$q$) as t(r text);
 perform public.dblink_exec('link_b','begin');
 perform public.dblink_exec('link_b',$q$update private.stockflow_customers set city='Concurrent upload' where id='15110000-0000-4000-8000-000000000001'$q$);
 perform public.dblink_send_query('link_b',$q$update public.stockflow_snapshots set payload=jsonb_build_object(
  'customers',jsonb_build_array(jsonb_build_object('tallyKey','Link Lock One','name','Link Lock One'),jsonb_build_object('tallyKey','Link Lock Two','name','Link Lock Two')),
  'economicEvidence',jsonb_build_object('schemaVersion','1','companyId','link-lock-company','sourceVersion','2026-10-15T12:00:00Z','vouchers','[]'::jsonb))
  where id='suprabha'$q$);
 v_deadline:=clock_timestamp()+interval '4 seconds';v_waiting:=false;
 while clock_timestamp()<v_deadline loop
  perform pg_stat_clear_snapshot();
  select exists(select 1 from pg_stat_activity where pid=v_b_pid and wait_event='advisory') into v_waiting;
  exit when v_waiting;
  perform pg_sleep(0.02);
 end loop;
 if not v_waiting then raise exception 'Snapshot did not wait for the economics lock';end if;
 select r into v_result from public.dblink('link_a',$q$select private.stockflow_test_link_confirm('15110000-0000-4000-8000-000000000001','lock-one','link-lock-upload-0001')$q$) as t(r text);
 if v_result<>'ok' then raise exception 'Confirmation during upload failed: %',v_result;end if;
 perform public.dblink_exec('link_a','commit');
 perform r from public.dblink_get_result('link_b') as t(r text);
 perform r from public.dblink_get_result('link_b') as t(r text);
 perform public.dblink_exec('link_b','commit');
 if not exists(select 1 from private.stockflow_economic_customer_identities where company_id='link-lock-company' and source_id='lock-one')
  or not exists(select 1 from private.stockflow_customers where id='15110000-0000-4000-8000-000000000001' and city='Concurrent upload') then raise exception 'Overlapping operations did not complete';end if;

 perform public.dblink_exec('link_a','begin');
 select r into v_result from public.dblink('link_a',$q$select private.stockflow_test_link_confirm('15110000-0000-4000-8000-000000000002','lock-two','link-lock-first-00001')$q$) as t(r text);
 if v_result<>'ok' then raise exception 'First confirmer failed: %',v_result;end if;
 perform public.dblink_send_query('link_b',$q$select private.stockflow_test_link_confirm('15110000-0000-4000-8000-000000000002','lock-two','link-lock-second-0001')$q$);
 v_deadline:=clock_timestamp()+interval '4 seconds';v_waiting:=false;
 while clock_timestamp()<v_deadline loop
  perform pg_stat_clear_snapshot();
  select exists(select 1 from pg_stat_activity where pid=v_b_pid and wait_event='advisory') into v_waiting;
  exit when v_waiting;
  perform pg_sleep(0.02);
 end loop;
 if not v_waiting then raise exception 'Second confirmer did not wait for the economics lock';end if;
 perform public.dblink_exec('link_a','commit');
 select r into v_result from public.dblink_get_result('link_b') as t(r text);
 if v_result is distinct from 'PT409' then raise exception 'Second confirmer expected PT409, got %',v_result;end if;
 perform r from public.dblink_get_result('link_b') as t(r text);
 if (select count(*) from private.stockflow_customer_identity_events where company_id='link-lock-company')<>2 then raise exception 'Concurrent confirmation duplicated events';end if;
 perform public.dblink_disconnect('link_a');perform public.dblink_disconnect('link_b');
exception when others or query_canceled then
 if 'link_a'=any(coalesce(public.dblink_get_connections(),array[]::text[])) then perform public.dblink_disconnect('link_a');end if;
 if 'link_b'=any(coalesce(public.dblink_get_connections(),array[]::text[])) then perform public.dblink_disconnect('link_b');end if;
 raise;
end$concurrency$;
reset statement_timeout;
update public.stockflow_snapshots set payload=(select payload from customer_link_lock_original) where id='suprabha';
update private.stockflow_customers c set active=s.active from customer_link_original_activity s where c.id=s.id;
drop table customer_link_lock_original;
drop table customer_link_original_activity;
drop function private.stockflow_test_link_confirm(text,text,text);
