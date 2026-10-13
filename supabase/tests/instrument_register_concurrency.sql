-- Disposable local replay database only. Fixtures commit for independent sessions.
create extension if not exists dblink with schema public;
begin;
insert into private.stockflow_customers(id,name,tally_key,created_by_email) values
 ('a1310001-7c42-4d65-9ea3-130000000001','RACE-REG customer A','RACE-REG-CUSTOMER-A','test'),
 ('a1310001-7c42-4d65-9ea3-130000000002','RACE-REG customer B','RACE-REG-CUSTOMER-B','test');
-- Delivered is an existing stockflow_order_states status; draft is not.
insert into private.stockflow_orders(id,order_number,customer_id,customer_name,source,status,created_by_email,updated_by_email,idempotency_key) values
 ('a1310001-7c42-4d65-9ea3-130000000003','RACE-REG-ORDER-A','a1310001-7c42-4d65-9ea3-130000000001','RACE-REG customer A','phone','delivered','test','test','RACE-REG-ORDER-A'),
 ('a1310001-7c42-4d65-9ea3-130000000004','RACE-REG-ORDER-B','a1310001-7c42-4d65-9ea3-130000000002','RACE-REG customer B','phone','delivered','test','test','RACE-REG-ORDER-B');
insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,quantity) values
 ('a1310001-7c42-4d65-9ea3-130000000003','RACE-REG-ITEM','RACE-REG instrument',1),
 ('a1310001-7c42-4d65-9ea3-130000000004','RACE-REG-ITEM','RACE-REG instrument',1);
insert into private.stockflow_equipment_installations(id,order_id,tally_key,item_name,status,scheduled_date,created_by_email) values
 ('a1310001-7c42-4d65-9ea3-130000000005','a1310001-7c42-4d65-9ea3-130000000003','RACE-REG-ITEM','RACE-REG instrument','scheduled',current_date,'test'),
 ('a1310001-7c42-4d65-9ea3-130000000006','a1310001-7c42-4d65-9ea3-130000000004','RACE-REG-ITEM','RACE-REG instrument','scheduled',current_date,'test');
commit;

do $test$
declare
 v_first_instrument uuid;
 v_second_instrument uuid;
 v_second_pid integer;
 v_attempt integer;
begin
 perform public.dblink_connect('register_a','dbname='||current_database()||' user='||current_user||' options=-cstatement_timeout=15000');
 perform public.dblink_connect('register_b','dbname='||current_database()||' user='||current_user||' options=-cstatement_timeout=15000');
 select pid into v_second_pid from public.dblink('register_b','select pg_backend_pid()') as t(pid integer);
 perform public.dblink_exec('register_a','begin');
 select instrument_id into v_first_instrument from public.dblink('register_a',$update$
  update private.stockflow_equipment_installations
  set status='completed',serial_number='RACE-REG-1',completed_at=now(),
   completed_by_email='test',commissioning_notes='RACE-REG commissioning A'
  where id='a1310001-7c42-4d65-9ea3-130000000005'
  returning instrument_id
 $update$) as t(instrument_id uuid);
 if v_first_instrument is null then raise exception 'First commissioning did not assign an instrument';end if;
 perform public.dblink_send_query('register_b',$update$
  update private.stockflow_equipment_installations
  set status='completed',serial_number='race reg 1',completed_at=now(),
   completed_by_email='test',commissioning_notes='RACE-REG commissioning B'
  where id='a1310001-7c42-4d65-9ea3-130000000006'
  returning instrument_id
 $update$);
 for v_attempt in 1..500 loop
  exit when exists(select 1 from pg_locks where pid=v_second_pid and not granted);
  perform pg_sleep(0.01);
 end loop;
 if not exists(select 1 from pg_locks where pid=v_second_pid and not granted) then
  raise exception 'Second commissioning did not serialize behind instrument registration';
 end if;
 perform public.dblink_exec('register_a','commit');
 -- Default fail_on_error raises any remote error: both updates must succeed.
 select instrument_id into v_second_instrument from public.dblink_get_result('register_b') as t(instrument_id uuid);
 perform * from public.dblink_get_result('register_b') as t(instrument_id uuid);
 if v_second_instrument is null or v_second_instrument is distinct from v_first_instrument then
  raise exception 'Concurrent commissioning returned different instruments: %, %',v_first_instrument,v_second_instrument;
 end if;
 if (select count(*) from private.stockflow_instruments where serial_key='RACEREG1')<>1 then
  raise exception 'Concurrent registration did not create exactly one instrument';
 end if;
 if (select id from private.stockflow_instruments where serial_key='RACEREG1') is distinct from v_first_instrument then
  raise exception 'Commissioning linked to the wrong serial instrument';
 end if;
 if (select count(*) from private.stockflow_equipment_installations
  where id in ('a1310001-7c42-4d65-9ea3-130000000005','a1310001-7c42-4d65-9ea3-130000000006')
   and status='completed' and instrument_id=v_first_instrument)<>2 then
  raise exception 'Both completed installations must link to the same instrument';
 end if;
 perform public.dblink_disconnect('register_a');
 perform public.dblink_disconnect('register_b');
end$test$;
