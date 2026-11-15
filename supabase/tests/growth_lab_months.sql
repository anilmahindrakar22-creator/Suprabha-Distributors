begin;
set local statement_timeout='300s';
set local lock_timeout='60s';
-- Charts C2 fixtures use the gl- prefix and generic names only.

create function pg_temp.gl_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Growth lab months assertion failed: %',label;end if;end$$;

create function pg_temp.gl_voucher(src text,lab text,d date,net bigint,kind text default 'sale',
 revision integer default 1,cancelled boolean default false,company text default 'gl-co') returns void language plpgsql as $$
declare voucher uuid;
begin
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,kind,cancelled,evidence)
 values(company,src,revision,d,lab,kind,cancelled,'{}') returning id into voucher;
 insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
 values(voucher,'1','gl-item',1,'pack',net,'{}');
end$$;

create function pg_temp.gl_call(payload jsonb default '{}',actor text default 'management') returns jsonb language sql as $$
 select public.stockflow_growth_gateway('growth-lab-months-key','gl-'||actor||'@test.local','get_growth_lab_months',payload)
$$;
create function pg_temp.gl_row(result jsonb,lab_key text) returns jsonb language sql as $$
 select value from jsonb_array_elements(result->'rows') where value->>'labKey'=lab_key
$$;

insert into private.stockflow_gateway_config(name,secret_sha256)
values('orders',encode(extensions.digest('growth-lab-months-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,roles,status)
select 'gl-'||r||'@test.local',r,array[r],'active'
from unnest(array['administrator','management','sales','operations']) r;

-- The gateway reads a fixed day: window 2030-07-01 to 2031-07-01.
do $clock$
declare f text;
begin
 select pg_get_functiondef('public.stockflow_growth_gateway(text,text,text,jsonb)'::regprocedure) into f;
 execute replace(f,'(now() at time zone ''Asia/Kolkata'')::date','''2031-07-15''::date');
end$clock$;

do $empty$
declare r jsonb;
begin
 if exists(select 1 from private.stockflow_economic_source_vouchers
  where business_date>='2030-07-01' and business_date<'2031-07-01') then
  raise exception 'Growth lab months precondition: the fixed window already holds vouchers';end if;
 r:=pg_temp.gl_call();
 perform pg_temp.gl_assert(r->'window'='{"from":"2030-07-01","to":"2031-07-01"}'::jsonb
  and jsonb_array_length(r->'months')=12 and r->'totalLabs'='0'::jsonb and r->'rows'='[]'::jsonb,'empty window');
 raise notice 'PASS empty window';
end$empty$;

do $fixture$
declare customer uuid:=gen_random_uuid();
begin
 -- Lab A is linked to a customer; lab B only has a ledger name.
 insert into private.stockflow_customers(id,name,tally_key,city,created_by_email)
 values(customer,'Lab A linked','gl-linked','Town A','fixture');
 insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
 values('gl-co','gl-lab-a',customer,'fixture');
 insert into private.stockflow_economic_ledger_generations(company_id,source_version,observed_at,valid,catalog_version,content_hash,row_count)
 values('gl-co','gl-current','2031-07-15',true,'gl-current','gl-current',2);
 insert into private.stockflow_economic_ledger_masters(company_id,source_version,guid,name)
 values('gl-co','gl-current','gl-lab-a','Ledger A'),('gl-co','gl-current','gl-lab-b','Ledger B');

 -- Lab A: Jul 150000, Sep 200000-30000, Nov -20000 (returns only), Dec 40000 (moved revision).
 perform pg_temp.gl_voucher('a-1','gl-lab-a','2030-07-10',100000);
 perform pg_temp.gl_voucher('a-2','gl-lab-a','2030-07-20',50000);
 perform pg_temp.gl_voucher('a-3','gl-lab-a','2030-09-05',200000);
 perform pg_temp.gl_voucher('a-4','gl-lab-a','2030-09-20',-30000,'return');
 perform pg_temp.gl_voucher('a-5','gl-lab-a','2030-11-12',-20000,'credit');
 -- Cancelled: never counted.
 perform pg_temp.gl_voucher('a-cancelled','gl-lab-a','2030-08-10',999999,'sale',1,true);
 -- Superseded: revision 1 in October is replaced by revision 2 in December.
 perform pg_temp.gl_voucher('a-moved','gl-lab-a','2030-10-05',70000);
 perform pg_temp.gl_voucher('a-moved','gl-lab-a','2030-12-05',40000,'sale',2);
 -- Superseded by a revision after the window: gone from the window.
 perform pg_temp.gl_voucher('a-left','gl-lab-a','2031-01-10',500000);
 perform pg_temp.gl_voucher('a-left','gl-lab-a','2031-07-05',500000,'sale',2);
 -- Superseded by a cancelled revision: gone.
 perform pg_temp.gl_voucher('a-void','gl-lab-a','2031-02-10',800000);
 perform pg_temp.gl_voucher('a-void','gl-lab-a','2031-02-10',800000,'sale',2,true);
 -- Not sales: a purchase is outside the read. Boundaries: the window end is excluded.
 perform pg_temp.gl_voucher('a-buy','gl-lab-a','2030-07-15',333333,'purchase');
 perform pg_temp.gl_voucher('a-after','gl-lab-a','2031-07-01',444444);
 perform pg_temp.gl_voucher('a-before','gl-lab-a','2030-06-30',555555);

 -- Lab B (60000, first and last window day), the NULL ledger (60000) and the
 -- same ledger id in another company (60000) tie.
 perform pg_temp.gl_voucher('b-1','gl-lab-b','2030-07-01',25000);
 perform pg_temp.gl_voucher('b-2','gl-lab-b','2031-06-30',35000);
 perform pg_temp.gl_voucher('n-1',null,'2031-03-03',60000);
 perform pg_temp.gl_voucher('a-1','gl-lab-a','2031-04-04',60000,'sale',1,false,'gl-co2');
 -- A lab that nets to exactly zero.
 perform pg_temp.gl_voucher('z-1','gl-lab-zero','2030-10-10',10000);
 perform pg_temp.gl_voucher('z-2','gl-lab-zero','2030-11-10',-10000,'return');
end$fixture$;

do $checks$
declare today date:='2031-07-15'; r jsonb; entry jsonb; field text; n numeric; expected numeric;
 started timestamptz; elapsed interval; keys text[];
begin
 started:=clock_timestamp();r:=pg_temp.gl_call();elapsed:=clock_timestamp()-started;
 raise notice 'get_growth_lab_months duration %',elapsed;
 perform pg_temp.gl_assert(elapsed<interval '2 seconds','read under 2 seconds');
 perform pg_temp.gl_assert(r=private.stockflow_growth_lab_months_read(today),'gateway returns the private read');
 perform pg_temp.gl_assert((select array_agg(k order by k)=array['months','rows','totalLabs','window'] from jsonb_object_keys(r) k),'response shape');
 for entry in select value from jsonb_array_elements(r->'rows') loop
  perform pg_temp.gl_assert((select array_agg(k order by k)=array['buyingMonths','customerId','labKey','monthsPaise','name','totalPaise','town']
   from jsonb_object_keys(entry) k),'row shape');
 end loop;

 -- L1: the window and its 12 month keys in order.
 perform pg_temp.gl_assert(r->'window'='{"from":"2030-07-01","to":"2031-07-01"}'::jsonb
  and r->'months'='["2030-07","2030-08","2030-09","2030-10","2030-11","2030-12","2031-01","2031-02","2031-03","2031-04","2031-05","2031-06"]'::jsonb,'L1 months');
 raise notice 'PASS L1 months';

 -- L2: months add up to the total, and the total is the lab's latest-revision sales.
 entry:=pg_temp.gl_row(r,'gl-co|gl-lab-a');
 perform pg_temp.gl_assert(entry->'monthsPaise'='[150000,0,170000,0,-20000,40000,0,0,0,0,0,0]'::jsonb
  and entry->'totalPaise'='340000'::jsonb,'L2 lab A months');
 select sum(l.net_sales_paise) into expected
 from private.stockflow_economic_source_vouchers v join private.stockflow_economic_source_lines l on l.voucher_id=v.id
 where v.company_id='gl-co' and v.customer_source_id='gl-lab-a' and v.business_date>='2030-07-01' and v.business_date<'2031-07-01'
  and not v.cancelled and v.kind in ('sale','return','credit')
  and v.source_revision=(select max(x.source_revision) from private.stockflow_economic_source_vouchers x
   where x.company_id=v.company_id and x.source_id=v.source_id);
 perform pg_temp.gl_assert(expected=340000 and (entry->>'totalPaise')::numeric=expected,'L2 total equals voucher sales');
 for entry in select value from jsonb_array_elements(r->'rows') loop
  select sum(v::text::numeric),count(*) into n,expected from jsonb_array_elements(entry->'monthsPaise') v;
  perform pg_temp.gl_assert(expected=12 and n=(entry->>'totalPaise')::numeric,'L2 months sum to total '||(entry->>'labKey'));
 end loop;
 entry:=pg_temp.gl_row(r,'gl-co|gl-lab-b');
 perform pg_temp.gl_assert(entry->'monthsPaise'='[25000,0,0,0,0,0,0,0,0,0,0,35000]'::jsonb,'L2 window edge days');
 raise notice 'PASS L2 totals';

 -- L3: cancelled, superseded, moved-out and voided vouchers are excluded.
 entry:=pg_temp.gl_row(r,'gl-co|gl-lab-a');
 perform pg_temp.gl_assert(entry#>'{monthsPaise,1}'='0'::jsonb,'L3 cancelled voucher excluded');
 perform pg_temp.gl_assert(entry#>'{monthsPaise,3}'='0'::jsonb and entry#>'{monthsPaise,5}'='40000'::jsonb,'L3 superseded revision excluded');
 perform pg_temp.gl_assert(entry#>'{monthsPaise,6}'='0'::jsonb,'L3 revision moved out of the window');
 perform pg_temp.gl_assert(entry#>'{monthsPaise,7}'='0'::jsonb,'L3 cancelled latest revision');
 raise notice 'PASS L3 revisions';

 -- L4: returns and credits reduce the month; a returns-only month is negative.
 perform pg_temp.gl_assert(entry#>'{monthsPaise,2}'='170000'::jsonb and entry#>'{monthsPaise,4}'='-20000'::jsonb,'L4 returns reduce the month');
 raise notice 'PASS L4 returns';

 -- L7: buying months count months with net above zero only.
 perform pg_temp.gl_assert(entry->'buyingMonths'='3'::jsonb
  and pg_temp.gl_row(r,'gl-co|gl-lab-b')->'buyingMonths'='2'::jsonb,'L7 buying months');
 for entry in select value from jsonb_array_elements(r->'rows') loop
  select count(*) into n from jsonb_array_elements(entry->'monthsPaise') v where v::text::numeric>0;
  perform pg_temp.gl_assert(n=(entry->>'buyingMonths')::numeric and jsonb_typeof(entry->'buyingMonths')='number','L7 buying months '||(entry->>'labKey'));
 end loop;
 raise notice 'PASS L7 buying months';

 -- L8: customer name and town when linked; the ledger name otherwise; the
 -- NULL ledger is one lab per company without a name.
 entry:=pg_temp.gl_row(r,'gl-co|gl-lab-a');
 perform pg_temp.gl_assert(entry->>'name'='Lab A linked' and entry->>'town'='Town A'
  and entry->>'customerId'=(select id::text from private.stockflow_customers where tally_key='gl-linked'),'L8 linked lab');
 entry:=pg_temp.gl_row(r,'gl-co|gl-lab-b');
 perform pg_temp.gl_assert(entry->>'name'='Ledger B' and entry->'town'='null'::jsonb and entry->'customerId'='null'::jsonb,'L8 ledger name fallback');
 entry:=pg_temp.gl_row(r,'gl-co2|gl-lab-a');
 perform pg_temp.gl_assert(entry->'name'='null'::jsonb and entry->'customerId'='null'::jsonb
  and entry->'totalPaise'='60000'::jsonb,'L8 same ledger id in another company is another lab');
 entry:=pg_temp.gl_row(r,'gl-co|');
 perform pg_temp.gl_assert(entry->'name'='null'::jsonb and entry->'customerId'='null'::jsonb
  and entry->'totalPaise'='60000'::jsonb,'L8 NULL ledger lab');
 raise notice 'PASS L8 names';

 -- L9: every paise value is a JSON integer.
 select count(*) into n from (
  select e->'totalPaise' v from jsonb_array_elements(r->'rows') e
  union all select m from jsonb_array_elements(r->'rows') e,jsonb_array_elements(e->'monthsPaise') m
 ) p where jsonb_typeof(p.v) is distinct from 'number' or p.v::text !~ '^-?[0-9]+$';
 perform pg_temp.gl_assert(n=0 and jsonb_typeof(r->'totalLabs')='number','L9 integer paise');
 perform pg_temp.gl_assert(private.stockflow_growth_integer_paise(r)=r,'L9 gateway rounding would be a no-op');
 raise notice 'PASS L9 integers';

 -- L11: with no more than 20 labs, the totals add up to the Growth tree revenue.
 select sum((value->>'totalPaise')::numeric) into n from jsonb_array_elements(r->'rows');
 perform pg_temp.gl_assert(jsonb_array_length(r->'rows')=4 and r->'totalLabs'='4'::jsonb and n=520000
  and n=(private.stockflow_growth_read(today,array['management'])->'tree'->>'revenuePaise')::numeric,'L11 revenue identity');
 raise notice 'PASS L11 revenue identity';

 -- L6: labs netting to zero or below are left out and not counted.
 perform pg_temp.gl_voucher('m-1','gl-lab-minus','2030-10-10',-5000,'return');
 r:=pg_temp.gl_call();
 perform pg_temp.gl_assert(pg_temp.gl_row(r,'gl-co|gl-lab-zero') is null and pg_temp.gl_row(r,'gl-co|gl-lab-minus') is null
  and jsonb_array_length(r->'rows')=4 and r->'totalLabs'='4'::jsonb,'L6 non-positive labs excluded');
 for entry in select value from jsonb_array_elements(r->'rows') loop
  perform pg_temp.gl_assert((entry->>'totalPaise')::numeric>0,'L6 positive totals only');
 end loop;
 raise notice 'PASS L6 positive labs';

 -- L5: 18 tied larger labs make 22; the top 20 are cut inside a three-way tie
 -- and ties follow labKey in C collation (upper case before lower case).
 perform pg_temp.gl_assert((select array_agg(value->>'labKey' order by ordinality)
  =array['gl-co|gl-lab-a','gl-co2|gl-lab-a','gl-co|','gl-co|gl-lab-b']
  from jsonb_array_elements(r->'rows') with ordinality),'L5 order before the cap');
 perform pg_temp.gl_voucher('t-0','gl-Zed','2030-08-08',1000000);
 for i in 1..17 loop
  perform pg_temp.gl_voucher('t-'||i,'gl-t'||lpad(i::text,2,'0'),'2030-08-08',1000000);
 end loop;
 r:=pg_temp.gl_call();
 select array_agg(value->>'labKey' order by ordinality) into keys from jsonb_array_elements(r->'rows') with ordinality;
 perform pg_temp.gl_assert(r->'totalLabs'='22'::jsonb and cardinality(keys)=20,'L5 top 20 of 22');
 perform pg_temp.gl_assert(keys[1]='gl-co|gl-Zed' and keys[2]='gl-co|gl-t01' and keys[18]='gl-co|gl-t17'
  and keys[19]='gl-co|gl-lab-a' and keys[20]='gl-co2|gl-lab-a','L5 order and tie at the cap');
 perform pg_temp.gl_assert(pg_temp.gl_row(r,'gl-co|') is null and pg_temp.gl_row(r,'gl-co|gl-lab-b') is null,'L5 tied labs beyond the cap are cut');
 perform pg_temp.gl_assert((select bool_and(prev is null or prev>total or (prev=total and prev_key<key collate "C")) from (
  select (value->>'totalPaise')::numeric total,value->>'labKey' key,
   lag((value->>'totalPaise')::numeric) over(order by ordinality) prev,lag(value->>'labKey') over(order by ordinality) prev_key
  from jsonb_array_elements(r->'rows') with ordinality) o),'L5 total desc then labKey');
 raise notice 'PASS L5 top 20';

 -- L10: exact empty payload, management or administrator only, private function not exposed.
 for entry in select value from jsonb_array_elements('[{"x":1},{"page":1},[],null,"",0]'::jsonb) loop
  begin perform pg_temp.gl_call(entry);raise exception 'L10 accepted payload %',entry;
  exception when sqlstate '22023' then null;end;
 end loop;
 begin perform pg_temp.gl_call(null);raise exception 'L10 accepted a null payload';
 exception when sqlstate '22023' then null;end;
 foreach field in array array['sales','operations'] loop
  begin perform pg_temp.gl_call('{}',field);raise exception 'L10 unauthorized role %',field;
  exception when sqlstate 'PT403' then null;end;
 end loop;
 begin perform pg_temp.gl_call('{}','missing');raise exception 'L10 unknown member accepted';
 exception when sqlstate 'PT403' then null;end;
 perform pg_temp.gl_assert(pg_temp.gl_call('{}','administrator')=r,'L10 administrator read');
 foreach field in array array['public','anon','authenticated','service_role'] loop
  perform pg_temp.gl_assert(not has_function_privilege(field,'private.stockflow_growth_lab_months_read(date)','execute'),'L10 private ACL '||field);
 end loop;
 perform pg_temp.gl_assert(has_function_privilege('service_role','public.stockflow_growth_gateway(text,text,text,jsonb)','execute')
  and not has_function_privilege('anon','public.stockflow_growth_gateway(text,text,text,jsonb)','execute')
  and not has_function_privilege('authenticated','public.stockflow_growth_gateway(text,text,text,jsonb)','execute'),'L10 gateway ACL');
 -- The brands action still dispatches after the new seam.
 perform pg_temp.gl_assert(public.stockflow_growth_gateway('growth-lab-months-key','gl-management@test.local','get_growth_brands','{}') ? 'rows','L10 brands action intact');
 raise notice 'PASS L10 gateway';
end $checks$;

rollback;
do $$begin
 if exists(select 1 from private.stockflow_economic_source_vouchers where company_id in ('gl-co','gl-co2')) then
  raise exception 'Growth lab months fixture leaked';end if;
 raise notice 'PASS growth lab months L1-L11';
end$$;
