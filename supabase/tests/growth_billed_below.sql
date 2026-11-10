begin;
set local statement_timeout='300s';
set local lock_timeout='60s';

create function pg_temp.b_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Growth billed below assertion failed: %',label;end if;end$$;

create function pg_temp.b_call(payload jsonb default '{"page":1}',actor text default 'management') returns jsonb
language plpgsql as $$
declare started timestamptz:=clock_timestamp(); elapsed interval; result jsonb;
begin
 result:=public.stockflow_growth_gateway('billed-key','billed-'||actor||'@test.local','get_growth_billed_below',payload);
 elapsed:=clock_timestamp()-started;
 raise notice 'B9 billed-below % duration %',payload,elapsed;
 perform pg_temp.b_assert(elapsed<interval '2 seconds','B9 read under 2 s');
 return result;
end$$;

create function pg_temp.b_line(src text,item text default 'main',qty numeric default 1,net bigint default 9000,
 d date default '2030-08-10',lab text default 'linked',kind text default 'sale',revision bigint default 1,
 cancelled boolean default false) returns void language plpgsql as $$
declare voucher uuid;
begin
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,kind,cancelled,evidence)
 values('billed-co',src,revision,d,lab,kind,cancelled,'{}') returning id into voucher;
 insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
 values(voucher,'1',item,qty,'pack',net,'{}');
end$$;

create function pg_temp.b_price(item text,price numeric default 100,status text default 'approved',
 approval timestamptz default '2030-07-01 00:00:00+05:30',valid_from date default '2030-07-01',
 valid_to date default null,version integer default 1,id uuid default extensions.gen_random_uuid())
 returns void language sql as $$
 insert into private.stockflow_customer_product_prices(id,customer_id,tally_item_key,price_amount,status,
  approved_at,valid_from,valid_to,version,source_type,reason,created_by_email,approved_by_email)
 values(id,'f3000000-0000-4000-8000-000000000001','Billed '||item,price,status,
  approval,valid_from,valid_to,version,'customer_contract','fixture','fixture','fixture');
$$;

insert into private.stockflow_gateway_config(name,secret_sha256)
values('orders',encode(extensions.digest('billed-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,roles,status)
select 'billed-'||r||'@test.local',r,array[r],'active'
from unnest(array['administrator','management','sales','operations']) r;
insert into private.stockflow_customers(id,name,tally_key,city,created_by_email)
values('f3000000-0000-4000-8000-000000000001','Billed Lab','billed-linked','Test Town','fixture');
insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
values('billed-co','linked','f3000000-0000-4000-8000-000000000001','fixture');
insert into private.stockflow_products(tally_item_key,name,item_group)
select 'Billed '||x,'Billed '||x,'Billed fixture'
from unnest(array['main','late','expired','future','draft','pending_approval','rejected','cancelled','superseded',
 'overlap','case','space','missing','no-approval','timezone']) x;
insert into private.stockflow_economic_item_catalogs(company_id,source_version,observed_at,content)
values('billed-co','old','2031-07-01','{"products":[{"id":"main","name":"obsolete"}]}');
insert into private.stockflow_economic_item_catalogs(company_id,source_version,observed_at,content)
select 'billed-co','latest','2031-07-02',jsonb_build_object('products',jsonb_agg(jsonb_build_object('id',x,
 'name',case x when 'case' then 'billed case' when 'space' then 'Billed space ' when 'missing' then 'Not in master' else 'Billed '||x end)))
from unnest(array['main','late','expired','future','draft','pending_approval','rejected','cancelled','superseded',
 'overlap','case','space','missing','no-approval','timezone']) x;

-- Freeze only this transaction's gateway clock, exercising the public dispatch.
do $$declare f text;begin
 select pg_get_functiondef('public.stockflow_growth_gateway(text,text,text,jsonb)'::regprocedure) into f;
 execute replace(f,'(now() at time zone ''Asia/Kolkata'')::date','''2031-07-15''::date');
end$$;

create temporary table expected_billed(src text,line_key text default '1',d date default '2030-08-10',gap numeric);

do $tests$
declare r jsonb; before_read jsonb; expected jsonb; actual jsonb; x text; payload jsonb; n integer; page_number integer;
 approved_before bigint;
begin
 select count(*) into approved_before from private.stockflow_customer_product_prices where status='approved';
 r:=pg_temp.b_call();
 perform pg_temp.b_assert(r->>'lines'='0' and r->>'gapPaise'='0' and r->>'unitMismatchLines'='0' and r->'rows'='[]','empty window');
 -- B1. Rs 100 approved, 2.5 units at Rs 90: exactly Rs 25 missed.
 perform pg_temp.b_price('main');
 perform pg_temp.b_line('b1','main',2.5,22500);
 insert into expected_billed(src,gap) values('b1',2500);
 r:=pg_temp.b_call();
 perform pg_temp.b_assert(r->>'lines'='1' and r->>'gapPaise'='2500'
  and r#>'{rows,0}'=jsonb_build_object('date','2030-08-10','customerId','f3000000-0000-4000-8000-000000000001',
   'name','Billed Lab','town','Test Town','itemName','Billed main','quantity',2.5,
   'billedRatePaise',9000,'approvedRatePaise',10000,'gapPaise',2500,'voucherRef','b1'),'B1 exact row and gap');
 -- B2. Both the 99.6% example and the exact 99.5% boundary are tolerated.
 perform pg_temp.b_line('tolerance','main',1,9960);
 perform pg_temp.b_line('tolerance-edge','main',1,9950);
 perform pg_temp.b_assert(pg_temp.b_call()=r,'B2 tolerance');
 -- B3. Late approval, expired/not-yet-valid windows, null approval and Kolkata rollover.
 perform pg_temp.b_price('late',100,'approved','2030-08-11');
 perform pg_temp.b_price('expired',100,'approved','2030-07-01','2030-07-01','2030-08-09');
 perform pg_temp.b_price('future',100,'approved','2030-07-01','2030-08-11');
 perform pg_temp.b_price('no-approval',100,'superseded',null);
 perform pg_temp.b_price('timezone',100,'approved','2030-08-10 18:30:00+00');
 foreach x in array array['late','expired','future','no-approval','timezone'] loop
  perform pg_temp.b_line(x,x);
 end loop;
 perform pg_temp.b_assert(pg_temp.b_call()->'rows'=r->'rows','B3 dates and absent approval');
 -- B4. Invalid statuses never qualify; superseded agreements remain historical evidence.
 foreach x in array array['draft','pending_approval','rejected','cancelled'] loop
  perform pg_temp.b_price(x,100,x);perform pg_temp.b_line(x,x);
 end loop;
 perform pg_temp.b_price('superseded',100,'superseded','2030-08-10 18:29:59+00','2030-08-10','2030-08-10');
 perform pg_temp.b_line('superseded','superseded');
 insert into expected_billed(src,gap) values('superseded',1000);
 r:=pg_temp.b_call();
 perform pg_temp.b_assert(r->>'lines'='2' and r->>'gapPaise'='3500','B4 statuses and inclusive validity/approval date');
 -- B5. Latest approval precedes version, then greatest ID resolves equal versions.
 perform pg_temp.b_price('overlap',80,'superseded','2030-07-01','2030-07-01',null,99);
 perform pg_temp.b_price('overlap',100,'superseded','2030-08-01','2030-07-01',null,1);
 perform pg_temp.b_price('overlap',110,'superseded','2030-08-01','2030-07-01',null,2,'f3000000-0000-4000-8000-000000000010');
 perform pg_temp.b_price('overlap',120,'superseded','2030-08-01','2030-07-01',null,2,'f3000000-0000-4000-8000-000000000011');
 perform pg_temp.b_line('overlap','overlap');
 insert into expected_billed(src,gap) values('overlap',3000);
 r:=pg_temp.b_call();
 perform pg_temp.b_assert(r#>>'{rows,0,voucherRef}'='overlap' and (r#>>'{rows,0,approvedRatePaise}')::numeric=12000
  and r->>'lines'='3' and r->>'gapPaise'='6500','B5 overlap ordering');
 -- B6. Exact matching only, latest catalog names, and no fabricated customer identity.
 perform pg_temp.b_line('unlinked','main',1,9000,'2030-08-10','unlinked');
 perform pg_temp.b_line('no-lab','main',1,9000,'2030-08-10',null);
 foreach x in array array['case','space','missing'] loop
  perform pg_temp.b_price(x);perform pg_temp.b_line(x,x);
 end loop;
 perform pg_temp.b_line('no-catalog','unknown');
 perform pg_temp.b_assert(pg_temp.b_call()->'rows'=r->'rows','B6 linked labs and exact master names only');
 -- B7. Both sides of the unit guard; exact 0.4 and 2.5 are within the band.
 perform pg_temp.b_line('unit-low','main',1,1000);
 perform pg_temp.b_line('unit-high','main',1,25001);
 perform pg_temp.b_line('unit-high-edge','main',1,25000);
 perform pg_temp.b_line('unit-low-edge','main',1,4000);
 insert into expected_billed(src,gap) values('unit-low-edge',6000);
 r:=pg_temp.b_call();
 perform pg_temp.b_assert(r->>'unitMismatchLines'='2' and r->>'lines'='4' and r->>'gapPaise'='12500','B7 unit guard');
 -- Only latest, uncancelled positive sales in the twelve complete months qualify.
 before_read:=r;
 perform pg_temp.b_line('revision');
 perform pg_temp.b_line('revision','main',1,10000,'2030-08-10','linked','sale',2);
 perform pg_temp.b_line('cancelled-voucher');
 perform pg_temp.b_line('cancelled-voucher','main',1,9000,'2030-08-10','linked','sale',2,true);
 perform pg_temp.b_line('changed-date');
 perform pg_temp.b_line('changed-date','main',1,9000,'2031-07-01','linked','sale',2);
 perform pg_temp.b_line('old-window','main',1,9000,'2030-06-30');
 perform pg_temp.b_line('current-month','main',1,9000,'2031-07-01');
 perform pg_temp.b_line('purchase','main',1,9000,'2030-08-10','linked','purchase');
 perform pg_temp.b_line('return','main',-1,-9000,'2030-08-10','linked','return');
 perform pg_temp.b_line('free','main',1,0);
 perform pg_temp.b_line('zero-qty','main',0,9000);
 perform pg_temp.b_line('negative-net','main',1,-9000);
 perform pg_temp.b_assert(pg_temp.b_call()=before_read,'latest revision, kind, window and positivity');
 -- B8. Independent expected ordering spans two pages, including same-voucher line keys.
 for n in 1..24 loop
  x:='page-'||lpad(n::text,2,'0');
  perform pg_temp.b_line(x,'main',1,9000,case when n<=12 then '2030-07-01'::date else '2031-06-30'::date end);
  insert into expected_billed(src,d,gap) values(x,case when n<=12 then '2030-07-01'::date else '2031-06-30'::date end,1000);
 end loop;
 insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
 select id,'0','main',2,'pack',19000,'{}' from private.stockflow_economic_source_vouchers
 where company_id='billed-co' and source_id='page-24';
 insert into expected_billed(src,line_key,d,gap) values('page-24','0','2031-06-30',1000);
 for page_number in 1..3 loop
  r:=pg_temp.b_call(jsonb_build_object('page',page_number));
  select coalesce(jsonb_agg(jsonb_build_object('voucherRef',src,'date',d,'gapPaise',gap,
   'quantity',case when src='page-24' and line_key='0' then 2 when src='b1' then 2.5 else 1 end)
   order by gap desc,d desc,src,line_key),'[]') into expected
  from (select * from expected_billed order by gap desc,d desc,src,line_key limit 20 offset (page_number-1)*20) p;
  select coalesce(jsonb_agg(jsonb_build_object('voucherRef',v->'voucherRef','date',v->'date',
   'gapPaise',v->'gapPaise','quantity',v->'quantity') order by ordinal),'[]') into actual
  from jsonb_array_elements(r->'rows') with ordinality a(v,ordinal);
  perform pg_temp.b_assert(actual=expected and r->>'total'='29' and r->>'lines'='29' and r->>'gapPaise'='37500'
   and r->>'pageSize'='20' and (r->>'page')::integer=page_number
   and (r->>'approvedPricesInUse')::bigint=approved_before+8,
   format('B8 pages, sort and approved status inventory: baseline=%s result=%s expected=%s actual=%s',approved_before,r,expected,actual));
 end loop;
 -- B9. Public validation and authorization, with ACL and timeout regression checks.
 for payload in select v from jsonb_array_elements('[{"page":1,"extra":true},{"page":0},{"page":-1},
  {"page":1.5},{"page":"1"},{"page":null},{"page":2147483648},{"page":99999999999999999999},{},null,[],true]') v loop
  begin perform pg_temp.b_call(payload);raise exception 'B9 accepted invalid input %',payload;
  exception when sqlstate '22023' then null;end;
 end loop;
 begin perform pg_temp.b_call(null);raise exception 'B9 accepted SQL null';
 exception when sqlstate '22023' then null;end;
 foreach x in array array['sales','operations'] loop
  begin perform pg_temp.b_call('{"page":1}',x);raise exception 'B9 accepted role %',x;
  exception when sqlstate 'PT403' then null;end;
 end loop;
 perform pg_temp.b_assert(pg_temp.b_call('{"page":1}','administrator')=pg_temp.b_call(),'B9 both permitted roles');
 foreach x in array array['anon','authenticated','service_role'] loop
  perform pg_temp.b_assert(not has_function_privilege(x,'private.stockflow_growth_billed_below(date,jsonb)','execute'),'B9 private ACL');
 end loop;
 perform pg_temp.b_assert((select proconfig @> array['statement_timeout=20s'] from pg_proc
  where oid='public.stockflow_growth_gateway(text,text,text,jsonb)'::regprocedure),'B9 gateway timeout');
end$tests$;

rollback;
do $$begin
 if exists(select 1 from private.stockflow_economic_source_vouchers where company_id='billed-co') then
  raise exception 'Billed-below fixture leaked';end if;
 raise notice 'PASS growth billed below B1-B9';
end$$;
