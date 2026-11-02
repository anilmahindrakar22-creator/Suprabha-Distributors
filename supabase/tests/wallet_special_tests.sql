begin;
insert into private.stockflow_gateway_config(name,secret_sha256)
values('orders',encode(extensions.digest('wallet-tv-test-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,status) values ('wallet-tv@test.local','management','active');
insert into private.stockflow_customers(id,name,tally_key,created_by_email) values
 ('19100000-0000-4000-8000-000000000001','Test volume lab','wallet-tv','test');
insert into private.stockflow_customers(id,name,tally_key,created_by_email) values
 ('19100000-0000-4000-8000-000000000002','Routine-only lab','wallet-routine-only','test');

create function pg_temp.special_payload(key text) returns jsonb language sql as $$
 select jsonb_build_object('requestId','wallet-special-test-'||key,'customerId','19100000-0000-4000-8000-000000000001',
 'monthlyWalletPaise',8200000,'method','test_volume','source','Lab visit','confidence','medium',
 'asOf','2026-10-30','note','Volume estimate','loweredReason',null,'divisions',jsonb_build_array(),
 'expectedCurrentSnapshotId',null,'testVolume',jsonb_build_object('testsPerDay',80,'workingDaysPerMonth',26,'paisePerTest',2500,
 'specialTestsPerMonth',100,'paisePerSpecialTest',30000));
$$;
create function pg_temp.special_command(payload jsonb) returns jsonb language sql as $$
 select public.stockflow_wallet_gateway('wallet-tv-test-key','wallet-tv@test.local','record_wallet_snapshot',payload);
$$;
create function pg_temp.special_invalid(payload jsonb) returns void language plpgsql as $$
declare before_count bigint;
begin
 select count(*) into before_count from private.stockflow_wallet_snapshots;
 begin
  perform pg_temp.special_command(payload);
  raise exception 'Expected 22023';
 exception when sqlstate '22023' then
  if sqlerrm <> 'Wallet total must equal routine plus special tests × price' then raise;end if;
 end;
 if (select count(*) from private.stockflow_wallet_snapshots)<>before_count then raise exception 'Rejected command left a row';end if;
end$$;

do $checks$
declare saved uuid; result jsonb; payload jsonb; constraint_name text;
begin
 result:=pg_temp.special_command(pg_temp.special_payload('matching-case-0001'));saved:=(result->>'snapshotId')::uuid;
 result:=public.stockflow_wallet_gateway('wallet-tv-test-key','wallet-tv@test.local','get_wallet_account',
  jsonb_build_object('customerId','19100000-0000-4000-8000-000000000001'));
 if result#>'{current,testVolume}' is distinct from pg_temp.special_payload('read-case-000001')->'testVolume'
  or result#>'{history,0,testVolume}' is distinct from pg_temp.special_payload('read-case-000001')->'testVolume' then
  raise exception 'WS1 account current/history testVolume missing: %',result;end if;
 raise notice 'PASS WS1 routine plus special saves and read returns all five inputs';
 payload:=pg_temp.special_payload('mismatch-case-0001')||jsonb_build_object('expectedCurrentSnapshotId',saved,'monthlyWalletPaise',8200001);
 perform pg_temp.special_invalid(payload);
 raise notice 'PASS WS2 wrong total raises 22023 and saves no row';
 payload:=pg_temp.special_payload('one-special-case-01')||jsonb_build_object('expectedCurrentSnapshotId',saved,
  'testVolume',(pg_temp.special_payload('one-special-case-02')->'testVolume')-'paisePerSpecialTest');
 perform pg_temp.special_invalid(payload);
 payload:=pg_temp.special_payload('other-method-case-01')||jsonb_build_object('expectedCurrentSnapshotId',saved,'method','manager_estimate',
  'testVolume',(pg_temp.special_payload('other-method-case-02')->'testVolume'));
 perform pg_temp.special_invalid(payload);
 raise notice 'PASS WS3 and WS4 partial pairs and non-test_volume specials are rejected';
 payload:=pg_temp.special_payload('routine-only-case-001')||jsonb_build_object('customerId','19100000-0000-4000-8000-000000000002','asOf','2026-10-31',
  'monthlyWalletPaise',5200000,'testVolume',jsonb_build_object('testsPerDay',80,'workingDaysPerMonth',26,'paisePerTest',2500));
 result:=pg_temp.special_command(payload);
 if result->>'ok' is distinct from 'true' then raise exception 'WS6 routine-only failed';end if;
 raise notice 'PASS WS6 routine-only snapshots still save with their original total';
 begin
  insert into private.stockflow_wallet_snapshots(customer_id,monthly_wallet_paise,method,source,confidence,as_of,note,entered_by,
   special_tests_per_month,paise_per_special_test)
  values('19100000-0000-4000-8000-000000000001',3000000,'test_volume','Lab visit','medium','2026-10-30','Missing routine','wallet-tv@test.local',100,30000);
  raise exception 'WS5 special values without routine accepted';
 exception when check_violation then
  get stacked diagnostics constraint_name=constraint_name;
  if constraint_name<>'stockflow_wallet_snapshots_test_volume_rule' then raise;end if;
 end;
 raise notice 'PASS WS5 table rule rejects special values without routine values';
end $checks$;
rollback;
