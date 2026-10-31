begin;
insert into private.stockflow_gateway_config(name,secret_sha256)
values('orders',encode(extensions.digest('wallet-tv-test-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,status) values ('wallet-tv@test.local','management','active');
insert into private.stockflow_customers(id,name,tally_key,created_by_email) values
 ('19100000-0000-4000-8000-000000000001','Test volume lab','wallet-tv','test');

create function pg_temp.tv_payload(key text) returns jsonb language sql as $$
 select jsonb_build_object('requestId','wallet-test-volume-'||key,'customerId','19100000-0000-4000-8000-000000000001',
 'monthlyWalletPaise',5200000,'method','test_volume','source','Lab visit','confidence','medium',
 'asOf','2026-10-30','note','Volume estimate','loweredReason',null,'divisions',jsonb_build_array(),
 'expectedCurrentSnapshotId',null,'testVolume',jsonb_build_object('testsPerDay',80,'workingDaysPerMonth',26,'paisePerTest',2500));
$$;
create function pg_temp.tv_command(payload jsonb) returns jsonb language sql as $$
 select public.stockflow_wallet_gateway('wallet-tv-test-key','wallet-tv@test.local','record_wallet_snapshot',payload);
$$;
create function pg_temp.tv_invalid(payload jsonb) returns void language plpgsql as $$
declare before_count bigint;
begin
 select count(*) into before_count from private.stockflow_wallet_snapshots;
 begin
  perform pg_temp.tv_command(payload);
  raise exception 'Expected 22023';
 exception when sqlstate '22023' then
  if sqlerrm <> 'Wallet total must equal tests per day × working days × price per test' then raise;end if;
 end;
 if (select count(*) from private.stockflow_wallet_snapshots)<>before_count then raise exception 'Rejected command left a row';end if;
end$$;

do $checks$
declare saved uuid; result jsonb; payload jsonb; constraint_name text; bad jsonb;
begin
 result:=pg_temp.tv_command(pg_temp.tv_payload('valid'));saved:=(result->>'snapshotId')::uuid;
 result:=public.stockflow_wallet_gateway('wallet-tv-test-key','wallet-tv@test.local','get_wallet_account',
  jsonb_build_object('customerId','19100000-0000-4000-8000-000000000001'));
 if result#>'{current,testVolume}' is distinct from pg_temp.tv_payload('valid')->'testVolume'
  or result#>'{history,0,testVolume}' is distinct from pg_temp.tv_payload('valid')->'testVolume' then
  raise exception 'TV1 account current/history testVolume missing: %',result;end if;
 raise notice 'PASS TV1 matching inputs save and current/history return testVolume';
 payload:=pg_temp.tv_payload('mismatch')||jsonb_build_object('expectedCurrentSnapshotId',saved,'monthlyWalletPaise',5200001);
 perform pg_temp.tv_invalid(payload);
 raise notice 'PASS TV2 mismatched total raises 22023 with no row';
 payload:=pg_temp.tv_payload('missing')||jsonb_build_object('expectedCurrentSnapshotId',saved);
 perform pg_temp.tv_invalid(payload-'testVolume');
 perform pg_temp.tv_invalid(payload||jsonb_build_object('testVolume',null));
 for bad in select value from jsonb_array_elements(jsonb_build_array(
  jsonb_build_object('testsPerDay',0,'workingDaysPerMonth',26,'paisePerTest',2500),
  jsonb_build_object('testsPerDay',100001,'workingDaysPerMonth',26,'paisePerTest',2500),
  jsonb_build_object('testsPerDay',80,'workingDaysPerMonth',32,'paisePerTest',2500),
  jsonb_build_object('testsPerDay',80,'workingDaysPerMonth',26,'paisePerTest',100000001),
  jsonb_build_object('testsPerDay',1.5,'workingDaysPerMonth',26,'paisePerTest',2500),
  jsonb_build_object('testsPerDay','80','workingDaysPerMonth',26,'paisePerTest',2500),
  jsonb_build_array(80,26,2500))) loop
  perform pg_temp.tv_invalid(payload||jsonb_build_object('testVolume',bad));
 end loop;
 raise notice 'PASS TV3 test_volume requires inputs';
 perform pg_temp.tv_invalid(pg_temp.tv_payload('wrong-method')||jsonb_build_object('expectedCurrentSnapshotId',saved,'method','manager_estimate'));
 raise notice 'PASS TV4 other methods refuse testVolume';
 -- A PL/pgSQL exception block is a subtransaction (savepoint).
 begin
  insert into private.stockflow_wallet_snapshots(customer_id,monthly_wallet_paise,method,source,confidence,as_of,note,entered_by,tests_per_day)
  values('19100000-0000-4000-8000-000000000001',5200000,'test_volume','Lab visit','medium','2026-10-30','Partial inputs','wallet-tv@test.local',80);
  raise exception 'TV5 partial inputs accepted';
 exception when check_violation then
  get stacked diagnostics constraint_name=constraint_name;
  if constraint_name<>'stockflow_wallet_snapshots_test_volume_rule' then raise;end if;
 end;
 raise notice 'PASS TV5 table rule rejects partial inputs';
 perform pg_temp.tv_command((pg_temp.tv_payload('legacy')-'testVolume')||jsonb_build_object('expectedCurrentSnapshotId',saved,'method','manager_estimate','asOf','2026-10-31'));
 result:=private.stockflow_wallet_account_read('2026-11-01','19100000-0000-4000-8000-000000000001');
 if result#>'{current,testVolume}' is distinct from 'null'::jsonb or result#>'{history,0,testVolume}' is distinct from 'null'::jsonb
  or result#>'{history,1,testVolume}' is distinct from pg_temp.tv_payload('valid')->'testVolume' then raise exception 'TV6 legacy null/history failed';end if;
 raise notice 'PASS TV6 snapshots without inputs return JSON null';
end $checks$;
rollback;
