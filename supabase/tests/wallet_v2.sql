begin;
insert into private.stockflow_gateway_config(name,secret_sha256)
values('orders',encode(extensions.digest('wallet-test-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,status) values
 ('wallet-manager@test.local','management','active'),('wallet-admin@test.local','administrator','active'),
 ('wallet-sales@test.local','sales','active'),('wallet-operations@test.local','operations','active'),
 ('wallet-warehouse@test.local','warehouse','active'),('wallet-billing@test.local','billing','active'),
 ('wallet-accounts@test.local','accounts','active'),('wallet-viewer@test.local','viewer','active');
insert into private.stockflow_customers(id,name,tally_key,city,created_by_email) values
 ('b2300000-0000-4000-8000-000000000001','WALLET Alpha','wallet-a','Pune','test'),
 ('b2300000-0000-4000-8000-000000000002','WALLET Beta','wallet-b',null,'test'),
 ('b2300000-0000-4000-8000-000000000003','WALLET Beta','wallet-c',null,'test'),
 ('b2300000-0000-4000-8000-000000000004','WALLET Below','wallet-d',null,'test'),
 ('b2300000-0000-4000-8000-000000000005','WALLET No estimate','wallet-e',null,'test'),
 ('b2300000-0000-4000-8000-000000000006','WALLET Zero','wallet-f',null,'test');
insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
select 'wallet-test',tally_key,id,'test' from private.stockflow_customers where tally_key in ('wallet-a','wallet-b','wallet-c','wallet-d','wallet-e','wallet-f');

create function pg_temp.wallet_payload(n integer,amount bigint,expected uuid default null) returns jsonb language sql as $$
 select jsonb_build_object('requestId','wallet-snapshot-test-'||n,'customerId','b2300000-0000-4000-8000-'||lpad(n::text,12,'0'),
  'monthlyWalletPaise',amount,'method','manager_estimate','source','Fixture source','confidence','medium',
  'asOf','2026-03-30','note','Fixture note','loweredReason',null,'divisions','[]'::jsonb,'expectedCurrentSnapshotId',expected);
$$;
create function pg_temp.wallet_command(action text,payload jsonb) returns jsonb language sql as $$
 select public.stockflow_wallet_gateway('wallet-test-key','wallet-manager@test.local',action,payload);
$$;
create function pg_temp.wallet_error(action text,payload jsonb,expected text) returns void language plpgsql as $$
begin
 begin
  perform pg_temp.wallet_command(action,payload);
 exception when others then
  if sqlstate=expected then return;end if;
  raise;
 end;
 raise exception 'Expected SQLSTATE % for %',expected,payload;
end$$;
create function pg_temp.wallet_line(source text,revision integer,ledger text,amount bigint,
 kind text default 'sale',cancelled boolean default false,business_date date default '2026-07-10') returns void language plpgsql as $$
declare voucher uuid;
begin
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,kind,cancelled,evidence)
 values('wallet-test',source,revision,business_date,ledger,kind,cancelled,'{}') returning id into voucher;
 insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
 values(voucher,'1','wallet-product',case when amount<0 then -1 else 1 end,'Nos',amount,'{}');
end$$;

do $checks$
declare a uuid; b uuid; payload jsonb; original jsonb; result jsonb; row_data jsonb; role_name text; action text;
 t text; operation text; denied boolean; company text; month_start date; net bigint; before_count bigint; audit_count bigint;
begin
 result:=pg_temp.wallet_command('record_wallet_snapshot',pg_temp.wallet_payload(1,1001));a:=(result->>'snapshotId')::uuid;
 perform pg_temp.wallet_command('record_wallet_snapshot',pg_temp.wallet_payload(2,1000));
 perform pg_temp.wallet_command('record_wallet_snapshot',pg_temp.wallet_payload(3,1000));
 perform pg_temp.wallet_command('record_wallet_snapshot',pg_temp.wallet_payload(4,100));
 perform pg_temp.wallet_command('record_wallet_snapshot',pg_temp.wallet_payload(6,0));
 -- A split row makes both history and the immutable split table observable.
 insert into private.stockflow_wallet_snapshot_divisions(snapshot_id,division_id,monthly_wallet_paise)
 select a,id,400 from private.stockflow_wallet_divisions where code='BIOCHEM';
 -- CASE W1: deletes on all four tables; updates on the three immutable tables.
 foreach t in array array['stockflow_wallet_divisions','stockflow_wallet_snapshots','stockflow_wallet_snapshot_divisions','stockflow_wallet_policies'] loop
  foreach operation in array array['delete','update'] loop
   if operation='update' and t='stockflow_wallet_divisions' then continue;end if;
   denied:=false;
   begin
    if operation='delete' then execute format('delete from private.%I',t);
    else execute format('update private.%I set %I=%I',t,
     case t when 'stockflow_wallet_policies' then 'note' when 'stockflow_wallet_snapshots' then 'note' else 'monthly_wallet_paise' end,
     case t when 'stockflow_wallet_policies' then 'note' when 'stockflow_wallet_snapshots' then 'note' else 'monthly_wallet_paise' end);end if;
   exception when sqlstate '42501' or sqlstate '55000' then denied:=true;end;
   if not denied then raise exception 'Business mutation admitted: % %',operation,t;end if;
  end loop;
 end loop;
 -- Section 3 explicitly gives divisions only no_delete. Service callers still cannot update them.
 denied:=false;
 begin
  set local role service_role;
  update private.stockflow_wallet_divisions set name=name;
 exception when insufficient_privilege then denied:=true;end;
 reset role;
 if not denied then raise exception 'Service role can edit divisions';end if;
 raise notice 'PASS W1 append-only triggers and division update permissions';

 payload:=pg_temp.wallet_payload(1,900,a)||jsonb_build_object('requestId','wallet-invalid-lowering');
 perform pg_temp.wallet_error('record_wallet_snapshot',payload,'22023');
 perform pg_temp.wallet_error('record_wallet_snapshot',payload||'{"monthlyWalletPaise":1001,"loweredReason":"Not lowering"}','22023');
 perform pg_temp.wallet_error('record_wallet_snapshot',payload||'{"monthlyWalletPaise":1001,"divisions":[{"code":"BIOCHEM","monthlyWalletPaise":1002}]}','22023');
 perform pg_temp.wallet_error('record_wallet_snapshot',payload||'{"monthlyWalletPaise":1001,"divisions":[{"code":"UNKNOWN","monthlyWalletPaise":1}]}','22023');
 update private.stockflow_wallet_divisions set active=false where code='OTHERS';
 perform pg_temp.wallet_error('record_wallet_snapshot',payload||'{"monthlyWalletPaise":1001,"divisions":[{"code":"OTHERS","monthlyWalletPaise":1}]}','22023');
 perform pg_temp.wallet_error('record_wallet_snapshot',payload||'{"monthlyWalletPaise":1001,"divisions":[{"code":"BIOCHEM","monthlyWalletPaise":1},{"code":"BIOCHEM","monthlyWalletPaise":1}]}','22023');
 perform pg_temp.wallet_error('record_wallet_snapshot',payload||'{"customerId":"b2300000-0000-4000-8000-999999999999"}','22023');
 raise notice 'PASS W2 lowering, division totals, unknown/inactive/duplicate divisions and missing customer';

 perform pg_temp.wallet_error('record_wallet_snapshot',pg_temp.wallet_payload(1,1001)||'{"requestId":"wallet-snapshot-stale-1"}','PT409');
 payload:='{"requestId":"wallet-policy-test-01","walletShareTargetBps":8000,"focusBandBps":6000,"staleAfterMonths":6,"note":"Fixture policy","expectedVersion":0}';
 perform pg_temp.wallet_error('set_wallet_policy',payload,'PT409');
 result:=pg_temp.wallet_command('set_wallet_policy',payload||'{"expectedVersion":1}');
 if result is distinct from '{"ok":true,"version":2}'::jsonb then raise exception 'Wrong policy result: %',result;end if;
 raise notice 'PASS W3 snapshot and policy expected-version conflicts';

 foreach role_name in array array['sales','operations','warehouse','billing','accounts','viewer'] loop
  foreach action in array array['get_wallet_workspace','get_wallet_account','record_wallet_snapshot','set_wallet_policy'] loop
   denied:=false;
   begin perform public.stockflow_wallet_gateway('wallet-test-key','wallet-'||role_name||'@test.local',action,'{}');
   exception when sqlstate 'PT403' then denied:=true;end;
   if not denied then raise exception 'Role % admitted to %',role_name,action;end if;
  end loop;
 end loop;
 denied:=false;
 begin perform public.stockflow_wallet_gateway('wrong','wallet-admin@test.local','get_wallet_workspace','{}');
 exception when sqlstate '42501' then denied:=true;end;
 if not denied then raise exception 'Invalid gateway key admitted';end if;
 result:=public.stockflow_wallet_gateway('wallet-test-key','wallet-admin@test.local','get_wallet_workspace','{"view":"all","page":1,"search":"WALLET"}');
 if result->>'pageSize'<>'50' then raise exception 'Administrator read failed';end if;
 raise notice 'PASS W5 all six excluded roles denied on all four actions and gateway key retained';

 result:=private.stockflow_wallet_workspace_read('2026-10-30','all',1,'WALLET');
 if result#>>'{coverage,certified}' is distinct from 'false' or result#>>'{coverage,windowFrom}'<>'2026-07-01'
  or result#>>'{coverage,windowTo}'<>'2026-09-30' or result#>>'{coverage,reason}' is null then raise exception 'Missing coverage certified: %',result;end if;
 for row_data in select value from jsonb_array_elements(result->'rows') loop
  foreach t in array array['salesPaise','sharePermille','untappedPaise','captureGapPaise','inFocusBand'] loop
   if row_data->t is distinct from 'null'::jsonb then raise exception 'Uncertified % leaked: %',t,row_data;end if;
  end loop;
 end loop;
 foreach t in array array['focusCount','focusGapPaise','accountsWithSales','unlinkedSalesPaise','unlinkedLedgers'] loop
  if result->'summary'->t is distinct from 'null'::jsonb then raise exception 'Uncertified summary leaked %',t;end if;
 end loop;
 result:=private.stockflow_wallet_workspace_read('2026-10-30','no_estimate',1,'WALLET');
 if result->'rows'->0->>'name'<>'WALLET No estimate' then raise exception 'Uncertified no-estimate order failed';end if;
 raise notice 'PASS W6 uncertified window fails closed for every financial and focus field';

 perform pg_temp.wallet_line('sale',1,'wallet-a',9999);
 perform pg_temp.wallet_line('sale',2,'wallet-a',451);
 perform pg_temp.wallet_line('return',1,'wallet-a',-90,'return');
 perform pg_temp.wallet_line('credit',1,'wallet-a',-59,'credit');
 perform pg_temp.wallet_line('cancelled',1,'wallet-a',9000);
 perform pg_temp.wallet_line('cancelled',2,'wallet-a',9000,'sale',true);
 perform pg_temp.wallet_line('outside',1,'wallet-a',9000,'sale',false,'2026-10-01');
 perform pg_temp.wallet_line('before',1,'wallet-a',9000,'sale',false,'2026-06-30');
 perform pg_temp.wallet_line('beta',1,'wallet-b',600);
 perform pg_temp.wallet_line('beta-tie',1,'wallet-c',600);
 perform pg_temp.wallet_line('below',1,'wallet-d',450);
 perform pg_temp.wallet_line('no-estimate',1,'wallet-e',2);
 perform pg_temp.wallet_line('negative',1,'wallet-f',-2,'credit');
 perform pg_temp.wallet_line('unlinked',1,'unlinked-ledger',8);
 -- Every linked company needs a covering generation and three matching controls.
 -- Other replay fixtures may have identities; certify them with their actual totals.
 for company in select distinct company_id from private.stockflow_economic_customer_identities loop
  insert into private.stockflow_economic_source_coverage(company_id,window_from,window_to,source_version,imported_at)
  values(company,'2026-07-01','2026-10-01','wallet-certified',clock_timestamp()+interval '1 day');
  insert into private.stockflow_sales_control_imports(company_id,source_version,valid_months,imported_at)
  values(company,'wallet-certified',array[date '2026-07-01',date '2026-08-01',date '2026-09-01'],clock_timestamp()+interval '1 day');
  foreach month_start in array array[date '2026-07-01',date '2026-08-01',date '2026-09-01'] loop
   if company='wallet-test' then net:=case when month_start=date '2026-07-01' then 1960 else 0 end;
   else net:=(private.stockflow_sales_reconciliation(company,month_start)->>'appNetPaise')::bigint;end if;
   insert into private.stockflow_sales_control_totals(company_id,month,kind,source_key,net_paise,source_version,imported_at)
   values(company,month_start,'sales_ledger','sales',net,'wallet-certified',clock_timestamp()+interval '1 day');
  end loop;
 end loop;
 result:=private.stockflow_wallet_account_read('2026-10-30','b2300000-0000-4000-8000-000000000001');
 if result#>>'{coverage,certified}' is distinct from 'true' or result#>>'{row,salesPaise}'<>'101'
  or result#>>'{row,sharePermille}'<>'101' or result#>>'{row,untappedPaise}'<>'900'
  or result#>>'{row,captureGapPaise}'<>'700' or jsonb_typeof(result#>'{row,salesPaise}')<>'number'
  or result#>>'{current,unallocatedPaise}'<>'601' or result#>>'{current,divisions,0,code}'<>'BIOCHEM'
  then raise exception '302/3=101; ceil(8000*1001/10000)-101=700 failed: %',result;end if;
 if private.stockflow_wallet_monthly(-2)<>-1 or private.stockflow_wallet_monthly(2)<>1
  or private.stockflow_wallet_monthly(1.5)<>1 or private.stockflow_wallet_monthly(-1.5)<>-1 then raise exception 'Signed half-up rounding failed';end if;
 -- Complete coverage alone is insufficient: any one differing month closes the entire read.
 begin
  insert into private.stockflow_sales_control_imports(company_id,source_version,valid_months,imported_at)
  values('wallet-test','wallet-mismatch',array[date '2026-08-01'],clock_timestamp()+interval '2 days');
  insert into private.stockflow_sales_control_totals(company_id,month,kind,source_key,net_paise,source_version)
  values('wallet-test','2026-08-01','sales_ledger','sales',1,'wallet-mismatch');
  result:=private.stockflow_wallet_account_read('2026-10-30','b2300000-0000-4000-8000-000000000001');
  if result#>>'{coverage,certified}' is distinct from 'false' or result#>'{row,salesPaise}' is distinct from 'null'::jsonb
   or strpos(result#>>'{coverage,reason}','differs')=0 then raise exception 'Differing monthly control certified';end if;
  raise sqlstate 'ZW007';
 exception when sqlstate 'ZW007' then null;
 end;
 -- A second linked company must certify too, even if the first company matches.
 begin
  insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
  values('wallet-second-company','ledger','b2300000-0000-4000-8000-000000000001','test');
  insert into private.stockflow_economic_source_coverage(company_id,window_from,window_to,source_version)
  values('wallet-second-company','2026-07-01','2026-10-01','wallet-second');
  result:=private.stockflow_wallet_account_read('2026-10-30','b2300000-0000-4000-8000-000000000001');
  if result#>>'{coverage,certified}' is distinct from 'false' or result#>'{row,salesPaise}' is distinct from 'null'::jsonb
   or strpos(result#>>'{coverage,reason}','no_control')=0 then raise exception 'Second company with missing controls certified';end if;
  raise sqlstate 'ZW007';
 exception when sqlstate 'ZW007' then null;
 end;
 raise notice 'PASS W7 certified signed latest-revision sales, window boundaries and half-up monthly rounding';

 result:=private.stockflow_wallet_workspace_read('2026-10-30','focus',1,'WALLET');
 if result->>'total'<>'2' or result#>>'{summary,focusCount}'<>'2' or result#>>'{summary,focusGapPaise}'<>'1300'
  or result#>>'{rows,0,customerId}'<>'b2300000-0000-4000-8000-000000000001'
  or result#>>'{rows,1,customerId}'<>'b2300000-0000-4000-8000-000000000002'
  then raise exception '60%% of gap 1901: prefix 700+600; tie by name/id failed: %',result;end if;
 -- Filtering must not recompute the band.
 result:=private.stockflow_wallet_workspace_read('2026-10-30','focus',1,'Beta');
 if result->>'total'<>'1' then raise exception 'Search changed global focus prefix';end if;
 raise notice 'PASS W8 hand-computed shortest focus prefix with deterministic name/id ties';

 result:=private.stockflow_wallet_account_read('2026-10-30','b2300000-0000-4000-8000-000000000005');
 if result#>'{row,sharePermille}' is distinct from 'null'::jsonb or result#>'{row,captureGapPaise}' is distinct from 'null'::jsonb
  or result#>>'{row,salesPaise}'<>'1' or result->'current' is distinct from 'null'::jsonb then raise exception 'No estimate figures failed: %',result;end if;
 result:=private.stockflow_wallet_account_read('2026-10-30','b2300000-0000-4000-8000-000000000006');
 if result#>>'{row,salesPaise}'<>'-1' or result#>'{row,sharePermille}' is distinct from 'null'::jsonb then raise exception 'Zero wallet/negative sales failed';end if;
 result:=private.stockflow_wallet_account_read('2026-10-30','b2300000-0000-4000-8000-000000000004');
 if result#>>'{row,belowSales}'<>'true' or result#>>'{row,stale}'<>'true' then raise exception 'Below sales/stale flags failed';end if;
 -- All fixture snapshots are March 30: exactly six months old on September 30, stale on October 30.
 result:=private.stockflow_wallet_account_read('2026-09-30','b2300000-0000-4000-8000-000000000004');
 if result#>>'{row,stale}'<>'false' then raise exception 'Stale boundary must be strict';end if;
 result:=private.stockflow_wallet_workspace_read('2026-10-30','all',1,'WALLET');
 -- Other fixture companies may have unlinked ledgers: assert the exact delta in a subtransaction.
 declare baseline numeric; baseline_count bigint;
 begin
  baseline:=(result#>>'{summary,unlinkedSalesPaise}')::numeric; baseline_count:=(result#>>'{summary,unlinkedLedgers}')::bigint;
  if baseline_count<1 then raise exception 'Unlinked ledger missing';end if;
  insert into private.stockflow_customers(id,name,tally_key,city,created_by_email) values
  ('b2300000-0000-4000-8000-000000000007','WALLET Late link','wallet-g',null,'test');
  insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
  values('wallet-test','unlinked-ledger','b2300000-0000-4000-8000-000000000007','test');
  result:=private.stockflow_wallet_workspace_read('2026-10-30','all',1,'WALLET');
  if (result#>>'{summary,unlinkedLedgers}')::bigint<>baseline_count-1
   or (result#>>'{summary,unlinkedSalesPaise}')::numeric not between baseline-3 and baseline-2 then raise exception 'Unlinked ledger not separately summed';end if;
  select value into row_data from jsonb_array_elements(result->'rows') where value->>'customerId'='b2300000-0000-4000-8000-000000000007';
  if (row_data->>'salesPaise')::numeric is distinct from private.stockflow_wallet_monthly(8) then raise exception 'Newly linked ledger monthly sales incorrect';end if;
  raise sqlstate 'ZW009';
 exception when sqlstate 'ZW009' then null;
 end;
 raise notice 'PASS W9 no-estimate/zero share, below-sales, strict stale boundary and separate unlinked line';

 payload:=pg_temp.wallet_payload(1,900,a)||'{"requestId":"wallet-replay-lowered","loweredReason":"Revised evidence","asOf":"2026-04-01"}';
 original:=pg_temp.wallet_command('record_wallet_snapshot',payload);
 select count(*) into before_count from private.stockflow_wallet_snapshots;
 select count(*) into audit_count from private.stockflow_economic_audit audit_row where audit_row.action='record_wallet_snapshot';
 result:=pg_temp.wallet_command('record_wallet_snapshot',payload);
 if result is distinct from original or (select count(*) from private.stockflow_wallet_snapshots)<>before_count
  or (select count(*) from private.stockflow_economic_audit audit_row where audit_row.action='record_wallet_snapshot')<>audit_count then raise exception 'Snapshot replay duplicated state';end if;
 payload:='{"requestId":"wallet-policy-test-01","walletShareTargetBps":8000,"focusBandBps":6000,"staleAfterMonths":6,"note":"Fixture policy","expectedVersion":1}';
 result:=pg_temp.wallet_command('set_wallet_policy',payload);
  if result is distinct from '{"ok":true,"version":2}'::jsonb or (select count(*) from private.stockflow_wallet_policies)<>2
   or (select count(*) from private.stockflow_economic_audit audit_row where audit_row.action='set_wallet_policy')<>1 then raise exception 'Policy replay duplicated state';end if;
 result:=private.stockflow_wallet_account_read('2026-10-30','b2300000-0000-4000-8000-000000000001');
 if result#>>'{current,id}' is distinct from original->>'snapshotId' or jsonb_array_length(result->'history')<>2
  or result#>'{current,verifiedBy}' is distinct from 'null'::jsonb then raise exception 'Append-only history/current order failed';end if;
 raise notice 'PASS W10 snapshot and policy receipts replay original results without duplicate rows or audits';
end$checks$;
rollback;
