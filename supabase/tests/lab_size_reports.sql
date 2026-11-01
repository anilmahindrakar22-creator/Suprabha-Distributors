begin;
insert into private.stockflow_gateway_config(name,secret_sha256)
values('orders',encode(extensions.digest('lab-size-test-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,status)
select 'lab-size-'||r||'@test.local',r,'active' from unnest(array['sales','management','operations']) r;
insert into private.stockflow_customers(id,name,created_by_email) values
 ('19200000-0000-4000-8000-000000000001','Lab size fixture','test');
create function pg_temp.ls_payload(k text) returns jsonb language sql as $$
 select jsonb_build_object('customerId','19200000-0000-4000-8000-000000000001','testsPerDay',80,
 'basis','lab_said','statedMonthlySpendPaise',5000000,'note','At visit','idempotencyKey','lab-size-report-'||k)
$$;
create function pg_temp.ls_call(payload jsonb,actor text default 'sales') returns jsonb language sql as $$
 select public.stockflow_accounts_gateway('lab-size-test-key','lab-size-'||actor||'@test.local','record_lab_size',payload)
$$;
create function pg_temp.ls_sheet(actor text) returns jsonb language sql as $$
 select public.stockflow_customer_map_gateway('lab-size-test-key','lab-size-'||actor||'@test.local','get_customer_sheet',
 jsonb_build_object('customerId','19200000-0000-4000-8000-000000000001'))
$$;
create function pg_temp.ls_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL %',label;end if;end$$;
create function pg_temp.ls_error(payload jsonb,expected text,actor text default 'sales') returns void language plpgsql as $$
begin
 begin perform pg_temp.ls_call(payload,actor);
 exception when others then if sqlstate=expected then return;end if;raise;end;
 raise exception 'Expected %',expected;
end$$;
do $checks$
declare saved jsonb; report uuid; bad jsonb;
begin
 saved:=pg_temp.ls_call(pg_temp.ls_payload('first'));report:=(saved->>'reportId')::uuid;
 perform pg_temp.ls_assert(saved->>'ok'='true' and pg_temp.ls_sheet('sales')#>>'{labSize,testsPerDay}'='80'
  and not (pg_temp.ls_sheet('sales')->'labSize' ? 'statedMonthlySpendPaise')
  and pg_temp.ls_sheet('management')#>>'{labSize,statedMonthlySpendPaise}'='5000000','LS1 privacy');
 raise notice 'PASS LS1 sales records; sales read hides spend; management reads spend';
 perform pg_temp.ls_error(pg_temp.ls_payload('operations'),'PT403','operations');
 raise notice 'PASS LS2 operations refused with PT403';
 perform pg_temp.ls_assert(saved=pg_temp.ls_call(pg_temp.ls_payload('first'))
  and (select count(*)=1 from private.stockflow_lab_size_reports where customer_id='19200000-0000-4000-8000-000000000001'),'LS3 replay');
 raise notice 'PASS LS3 idempotency replay returns original result and one row';
 for bad in select value from jsonb_array_elements(jsonb_build_array(0,100001,1.5,'80',null)) loop
  perform pg_temp.ls_error(pg_temp.ls_payload('invalid-tests')||jsonb_build_object('testsPerDay',bad),'22023');
 end loop;
 perform pg_temp.ls_error(pg_temp.ls_payload('invalid-key')||jsonb_build_object('extra',true),'22023');
 perform pg_temp.ls_error(pg_temp.ls_payload('invalid-note')||jsonb_build_object('note',' x '),'22023');
 perform pg_temp.ls_error(pg_temp.ls_payload('invalid-basis')||jsonb_build_object('basis','guess'),'22023');
 perform pg_temp.ls_error(pg_temp.ls_payload('invalid-spend')||jsonb_build_object('statedMonthlySpendPaise',9000000000000001),'22023');
 for bad in select value from jsonb_array_elements(jsonb_build_array(-1,1.5,'5000000')) loop
  perform pg_temp.ls_error(pg_temp.ls_payload('invalid-spend-type')||jsonb_build_object('statedMonthlySpendPaise',bad),'22023');
 end loop;
 perform pg_temp.ls_error(pg_temp.ls_payload('missing-customer')||jsonb_build_object('customerId','19200000-0000-4000-8000-000000000099'),'22023');
 update private.stockflow_customers set active=false where id='19200000-0000-4000-8000-000000000001';
 perform pg_temp.ls_error(pg_temp.ls_payload('inactive-customer'),'22023');
 update private.stockflow_customers set active=true where id='19200000-0000-4000-8000-000000000001';
 perform pg_temp.ls_assert((select count(*)=1 from private.stockflow_lab_size_reports where customer_id='19200000-0000-4000-8000-000000000001'),'LS4 rejected writes leave no rows');
 raise notice 'PASS LS4 invalid tests, keys, note, basis and spend raise 22023';
 perform pg_temp.ls_call(pg_temp.ls_payload('latest')||jsonb_build_object('testsPerDay',90));
 perform pg_temp.ls_assert(pg_temp.ls_sheet('sales')#>>'{labSize,testsPerDay}'='90','LS5 newest');
 raise notice 'PASS LS5 newest report wins';
 begin update private.stockflow_lab_size_reports set tests_per_day=81 where id=report;
  raise exception 'LS6 update allowed';
 exception when sqlstate '55000' then null;end;
 begin delete from private.stockflow_lab_size_reports where id=report;
  raise exception 'LS6 delete allowed';
 exception when sqlstate '42501' then null;end;
 raise notice 'PASS LS6 update and delete refused';
 perform pg_temp.ls_assert(public.stockflow_wallet_gateway('lab-size-test-key','lab-size-management@test.local','get_wallet_account',
  jsonb_build_object('customerId','19200000-0000-4000-8000-000000000001'))#>>'{labSize,statedMonthlySpendPaise}'='5000000','LS7 wallet');
 raise notice 'PASS LS7 wallet account returns labSize with spend';
 perform pg_temp.ls_call(pg_temp.ls_payload('nullable-fields')||jsonb_build_object('note',null,'statedMonthlySpendPaise',null,'basis','observed'));
 perform pg_temp.ls_assert((select stated_monthly_spend_paise is null and note is null and basis='observed'
  from private.stockflow_lab_size_reports where id=(select id from private.stockflow_lab_size_reports
   where customer_id='19200000-0000-4000-8000-000000000001' order by reported_at desc,id desc limit 1))
  and pg_temp.ls_sheet('management')#>>'{labSize,basis}'='observed'
  and pg_temp.ls_sheet('management')#>>'{labSize,statedMonthlySpendPaise}'='5000000','nullable fields save');
 perform pg_temp.ls_assert((select relrowsecurity from pg_class where oid='private.stockflow_lab_size_reports'::regclass)
  and not has_table_privilege('service_role','private.stockflow_lab_size_reports','SELECT')
  and not has_function_privilege('service_role','private.stockflow_lab_size_read(uuid,boolean)','EXECUTE'),'private read boundary');
 perform pg_temp.ls_call(pg_temp.ls_payload('management-spend')||jsonb_build_object('testsPerDay',110,'statedMonthlySpendPaise',7250000),'management');
 perform pg_temp.ls_call(pg_temp.ls_payload('sales-no-spend')||jsonb_build_object('testsPerDay',125,'statedMonthlySpendPaise',null),'sales');
 perform pg_temp.ls_assert(pg_temp.ls_sheet('management')#>>'{labSize,testsPerDay}'='125'
  and pg_temp.ls_sheet('management')#>>'{labSize,statedMonthlySpendPaise}'='7250000'
  and pg_temp.ls_sheet('management')#>>'{labSize,spendReportedOn}'=(select (reported_at at time zone 'Asia/Kolkata')::date::text from private.stockflow_lab_size_reports where id=(select id from private.stockflow_lab_size_reports where customer_id='19200000-0000-4000-8000-000000000001' and stated_monthly_spend_paise=7250000 order by reported_at desc,id desc limit 1))
  and not (pg_temp.ls_sheet('sales')->'labSize' ? 'statedMonthlySpendPaise')
  and not (pg_temp.ls_sheet('sales')->'labSize' ? 'spendReportedOn'),'LS8 spend retention');
 raise notice 'PASS LS8 management retains prior spend/date with latest volume; sales sees no spend';
 perform pg_temp.ls_assert(not (pg_temp.ls_sheet('operations') ? 'labSize')
  and pg_temp.ls_sheet('operations')->'labAccess'='false'::jsonb
  and pg_temp.ls_sheet('sales') ? 'labSize'
  and pg_temp.ls_sheet('sales')->'labAccess'='true'::jsonb,'LS9 sheet lab access');
 raise notice 'PASS LS9 operations sheet hides labSize and denies labAccess; sales sheet includes both';
end $checks$;
rollback;
