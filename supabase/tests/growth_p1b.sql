begin;
set local lock_timeout='60s';
set local statement_timeout='300s';

create function pg_temp.p1b_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'P1b assertion: %',label;end if;end$$;
create function pg_temp.p1b_sale(src text,lab text,d date,amount bigint,k text default 'sale',rev bigint default 1,cancel boolean default false)
returns void language plpgsql as $$
declare v uuid;
begin
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,kind,cancelled,evidence)
 values('growth-p1b-co',src,rev,d,lab,k,cancel,'{}') returning id into v;
 insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
 values(v,'1','p1b-item',1,'pack',amount,'{}');
end$$;
create function pg_temp.p1b_read(payload jsonb) returns jsonb language plpgsql as $$
declare r jsonb; t timestamptz:=clock_timestamp();elapsed interval;
begin
 if payload is null then r:=private.stockflow_growth_read('1901-01-15',array['management']);
 else r:=private.stockflow_growth_labs_read('1901-01-15',array['management'],payload);end if;
 elapsed:=clock_timestamp()-t;
 raise notice 'P10 read %: %',coalesce(payload->>'list','get_growth'),elapsed;
 perform pg_temp.p1b_assert(elapsed<interval '2 seconds','read under 2s');return r;
end$$;

do $test$
declare base jsonb; r jsonb; q jsonb; x jsonb; m jsonb; i int; j int; expected int; n text; s text;
 customer uuid:=gen_random_uuid(); d date; key_name text; bad jsonb;
begin
 raise notice 'P1b baseline and P1-P5 fixtures';
 base:=pg_temp.p1b_read(null);
 perform pg_temp.p1b_assert(base#>>'{tree,revenuePaise}'='0','isolated fixed window baseline');
 for i in 0..11 loop
  d:=('1900-01-01'::date+i*interval '1 month')::date;
  perform pg_temp.p1b_sale('a'||i,'A',d,100);
  if i<10 then perform pg_temp.p1b_sale('b'||i,'B',d,200);end if;
  if i=4 then perform pg_temp.p1b_sale('c'||i,'C',d,300);end if;
  if i<6 then perform pg_temp.p1b_sale('d'||i,'D',d,400);end if;
  if i<5 then perform pg_temp.p1b_sale('e'||i,'E',d,500);end if;
 end loop;
 for i in 6..12 loop perform pg_temp.p1b_sale('one'||i,chr(64+i),'1900-01-01',600);end loop;
 perform pg_temp.p1b_sale('small','supplier','1900-05-01',19999999,'purchase');
 perform pg_temp.p1b_sale('large','supplier','1900-05-02',20000000,'purchase');
 perform pg_temp.p1b_sale('revised','supplier','1900-05-01',90000000,'purchase');
 perform pg_temp.p1b_sale('revised','supplier','1900-05-03',20000001,'purchase',2);
 perform pg_temp.p1b_sale('cancel','supplier','1900-05-01',90000000,'purchase');
 perform pg_temp.p1b_sale('cancel','supplier','1900-05-01',90000000,'purchase',2,true);
 perform pg_temp.p1b_sale('moved','supplier','1900-05-01',90000000,'purchase');
 perform pg_temp.p1b_sale('moved','supplier','1901-01-01',90000000,'purchase',2);
 r:=pg_temp.p1b_read(null);
 perform pg_temp.p1b_assert(r->'scorecard'='{"regularLabs":2,"regularPct":25.4,"top10Pct":92.9}'::jsonb,'P1 exact scorecard');
 perform pg_temp.p1b_assert(jsonb_array_length(r->'months')=12,'P2 twelve months');
 for i in 0..11 loop
  m:=r->'months'->i;
  perform pg_temp.p1b_assert(m->>'month'=to_char('1900-01-01'::date+i*interval '1 month','YYYY-MM'),'P2 oldest first');
  expected:=case when i=0 then 11 when i<4 then 4 when i=4 then 5 when i=5 then 3 when i<10 then 2 else 1 end;
  perform pg_temp.p1b_assert((m->>'labsBuying')::int=expected,'P2 labs month '||i);
  expected:=case when i=0 then 5400 when i<4 then 1200 when i=4 then 1500 when i=5 then 700 when i<10 then 300 else 100 end;
  perform pg_temp.p1b_assert((m->>'salesPaise')::int=expected,'P2 sales month '||i);
  perform pg_temp.p1b_assert(m->'firstTime'=case when i=0 then 'null'::jsonb when i=4 then '1'::jsonb else '0'::jsonb end,'P3 firstTime '||i);
  perform pg_temp.p1b_assert(m->'skippedRegulars'=case when i<11 then 'null'::jsonb else '2'::jsonb end,'P4 skipped '||i);
 end loop;
 perform pg_temp.p1b_assert(r#>>'{months,4,purchasesRegularPaise}'='19999999'
  and r#>>'{months,4,purchasesLargePaise}'='40000001' and r#>>'{months,4,largePurchaseInvoices}'='2','P5 purchases');
 raise notice 'P1b P6 bar/list parity and P10 timings';
 foreach n in array array['month_buying','month_first','month_skipped','month_large_purchases'] loop
  key_name:=case n when 'month_buying' then 'labsBuying' when 'month_first' then 'firstTime' when 'month_skipped' then 'skippedRegulars' else 'largePurchaseInvoices' end;
  for i in 0..11 loop
   m:=r->'months'->i;
   q:=pg_temp.p1b_read(jsonb_build_object('list',n,'page',1,'month',m->>'month'));
   perform pg_temp.p1b_assert((q->>'total')::int=coalesce((m->>key_name)::int,0),'P6 '||n||' '||i);
  end loop;
 end loop;
 foreach n in array array['new','stopped','grew','fell'] loop
  q:=pg_temp.p1b_read(jsonb_build_object('list','bridge_'||n,'page',1)||case when n='stopped' then '{"regularOnly":false}'::jsonb else '{}'::jsonb end);
  perform pg_temp.p1b_assert(q->>'total'=r#>>array['bridge',n,'labs'],'P6 bridge '||n);
 end loop;
 q:=pg_temp.p1b_read('{"list":"bridge_stopped","page":1}');
 perform pg_temp.p1b_assert(q->>'total'=r#>>'{bridge,stoppedRegular,labs}','P6 stopped regular');
 q:=pg_temp.p1b_read('{"list":"regular_labs","page":1}');
 perform pg_temp.p1b_assert(q->>'total'=r#>>'{scorecard,regularLabs}','P6 regular');
 perform pg_temp.p1b_assert(q#>>'{rows,0,labKey}'='growth-p1b-co|B' and q#>>'{rows,0,trend}'='down','value sort and trend');
 q:=pg_temp.p1b_read('{"list":"month_skipped","month":"1900-12","page":1}');
 perform pg_temp.p1b_assert(q#>>'{rows,0,labKey}'='growth-p1b-co|B' and q#>'{rows,0,valuePaise}'='null'::jsonb,'P4 six qualifies five does not');

 raise notice 'P1b P7 names and supplier privacy';
 insert into private.stockflow_customers(id,name,tally_key,city,created_by_email) values(customer,'Linked A','p1b-linked','Town A','test');
 insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by) values('growth-p1b-co','A',customer,'test');
 insert into private.stockflow_economic_ledger_generations(company_id,source_version,observed_at,valid,catalog_version,content_hash,row_count)
 values('growth-p1b-co','old','1900-01-01',true,'old','old',2),('growth-p1b-co','new','1900-02-01',true,'new','new',2),
 ('growth-p1b-co','invalid','1900-03-01',false,null,null,null);
 insert into private.stockflow_economic_ledger_masters(company_id,source_version,guid,name) values
 ('growth-p1b-co','old','B','Old B'),('growth-p1b-co','new','B','Current B'),
 ('growth-p1b-co','old','supplier','Old Supplier'),('growth-p1b-co','new','supplier','Current Supplier');
 q:=pg_temp.p1b_read('{"list":"month_buying","month":"1900-05","page":1,"sort":"months"}');
 perform pg_temp.p1b_assert(q#>>'{rows,0,name}'='Linked A' and q#>>'{rows,0,town}'='Town A'
  and q#>>'{rows,0,customerId}'=customer::text and q#>>'{rows,1,name}'='Current B'
  and q#>'{rows,2,name}'='null'::jsonb,'P7 name precedence, latest valid, null');
 q:=pg_temp.p1b_read('{"list":"month_large_purchases","month":"1900-05","page":1,"sort":"last"}');
 perform pg_temp.p1b_assert(q#>>'{rows,0,supplierName}'='Current Supplier' and q#>>'{rows,0,valuePaise}'='20000001'
  and (select count(*) from jsonb_object_keys(q->'rows'->0))=3,'P7 supplier and totals only');

 raise notice 'P1b P8 pagination and stable ties';
 -- A separate month: 25 equal lab rows, lexically ordered keys.
 for i in 1..24 loop perform pg_temp.p1b_sale('page'||i,'page'||lpad(i::text,2,'0'),'1900-12-02',100);end loop;
 foreach s in array array['value','months','last'] loop
  q:=pg_temp.p1b_read(jsonb_build_object('list','month_buying','month','1900-12','page',1,'sort',s));
  x:=pg_temp.p1b_read(jsonb_build_object('list','month_buying','month','1900-12','page',2,'sort',s));
  perform pg_temp.p1b_assert(q->>'total'='25' and x->>'total'='25' and jsonb_array_length(q->'rows')=20 and jsonb_array_length(x->'rows')=5,'P8 pages '||s);
  if s='last' then
   perform pg_temp.p1b_assert(q#>>'{rows,0,labKey}'='growth-p1b-co|page01' and x#>>'{rows,4,labKey}'='growth-p1b-co|A','P8 last');
  else perform pg_temp.p1b_assert(q#>>'{rows,0,labKey}'='growth-p1b-co|A' and x#>>'{rows,0,labKey}'='growth-p1b-co|page20','P8 tie break '||s);end if;
 end loop;
 raise notice 'P1b P9 strict validation and roles';
 foreach bad in array array[
 '{"list":"bad","page":1}'::jsonb,'{"list":"month_buying","page":1}',
 '{"list":"month_buying","page":1,"month":"1899-12"}',
 '{"list":"regular_labs","page":1,"month":"1900-01"}',
 '{"list":"regular_labs","page":1,"regularOnly":false}',
 '{"list":"month_large_purchases","page":1,"month":"1900-01","sort":"months"}',
 '{"list":"regular_labs","page":0}','{"list":"regular_labs","page":1,"extra":1}',
 '{"list":"regular_labs","page":"1"}','{"list":"regular_labs","page":1,"sort":null}',
 '{"list":"month_buying","page":1,"month":null}','{"list":"bridge_stopped","page":1,"regularOnly":null}',
 '{"list":"regular_labs","page":2147483648}','[]','null'] loop
  begin perform pg_temp.p1b_read(bad);raise exception 'P9 accepted %',bad;
  exception when sqlstate '22023' then null;end;
 end loop;
 insert into private.stockflow_gateway_config(name,secret_sha256) values('orders',encode(extensions.digest('p1b-key','sha256'),'hex'))
 on conflict(name) do update set secret_sha256=excluded.secret_sha256;
 foreach n in array array['sales','operations','management','administrator'] loop
  insert into public.stockflow_members(email,role,roles,status) values('p1b-'||n||'@test.local',n,array[n],'active');
  begin
   q:=public.stockflow_growth_gateway('p1b-key','p1b-'||n||'@test.local','get_growth_labs','{"list":"regular_labs","page":1}');
   perform pg_temp.p1b_assert(n in ('management','administrator'),'P9 unauthorized role accepted');
  exception when sqlstate 'PT403' then perform pg_temp.p1b_assert(n in ('sales','operations'),'P9 permitted role denied');end;
 end loop;
 begin perform public.stockflow_growth_gateway('wrong','p1b-management@test.local','get_growth_labs','{"list":"regular_labs","page":1}');raise exception 'bad key accepted';
 exception when sqlstate '42501' then null;end;
 perform pg_temp.p1b_assert(not has_function_privilege('service_role','private.stockflow_growth_labs_read(date,text[],jsonb)','EXECUTE')
  and not has_function_privilege('authenticated','public.stockflow_growth_gateway(text,text,text,jsonb)','EXECUTE'),'gateway-only grants');
 raise notice 'PASS growth p1b P1-P10';
end$test$;
rollback;
