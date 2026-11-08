begin;
set local lock_timeout='60s';
set local statement_timeout='300s';

create function pg_temp.growth_sale(src text,lab text,d date,amount bigint,k text default 'sale',rev bigint default 1,cancel boolean default false)
returns void language plpgsql as $$
declare v uuid;
begin
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,kind,cancelled,evidence)
 values('growth-test-co',src,rev,d,lab,k,cancel,'{}') returning id into v;
 insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
 values(v,'1','growth-item',1,'pack',amount,'{}');
end$$;
create function pg_temp.growth_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Growth assertion failed: %',label;end if;end$$;

do $test$
declare r jsonb; b jsonb; before_data jsonb; today date:=(now() at time zone 'Asia/Kolkata')::date;
 started timestamptz:=clock_timestamp(); c text; m date; net bigint; i integer; rejected boolean;
 customer uuid:=gen_random_uuid(); visit uuid:=gen_random_uuid();
begin
 raise notice 'Growth phase G1-G3: window, bulk threshold and buying months';
 before_data:=private.stockflow_growth_read('2031-07-15',array['management']);
 perform pg_temp.growth_assert((before_data->>'companyCount')::int=0,'isolated fixed window');
 perform pg_temp.growth_assert(before_data->>'confirmedReason'='No sales in window','empty scope');
 perform pg_temp.growth_assert(before_data#>'{tree,perBuyingMonthPaise}'='null'::jsonb,'undefined division is null');
 perform pg_temp.growth_sale('a1','A','2030-07-01',100);
 perform pg_temp.growth_sale('a2','A','2031-01-01',200);
 perform pg_temp.growth_sale('b1','B','2030-08-01',19999999);
 perform pg_temp.growth_sale('b2','B','2031-02-01',20000000);
 perform pg_temp.growth_sale('c1','C','2030-09-01',-99,'return');
 perform pg_temp.growth_sale('c2','C','2031-03-01',300);
 r:=private.stockflow_growth_read('2031-07-15',array['management']);
 perform pg_temp.growth_assert(r->'window'='{"from":"2030-07-01","to":"2031-07-01","h1From":"2030-07-01","h2From":"2031-01-01"}'::jsonb,'G1 bounds');
 perform pg_temp.growth_assert(r->'tree'='{"revenuePaise":40000500,"repeatPaise":20000500,"bulkPaise":20000000,"bulkInvoices":1,"bulkReturns":0,"labsBuying":3,"buyingMonths":4,"perBuyingMonthPaise":5000125}'::jsonb,'G2-G3 tree');
 perform pg_temp.growth_assert((r#>>'{halves,0,revenuePaise}')::numeric=20000000 and (r#>>'{halves,1,revenuePaise}')::numeric=20000500,'G1 halves');
 perform pg_temp.growth_assert(3*(4::numeric/3)*5000125 between 20000499 and 20000501,'G3 identity');

 raise notice 'Growth phase G2: bulk return and repeat return thresholds';
 before_data:=r;
 perform pg_temp.growth_sale('bulk-return','B','2031-02-01',-20000000,'return');
 perform pg_temp.growth_sale('repeat-return','B','2031-02-01',-19999999,'return');
 r:=private.stockflow_growth_read('2031-07-15',array['management']);
 perform pg_temp.growth_assert(r->'tree'='{"revenuePaise":501,"repeatPaise":501,"bulkPaise":0,"bulkInvoices":1,"bulkReturns":1,"labsBuying":3,"buyingMonths":4,"perBuyingMonthPaise":125}'::jsonb,'G2 return thresholds and separate counts');
 perform pg_temp.growth_assert((r#>>'{halves,0,bulkReturns}')::int=0 and (r#>>'{halves,1,bulkReturns}')::int=1
  and (r#>>'{halves,1,bulkInvoices}')::int=1 and (r#>>'{halves,1,bulkPaise}')::numeric=0,'G2 half return and invoice counts');
 perform pg_temp.growth_assert((r#>>'{tree,repeatPaise}')::numeric-(before_data#>>'{tree,repeatPaise}')::numeric=-19999999
  and (r#>>'{tree,bulkPaise}')::numeric-(before_data#>>'{tree,bulkPaise}')::numeric=-20000000,'G2 signed return allocation');
 -- A credit at the same negative threshold has the identical bulk treatment.
 before_data:=r;
 perform pg_temp.growth_sale('bulk-return','B','2031-02-01',-20000000,'credit',2);
 r:=private.stockflow_growth_read('2031-07-15',array['management']);
 perform pg_temp.growth_assert(r->'tree'=before_data->'tree' and r->'bridge'=before_data->'bridge','G2 bulk credit and bridge parity');

 raise notice 'Growth phase G4: revisions, exclusion and half-open dates';
 perform pg_temp.growth_sale('revision','A','2030-07-01',999999);
 perform pg_temp.growth_sale('revision','A','2030-07-01',200,'sale',2);
 perform pg_temp.growth_sale('cancel','A','2030-07-01',888888);
 perform pg_temp.growth_sale('cancel','A','2030-07-01',888888,'sale',2,true);
 perform pg_temp.growth_sale('purchase','A','2030-07-01',888888,'purchase');
 perform pg_temp.growth_sale('end','A','2031-07-01',888888);
 perform pg_temp.growth_sale('start',null,'2030-07-01',101);
 perform pg_temp.growth_sale('moved','A','2030-07-01',888888);
 perform pg_temp.growth_sale('moved','A','2031-07-01',888888,'sale',2);
 r:=private.stockflow_growth_read('2031-07-15',array['management']);
 perform pg_temp.growth_assert((r#>>'{tree,revenuePaise}')::numeric=802,'G4 included net');
 perform pg_temp.growth_assert((r#>>'{tree,labsBuying}')::int=4,'G4 null ledger');

 raise notice 'Growth phase G5-G6: bridge classes and incomplete confirmation';
 before_data:=r;
 perform pg_temp.growth_sale('new','new','2031-01-01',500);
 perform pg_temp.growth_sale('stop','stopped','2030-07-01',600);
 perform pg_temp.growth_sale('grow1','grew','2030-07-01',100);
 perform pg_temp.growth_sale('grow2','grew','2031-01-01',300);
 perform pg_temp.growth_sale('fall1','fell','2030-07-01',400);
 perform pg_temp.growth_sale('fall2','fell','2031-01-01',100);
 perform pg_temp.growth_sale('same1','same','2030-07-01',700);
 perform pg_temp.growth_sale('same2','same','2031-01-01',700);
 perform pg_temp.growth_sale('other1','other','2030-07-01',-80,'return');
 perform pg_temp.growth_sale('other2','other','2031-01-01',-30,'credit');
 r:=private.stockflow_growth_read('2031-07-15',array['management']);b:=r->'bridge';
 foreach c in array array['new','stopped','grew','fell','same','other'] loop
  perform pg_temp.growth_assert((b#>>array[c,'labs'])::int-(before_data#>>array['bridge',c,'labs'])::int=1,'G5 count '||c);
  perform pg_temp.growth_assert((b#>>array[c,'paise'])::numeric-(before_data#>>array['bridge',c,'paise'])::numeric=
   case c when 'new' then 500 when 'stopped' then 600 when 'grew' then 200 when 'fell' then 300 when 'same' then 0 else 50 end,'G5 paise '||c);
 end loop;
 perform pg_temp.growth_assert((b->>'h1Paise')::numeric+(b#>>'{new,paise}')::numeric-(b#>>'{stopped,paise}')::numeric
  +(b#>>'{grew,paise}')::numeric-(b#>>'{fell,paise}')::numeric+(b#>>'{other,paise}')::numeric=(b->>'h2Paise')::numeric,'G5 identity');
 perform pg_temp.growth_assert(r->>'confirmed'='false' and r->>'confirmedReason' like '%growth-test-co%'
  and r#>>'{tree,revenuePaise}' is not null and r->>'companyCount'='1','G6 incomplete figures');
 perform pg_temp.growth_assert(r#>'{health,gp}'='{"costedPct":null,"computedAt":null}'::jsonb,'G9 no GP run');

 raise notice 'Growth phase G6b: complete coverage and twelve matching months';
 insert into private.stockflow_economic_source_coverage(company_id,window_from,window_to,source_version,imported_at)
 values('growth-test-co','2030-07-01','2031-07-01','growth-complete',clock_timestamp());
 for i in 0..11 loop
  m:=('2030-07-01'::date+i*interval '1 month')::date;
  net:=(private.stockflow_sales_reconciliation('growth-test-co',m)->>'appNetPaise')::bigint;
  insert into private.stockflow_sales_control_imports(company_id,source_version,valid_months)
  values('growth-test-co','growth-control-'||i,array[m]);
  insert into private.stockflow_sales_control_totals(company_id,month,kind,source_key,net_paise,source_version)
  values('growth-test-co',m,'sales_ledger','sales',net,'growth-control-'||i);
 end loop;
 r:=private.stockflow_growth_read('2031-07-15',array['management']);
 perform pg_temp.growth_assert(r->>'confirmed'='true' and r->'confirmedReason'='null'::jsonb,'G6b confirmed');

 raise notice 'Growth phase G7: gateway authorization and strict request shape';
 insert into private.stockflow_gateway_config(name,secret_sha256) values('orders',encode(extensions.digest('growth-key','sha256'),'hex'))
 on conflict(name) do update set secret_sha256=excluded.secret_sha256;
 foreach c in array array['management','administrator','sales','operations'] loop
  insert into public.stockflow_members(email,role,roles,status) values('growth-'||c||'@test.local',c,array[c],'active');
  rejected:=false;
  begin
   r:=public.stockflow_growth_gateway('growth-key','growth-'||c||'@test.local','get_growth');
  exception when sqlstate 'PT403' then rejected:=true;end;
  perform pg_temp.growth_assert(rejected=(c in ('sales','operations')),'G7 role '||c);
 end loop;
 update public.stockflow_members set status='suspended' where email='growth-sales@test.local';
 begin
  perform public.stockflow_growth_gateway('growth-key','growth-sales@test.local','get_growth');
  raise exception 'inactive accepted';
 exception when sqlstate 'PT403' then null;end;
 begin
  perform private.stockflow_growth_read('2031-07-15',array['sales']);raise exception 'private role accepted';
 exception when sqlstate '42501' then null;end;
 begin
  perform public.stockflow_growth_gateway('bad','growth-management@test.local','get_growth');raise exception 'bad key accepted';
 exception when sqlstate '42501' then null;end;
 begin
  perform public.stockflow_growth_gateway('growth-key','growth-management@test.local','unknown');raise exception 'action accepted';
 exception when sqlstate '22023' then null;end;
 begin
  perform public.stockflow_growth_gateway('growth-key','growth-management@test.local','get_growth','{"extra":1}');raise exception 'payload accepted';
 exception when sqlstate '22023' then null;end;

 raise notice 'Growth phase G8: visit and reason counts using real IST date';
 before_data:=private.stockflow_growth_read(today,array['management']);
 insert into private.stockflow_customers(id,name,tally_key,created_by_email) values(customer,'Growth test','growth-test','test');
 insert into private.stockflow_customer_visits(id,customer_id,visited_on,visited_by,outcome,request_id)
 values(visit,customer,today,'growth-management@test.local','met','growth-visit');
 insert into private.stockflow_visit_reasons(visit_id,customer_id,category,source,recorded_by)
 values(visit,customer,'price','lab_said','growth-management@test.local');
 r:=private.stockflow_growth_read(today,array['management']);
 perform pg_temp.growth_assert((r#>>'{health,reasons,visits180}')::int=(before_data#>>'{health,reasons,visits180}')::int+1
  and (r#>>'{health,reasons,visitReasons180}')::int=(before_data#>>'{health,reasons,visitReasons180}')::int+1,'G8 count deltas');
 raise notice 'Growth phase G10: read and fixture duration %',clock_timestamp()-started;
end$test$;
rollback;

-- Runs after rollback to prove fixture isolation, including immutable source rows.
do $$begin
 if exists(select 1 from private.stockflow_economic_source_vouchers where company_id='growth-test-co')
  or exists(select 1 from public.stockflow_members where email like 'growth-%@test.local')
  or exists(select 1 from private.stockflow_customers where tally_key='growth-test') then
  raise exception 'G10 growth fixture leaked';end if;
 raise notice 'PASS growth read G1-G10';
end$$;
