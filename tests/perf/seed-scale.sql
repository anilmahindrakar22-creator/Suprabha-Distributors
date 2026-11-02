\set ON_ERROR_STOP on
-- Disposable, fully replayed local database only. Deliberately fails on a second
-- seed: the runner always creates a fresh replay. No trigger bypasses.
begin;
set local timezone = 'Asia/Kolkata';
create function pg_temp.perf_id(kind text, n integer) returns uuid
language sql immutable as $$ select md5('PERF '||kind||' '||n)::uuid $$;

insert into private.stockflow_gateway_config(name,secret_sha256)
values ('orders',encode(extensions.digest('PERF local gateway 20261102','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,status)
select 'perf-admin-'||n||'@test.local','administrator','active' from generate_series(1,3) n;
insert into private.stockflow_customers(id,name,tally_key,city,created_by_email)
select pg_temp.perf_id('customer',n),'PERF Lab '||lpad(n::text,3,'0'),'PERF LEDGER '||n,
 case when n>422 then '' else 'Kalaburagi' end,'perf-admin-1@test.local'
from generate_series(1,464) n;
insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
select 'PERF company','PERF LEDGER '||n,pg_temp.perf_id('customer',n),'perf-admin-1@test.local'
from generate_series(1,169) n;

-- First ten labs have one invoice every month, with precisely 40% less net
-- sales in Aug-Oct 2026. The remaining invoices span the other 159 labs.
create temporary table perf_vouchers on commit drop as
with distribution as (
 select n,case when n<=130 then (n-1)/13+1 else 11+(n-131)%159 end customer,
 case when n<=130 then (n-1)%13 else ((n-131)/159+(n-131)%159)%13 end month_no
 from generate_series(1,1374) n
)
select *,case when n=1 then date '2025-10-03' when n=1374 then date '2026-10-31'
 else (date '2025-10-01'+month_no*interval '1 month')::date+2+(n%25) end business_date,
 case when n<=703 then 6 else 5 end line_count,
 case when customer<=10 then case when month_no>=10 then 3600000 else 6000000 end
 else 500000+(customer%20)*10000 end::bigint net
from distribution;
insert into private.stockflow_economic_source_vouchers
 (id,company_id,source_id,source_revision,business_date,customer_source_id,kind,evidence)
select pg_temp.perf_id('voucher',n),'PERF company','PERF SALE '||n,1,business_date,
 'PERF LEDGER '||customer,'sale',jsonb_build_object('synthetic',true,'number',n)
from perf_vouchers;
-- 703 six-line invoices + 671 five-line invoices = 7573 lines. Integer
-- remainder goes on the first line so invoice totals remain exact.
insert into private.stockflow_economic_source_lines
 (id,voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
select md5('PERF line '||n||' '||line_no)::uuid,pg_temp.perf_id('voucher',n),line_no::text,
 'PERF REAGENT '||(1+(n+line_no)%40),1+(n%5),'Nos',
 net/line_count+case when line_no=1 then net%line_count else 0 end,'{"synthetic":true}'
from perf_vouchers cross join lateral generate_series(1,line_count) line_no;

-- Same source/control write path as recover_signal.sql and today_decisions.sql.
-- Wallet certification is global across linked companies. Certify fixture
-- companies too, using their actual net totals; never delete fixture evidence.
do $$
declare company text; months date[]; m date; imported timestamptz;
begin
 select array_agg(mo::date order by mo) into months
 from generate_series(timestamp '2025-11-01',timestamp '2026-10-01',interval '1 month') mo;
 select greatest(clock_timestamp(),coalesce(max(recorded_at),clock_timestamp()))+interval '1 day'
 into imported from private.stockflow_economic_import_exceptions;
 for company in select distinct company_id from private.stockflow_economic_customer_identities loop
  insert into private.stockflow_economic_source_coverage(company_id,window_from,window_to,source_version,imported_at)
  values(company,'2025-11-01','2026-11-01','PERF certified',imported);
  insert into private.stockflow_sales_control_imports(company_id,source_version,valid_months,imported_at)
  values(company,'PERF certified',months,imported);
  foreach m in array months loop
   insert into private.stockflow_sales_control_totals(company_id,month,kind,source_key,net_paise,source_version,imported_at)
   values(company,m,'sales_ledger','sales',
    (private.stockflow_sales_reconciliation(company,m)->>'appNetPaise')::bigint,'PERF certified',imported);
   if private.stockflow_sales_reconciliation(company,m)->>'state'<>'matches'
    or private.stockflow_sales_coverage_status(company,m,(m+interval '1 month')::date-1)->>'complete'<>'true'
    then raise exception 'PERF certification failed: % %',company,m;end if;
  end loop;
 end loop;
end $$;

do $$
declare n integer; h integer; previous uuid; result jsonb; order_id uuid; installation uuid;
 key constant text := 'PERF local gateway 20261102';
 actor constant text := 'perf-admin-1@test.local';
begin
 -- Ten labs with three history rows, thirty with two, sixty with one = 150.
 for n in 1..100 loop
  previous:=null;
  for h in 1..case when n<=10 then 3 when n<=40 then 2 else 1 end loop
   result:=public.stockflow_wallet_gateway(key,actor,'record_wallet_snapshot',jsonb_build_object(
    'requestId','PERF snapshot '||n||' '||h,'customerId',pg_temp.perf_id('customer',n),
    'monthlyWalletPaise',15000000+n*10000+h*1000,'method','manager_estimate',
    'source','PERF synthetic estimate','confidence','medium','asOf',current_date-4+h,
    'note','PERF synthetic history','loweredReason',null,'divisions','[]'::jsonb,
    'expectedCurrentSnapshotId',previous));
   previous:=(result->>'snapshotId')::uuid;
   if previous is null then raise exception 'PERF snapshot failed: %',result;end if;
  end loop;
 end loop;
 for n in 11..50 loop
  perform public.stockflow_opportunity_gateway(key,actor,'open_opportunity',jsonb_build_object(
   'requestId','PERF opportunity '||n,'customerId',pg_temp.perf_id('customer',n),
   'kind','capture','reason','PERF synthetic opportunity'));
 end loop;
 for n in 1..20 loop
  perform public.stockflow_accounts_gateway(key,actor,'record_lab_size',jsonb_build_object(
   'idempotencyKey','PERF lab report '||n,'customerId',pg_temp.perf_id('customer',n),
   'testsPerDay',50+n*5,'basis','lab_said','statedMonthlySpendPaise',20000000+n*10000,
   'note','PERF synthetic report'));
 end loop;
 for n in 1..422 loop
  perform public.stockflow_accounts_gateway(key,actor,'set_location',jsonb_build_object(
   'idempotencyKey','PERF synthetic location '||n,'customerId',pg_temp.perf_id('customer',n),'expectedVersion',null)
   ||case when n<=120 then jsonb_build_object('precision','pin','source','manual_pin',
     'latitude',(16.5+(n%40)*0.025)::text,'longitude',(76.0+(n%30)*0.025)::text)
    else jsonb_build_object('precision','town','town','Kalaburagi','source','town') end);
 end loop;
 -- Historical INSERT approach from instrument_register.sql; completed inserts
 -- still pass the real instrument assignment and origin constraints.
 for n in 1..2 loop
  order_id:=pg_temp.perf_id('order',n);
  insert into private.stockflow_orders(id,customer_id,customer_name,source,status,idempotency_key,created_by_email,updated_by_email)
  values(order_id,pg_temp.perf_id('customer',n),'PERF Lab '||lpad(n::text,3,'0'),
   'phone','delivered','PERF order '||n,actor,actor);
  insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,quantity)
  values(order_id,'PERF INSTRUMENT '||n,'PERF Instrument '||n,1);
  installation:=pg_temp.perf_id('installation',n);
  insert into private.stockflow_equipment_installations
   (id,order_id,tally_key,item_name,status,scheduled_date,serial_number,created_by_email,completed_at)
  values(installation,order_id,'PERF INSTRUMENT '||n,'PERF Instrument '||n,'completed',
   current_date-60,'PERF SERIAL '||n,actor,now()-interval '60 days');
 end loop;
end $$;

do $$
declare customers bigint; vouchers bigint; lines bigint; snapshots bigint; recover jsonb;
begin
 select count(*) into customers from private.stockflow_customers where name like 'PERF %';
 select count(*) into vouchers from private.stockflow_economic_source_vouchers where company_id='PERF company';
 select count(*) into lines from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where v.company_id='PERF company';
 select count(*) into snapshots from private.stockflow_wallet_snapshots s join private.stockflow_customers c on c.id=s.customer_id where c.name like 'PERF %';
 if (customers,vouchers,lines,snapshots) is distinct from (464::bigint,1374::bigint,7573::bigint,150::bigint)
 then raise exception 'PERF scale mismatch';end if;
 if (select count(*) from private.stockflow_customers where name like 'PERF %' and city='')<>42
 or (select count(distinct customer_source_id) from private.stockflow_economic_source_vouchers where company_id='PERF company')<>169
 or (select min(business_date) from private.stockflow_economic_source_vouchers where company_id='PERF company')<>date '2025-10-03'
 or (select max(business_date) from private.stockflow_economic_source_vouchers where company_id='PERF company')<>date '2026-10-31'
 or (select count(*) from public.stockflow_members where email like 'perf-admin-%@test.local' and role='administrator')<>3
 or (select count(*) from private.stockflow_equipment_installations where item_name like 'PERF %')<>2
 or (select count(*) from private.stockflow_customer_locations l join private.stockflow_customers c on c.id=l.customer_id where c.name like 'PERF %' and l.precision='pin')<>120
 or (select count(*) from private.stockflow_customer_locations l join private.stockflow_customers c on c.id=l.customer_id where c.name like 'PERF %' and l.precision='town')<>302
 or (select count(*) from private.stockflow_lab_size_reports s join private.stockflow_customers c on c.id=s.customer_id where c.name like 'PERF %')<>20
 or (select count(*) from private.stockflow_commercial_opportunities o join private.stockflow_customers c on c.id=o.customer_id where c.name like 'PERF %' and not exists(select 1 from private.stockflow_commercial_opportunity_closures cl where cl.opportunity_id=o.id))<>40
 then raise exception 'PERF distribution mismatch';end if;
 recover:=private.stockflow_recover_read(current_date);
 if (select count(*) from jsonb_array_elements(recover->'rows') r where r->>'name' like 'PERF %')<>10
 or private.stockflow_wallet_read(current_date)#>>'{coverage,certified}' is distinct from 'true'
 then raise exception 'PERF needs certified current reads and ten Recover rows (baseline month: November 2026)';end if;
 raise notice 'seeded: customers=%, vouchers=%, lines=%, snapshots=%',customers,vouchers,lines,snapshots;
end $$;
commit;
-- Match normal post-import planner statistics without timing this maintenance.
analyze;
