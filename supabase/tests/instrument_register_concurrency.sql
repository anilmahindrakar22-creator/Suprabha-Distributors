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

-- Two finance users place different installations of the same machine.
begin;
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('race-register-key','sha256'),'hex') where name='orders';
insert into public.stockflow_members(email,role,status) values
 ('race-register-a@test.local','management','active'),('race-register-b@test.local','management','active');
insert into private.stockflow_equipment_installations(id,order_id,tally_key,item_name,status,scheduled_date,created_by_email)
 values('a1310001-7c42-4d65-9ea3-130000000007','a1310001-7c42-4d65-9ea3-130000000004','RACE-REG-THIRD','RACE-REG instrument','scheduled',current_date,'test');
create function public.test_register_commission() returns text language plpgsql as $$
begin
 update private.stockflow_equipment_installations set status='completed',serial_number='RACE/REG/1',completed_at=now(),
  completed_by_email='test',commissioning_notes='Concurrent placement conflict'
  where id='a1310001-7c42-4d65-9ea3-130000000007';
 return 'ok';
exception when sqlstate 'PT409' then return sqlstate;
end$$;
revoke all on function public.test_register_commission() from public,anon,authenticated;
create function public.test_register_place(p_installation uuid,p_actor text,p_key text) returns text
language plpgsql as $$
declare c uuid;
begin
 select o.customer_id into c from private.stockflow_equipment_installations i join private.stockflow_orders o on o.id=i.order_id where i.id=p_installation;
 perform public.stockflow_economics_gateway('race-register-key',p_actor,'create_target',jsonb_build_object(
  'kind','placement','name','Race placement','companyId','race-register-company','customerId',c,
  'customerSourceId',c::text,'siteId','race-site','modelId','race-model','installationId',p_installation,
  'effectiveFrom',private.stockflow_economic_business_date(),'capitalPaise','0','idempotencyKey',p_key));
 return 'ok';
exception when sqlstate 'PT409' then return sqlstate;
-- Any other error (including unique_violation) propagates and fails the test.
end$$;
revoke all on function public.test_register_place(uuid,text,text) from public,anon,authenticated;
commit;
do $placement_race$
declare a text;b text;c text;pid_b integer;pid_c integer;attempt integer;
begin
 perform public.dblink_connect('place_a','dbname='||current_database()||' user='||current_user||' options=-cstatement_timeout=15000');
 perform public.dblink_connect('place_b','dbname='||current_database()||' user='||current_user||' options=-cstatement_timeout=15000');
 perform public.dblink_connect('place_c','dbname='||current_database()||' user='||current_user||' options=-cstatement_timeout=15000');
 select pid into pid_b from public.dblink('place_b','select pg_backend_pid()') as t(pid integer);
 select pid into pid_c from public.dblink('place_c','select pg_backend_pid()') as t(pid integer);
 perform public.dblink_exec('place_a','begin');
 select result into a from public.dblink('place_a',$q$select public.test_register_place('a1310001-7c42-4d65-9ea3-130000000005','race-register-a@test.local','race-register-place-a')$q$) as t(result text);
 if a is distinct from 'ok' then raise exception 'First placement failed: %',a;end if;
 perform public.dblink_send_query('place_b',$q$select public.test_register_place('a1310001-7c42-4d65-9ea3-130000000006','race-register-b@test.local','race-register-place-b')$q$);
 perform public.dblink_send_query('place_c','select public.test_register_commission()');
 for attempt in 1..500 loop
  exit when exists(select 1 from pg_locks where pid=pid_b and not granted)
   and exists(select 1 from pg_locks where pid=pid_c and not granted);
  perform pg_sleep(0.01);
 end loop;
 if not exists(select 1 from pg_locks where pid=pid_b and not granted) then raise exception 'Second placement did not wait';end if;
 -- C may wait on the advisory lock or on A's in-flight instrument row update; either serializes it.
 if not exists(select 1 from pg_locks where pid=pid_c and not granted) then raise exception 'Commissioning did not wait for the in-flight placement';end if;
 perform public.dblink_exec('place_a','commit');
 select result into b from public.dblink_get_result('place_b') as t(result text);
 perform * from public.dblink_get_result('place_b') as t(result text);
 if b is distinct from 'PT409' then raise exception 'Placement race requires exactly one success and one PT409: %, %',a,b;end if;
 select result into c from public.dblink_get_result('place_c') as t(result text);
 perform * from public.dblink_get_result('place_c') as t(result text);
 if c is distinct from 'PT409' then raise exception 'Commissioning raced past placed-elsewhere guard: %',c;end if;
 if (select count(*) from private.stockflow_instruments where serial_key='RACEREG1')<>1
  or (select count(*) from private.stockflow_equipment_installations i join private.stockflow_instruments m on m.id=i.instrument_id where m.serial_key='RACEREG1')<>2 then
  raise exception 'Placement/commissioning race changed instrument identity links';
 end if;
 if (select count(*) from private.stockflow_economic_targets t join private.stockflow_equipment_installations i on i.id=t.installation_id
  join private.stockflow_instruments m on m.id=i.instrument_id where m.serial_key='RACEREG1' and t.approval<>'rejected' and t.effective_to is null)<>1 then
  raise exception 'Placement race left overlapping placements';
 end if;
 perform public.dblink_disconnect('place_a');
 perform public.dblink_disconnect('place_b');
 perform public.dblink_disconnect('place_c');
end$placement_race$;

-- model already set: A's placement must serialize B and commissioning on the advisory lock.
begin;
insert into private.stockflow_customers(id,name,tally_key,created_by_email) values
 ('a1310001-7c42-4d65-9ea3-130000000008','RACE-REG-2 customer C','RACE-REG-2-CUSTOMER-C','test');
insert into private.stockflow_orders(id,order_number,customer_id,customer_name,source,status,created_by_email,updated_by_email,idempotency_key) values
 ('a1310001-7c42-4d65-9ea3-130000000009','RACE-REG-2-ORDER-A','a1310001-7c42-4d65-9ea3-130000000001','RACE-REG customer A','phone','delivered','test','test','RACE-REG-2-ORDER-A'),
 ('a1310001-7c42-4d65-9ea3-130000000010','RACE-REG-2-ORDER-B','a1310001-7c42-4d65-9ea3-130000000002','RACE-REG customer B','phone','delivered','test','test','RACE-REG-2-ORDER-B'),
 ('a1310001-7c42-4d65-9ea3-130000000011','RACE-REG-2-ORDER-C','a1310001-7c42-4d65-9ea3-130000000008','RACE-REG-2 customer C','phone','delivered','test','test','RACE-REG-2-ORDER-C');
insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,quantity) values
 ('a1310001-7c42-4d65-9ea3-130000000009','RACE-REG-2-ITEM','RACE-REG-2 instrument',1),
 ('a1310001-7c42-4d65-9ea3-130000000010','RACE-REG-2-ITEM','RACE-REG-2 instrument',1),
 ('a1310001-7c42-4d65-9ea3-130000000011','RACE-REG-2-ITEM','RACE-REG-2 instrument',1);
insert into private.stockflow_equipment_installations(id,order_id,tally_key,item_name,status,scheduled_date,created_by_email,serial_number,completed_at,completed_by_email,commissioning_notes)
 values
 ('a1310001-7c42-4d65-9ea3-130000000012','a1310001-7c42-4d65-9ea3-130000000009','RACE-REG-2-ITEM','RACE-REG-2 instrument','completed',current_date,'test','RACE-REG-2',now(),'test','RACE-REG-2 commissioning A'),
 ('a1310001-7c42-4d65-9ea3-130000000013','a1310001-7c42-4d65-9ea3-130000000010','RACE-REG-2-ITEM','RACE-REG-2 instrument','completed',current_date,'test','race reg 2',now(),'test','RACE-REG-2 commissioning B'),
 ('a1310001-7c42-4d65-9ea3-130000000014','a1310001-7c42-4d65-9ea3-130000000011','RACE-REG-2-ITEM','RACE-REG-2 instrument','scheduled',current_date,'test',null,null,null,null);
update private.stockflow_instruments set model_id='race-model-2' where serial_key='RACEREG2';
commit;
create function public.test_register_place_model_2(p_installation uuid,p_actor text,p_key text) returns text
language plpgsql as $$
declare c uuid;
begin
 select o.customer_id into c from private.stockflow_equipment_installations i join private.stockflow_orders o on o.id=i.order_id where i.id=p_installation;
 perform public.stockflow_economics_gateway('race-register-key',p_actor,'create_target',jsonb_build_object(
  'kind','placement','name','Race placement model 2','companyId','race-register-company','customerId',c,
  'customerSourceId',c::text,'siteId','race-site','modelId','race-model-2','installationId',p_installation,
  'effectiveFrom',private.stockflow_economic_business_date(),'capitalPaise','0','idempotencyKey',p_key));
 return 'ok';
exception when sqlstate 'PT409' then return 'PT409';
end$$;
revoke all on function public.test_register_place_model_2(uuid,text,text) from public,anon,authenticated;
create function public.test_register_commission_model_2() returns text language plpgsql as $$
begin
 update private.stockflow_equipment_installations set status='completed',serial_number='RACE-REG-2',completed_at=now(),
  completed_by_email='test',commissioning_notes='RACE-REG-2 concurrent commissioning'
  where id='a1310001-7c42-4d65-9ea3-130000000014';
 return 'ok';
exception when sqlstate 'PT409' then return 'PT409';
end$$;
revoke all on function public.test_register_commission_model_2() from public,anon,authenticated;
do $placement_race_model_set$
declare a text;b text;c text;pid_b integer;pid_c integer;attempt integer;message text;
begin
 perform public.dblink_connect('place2_a','dbname='||current_database()||' user='||current_user||' options=-cstatement_timeout=15000');
 perform public.dblink_connect('place2_b','dbname='||current_database()||' user='||current_user||' options=-cstatement_timeout=15000');
 perform public.dblink_connect('place2_c','dbname='||current_database()||' user='||current_user||' options=-cstatement_timeout=15000');
 select pid into pid_b from public.dblink('place2_b','select pg_backend_pid()') as t(pid integer);
 select pid into pid_c from public.dblink('place2_c','select pg_backend_pid()') as t(pid integer);
 perform public.dblink_exec('place2_a','begin');
 select result into a from public.dblink('place2_a',$q$select public.test_register_place_model_2('a1310001-7c42-4d65-9ea3-130000000012','race-register-a@test.local','race-register-place-2-a')$q$) as t(result text);
 if a is distinct from 'ok' then raise exception 'First model-already-set placement failed: %',a;end if;
 perform public.dblink_send_query('place2_b',$q$select public.test_register_place_model_2('a1310001-7c42-4d65-9ea3-130000000013','race-register-b@test.local','race-register-place-2-b')$q$);
 perform public.dblink_send_query('place2_c','select public.test_register_commission_model_2()');
 for attempt in 1..500 loop
  exit when exists(select 1 from pg_locks where pid=pid_b and not granted)
   and exists(select 1 from pg_locks where pid=pid_c and not granted);
  perform pg_sleep(0.01);
 end loop;
 if not exists(select 1 from pg_locks where pid=pid_b and not granted) then raise exception 'Second model-already-set placement did not wait';end if;
 if not exists(select 1 from pg_locks where pid=pid_c and not granted) then raise exception 'Model-already-set commissioning did not wait';end if;
 perform public.dblink_exec('place2_a','commit');
 select result into b from public.dblink_get_result('place2_b') as t(result text);
 perform * from public.dblink_get_result('place2_b') as t(result text);
 if b is distinct from 'PT409' then raise exception 'Competing model-already-set placement must return PT409: %',b;end if;
 select result into c from public.dblink_get_result('place2_c') as t(result text);
 perform * from public.dblink_get_result('place2_c') as t(result text);
 if c is distinct from 'PT409' then raise exception 'Competing commissioning must return PT409: %',c;end if;
 begin
  perform public.stockflow_economics_gateway('race-register-key','race-register-b@test.local','create_target',jsonb_build_object(
   'kind','placement','name','Race placement model 2 retry','companyId','race-register-company','customerId','a1310001-7c42-4d65-9ea3-130000000002',
   'customerSourceId','a1310001-7c42-4d65-9ea3-130000000002','siteId','race-site','modelId','race-model-2',
   'installationId','a1310001-7c42-4d65-9ea3-130000000013','effectiveFrom',private.stockflow_economic_business_date(),
   'capitalPaise','0','idempotencyKey','race-register-place-2-b-message'));
  raise exception 'Competing placement unexpectedly succeeded';
 exception when sqlstate 'PT409' then
  get stacked diagnostics message=message_text;
  if message is distinct from 'Instrument already has an open placement; close it first' then raise exception 'Wrong placement conflict: %',message;end if;
 end;
 begin
  update private.stockflow_equipment_installations set status='completed',serial_number='RACE-REG-2',completed_at=now(),completed_by_email='test'
   where id='a1310001-7c42-4d65-9ea3-130000000014';
  raise exception 'Competing commissioning unexpectedly succeeded';
 exception when sqlstate 'PT409' then
  get stacked diagnostics message=message_text;
  if message is distinct from 'Serial is placed at RACE-REG customer A; end that placement first' then raise exception 'Wrong commissioning conflict: %',message;end if;
 end;
 if (select count(*) from private.stockflow_instruments where serial_key='RACEREG2')<>1 then raise exception 'Model-already-set race changed instrument count';end if;
 if (select count(*) from private.stockflow_economic_targets t join private.stockflow_equipment_installations i on i.id=t.installation_id join private.stockflow_instruments m on m.id=i.instrument_id
  where m.serial_key='RACEREG2' and t.kind='placement' and t.approval<>'rejected' and t.effective_to is null)<>1 then raise exception 'Model-already-set race left other than one open placement';end if;
 if (select model_id from private.stockflow_instruments where serial_key='RACEREG2') is distinct from 'race-model-2' then raise exception 'Model-already-set race changed model_id';end if;
 perform public.dblink_disconnect('place2_a');perform public.dblink_disconnect('place2_b');perform public.dblink_disconnect('place2_c');
end$placement_race_model_set$;
drop function public.test_register_place_model_2(uuid,text,text);
drop function public.test_register_commission_model_2();
drop function public.test_register_place(uuid,text,text);
drop function public.test_register_commission();
