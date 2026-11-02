begin;
insert into private.stockflow_gateway_config(name,secret_sha256)
values('orders',encode(extensions.digest('lab-specials-test-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,status)
select 'lab-specials-'||r||'@test.local',r,'active' from unnest(array['sales','management','operations']) r;
insert into private.stockflow_customers(id,name,created_by_email) values
 ('19300000-0000-4000-8000-000000000001','Lab specials fixture','test');
create function pg_temp.lss_payload(k text) returns jsonb language sql as $$
 select jsonb_build_object('customerId','19300000-0000-4000-8000-000000000001','testsPerDay',80,
 'basis','lab_said','idempotencyKey','lab-specials-report-'||k)
$$;
create function pg_temp.lss_call(payload jsonb,actor text default 'sales') returns jsonb language sql as $$
 select public.stockflow_accounts_gateway('lab-specials-test-key','lab-specials-'||actor||'@test.local','record_lab_size',payload)
$$;
create function pg_temp.lss_sheet() returns jsonb language sql as $$
 select public.stockflow_customer_map_gateway('lab-specials-test-key','lab-specials-sales@test.local','get_customer_sheet',
 jsonb_build_object('customerId','19300000-0000-4000-8000-000000000001'))
$$;
create function pg_temp.lss_wallet() returns jsonb language sql as $$
 select public.stockflow_wallet_gateway('lab-specials-test-key','lab-specials-management@test.local','get_wallet_account',
 jsonb_build_object('customerId','19300000-0000-4000-8000-000000000001'))
$$;
create function pg_temp.lss_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL %',label;end if;end$$;
create function pg_temp.lss_error(payload jsonb,expected text,actor text default 'sales') returns void language plpgsql as $$
begin
 begin perform pg_temp.lss_call(payload,actor);
 exception when others then if sqlstate=expected then return;end if;raise;end;
 raise exception 'Expected %',expected;
end$$;
do $checks$
declare bad jsonb; saved uuid;
begin
 saved:=(pg_temp.lss_call(pg_temp.lss_payload('first')||jsonb_build_object('specialTestsPerMonth',100))->>'reportId')::uuid;
 perform pg_temp.lss_assert(pg_temp.lss_sheet()#>>'{labSize,testsPerDay}'='80'
  and pg_temp.lss_sheet()#>>'{labSize,specialTestsPerMonth}'='100'
  and pg_temp.lss_wallet()#>>'{labSize,specialTestsPerMonth}'='100'
  and (select special_tests_per_month=100 from private.stockflow_lab_size_reports where id=saved),'LSS1 both reads');
 raise notice 'PASS LSS1 sales records specials; sheet and wallet read 100';
 perform pg_temp.lss_call(pg_temp.lss_payload('omitted'));
 perform pg_temp.lss_assert(not (pg_temp.lss_sheet()->'labSize' ? 'specialTestsPerMonth')
  and not (pg_temp.lss_wallet()->'labSize' ? 'specialTestsPerMonth'),'LSS2 omitted specials');
 perform pg_temp.lss_call(pg_temp.lss_payload('explicit-null')||jsonb_build_object('specialTestsPerMonth',null));
 perform pg_temp.lss_assert(not (pg_temp.lss_sheet()->'labSize' ? 'specialTestsPerMonth')
  and not (pg_temp.lss_wallet()->'labSize' ? 'specialTestsPerMonth'),'LSS2 null specials');
 raise notice 'PASS LSS2 absent and null specials have no read key';
 for bad in select value from jsonb_array_elements(jsonb_build_array(0,1.5,'100',1000001)) loop
  perform pg_temp.lss_error(pg_temp.lss_payload('invalid')||jsonb_build_object('specialTestsPerMonth',bad),'22023');
 end loop;
 perform pg_temp.lss_assert((select count(*)=3 from private.stockflow_lab_size_reports
  where customer_id='19300000-0000-4000-8000-000000000001'),'LSS3 no invalid rows');
 raise notice 'PASS LSS3 invalid specials raise 22023 and save no row';
 perform pg_temp.lss_error(pg_temp.lss_payload('operations')||jsonb_build_object('specialTestsPerMonth',100),'PT403','operations');
 perform pg_temp.lss_assert((select count(*)=3 from private.stockflow_lab_size_reports
  where customer_id='19300000-0000-4000-8000-000000000001'),'LSS4 no operations row');
 raise notice 'PASS LSS4 operations refused with PT403';
end $checks$;
rollback;
