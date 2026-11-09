begin;
set local lock_timeout='60s';
set local statement_timeout='300s';

create function pg_temp.gp_line(src text,d date,qty numeric,amount bigint,k text default 'sale',
 item text default 'gp-item',u text default 'pack',rev bigint default 1,cancel boolean default false,
 company text default 'growth-gp-test-co',customer text default 'gp-lab',line_entity uuid default gen_random_uuid()) returns uuid language plpgsql as $$
declare v uuid;
begin
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,kind,cancelled,evidence)
 values(company,src,rev,d,customer,k,cancel,'{}') returning id into v;
 insert into private.stockflow_economic_source_lines(id,voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
 values(line_entity,v,'1',item,qty,u,amount,'{}');
 return v;
end$$;

create function pg_temp.gp_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Growth GP assertion failed: %',label;end if;end$$;

-- Capture every Economics table, including empty tables, with order-independent row checksums.
create function pg_temp.gp_economics_snapshot() returns jsonb language plpgsql as $$
declare t record; snapshot jsonb:='{}'; value jsonb;
begin
 for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('private','public') and c.relkind in ('r','p')
   and starts_with(c.relname,'stockflow_economic_')
   and c.relname not in ('stockflow_economic_source_vouchers','stockflow_economic_source_lines')
  order by n.nspname,c.relname loop
  execute format('select jsonb_build_object(''rows'',count(*),''checksum'',md5(coalesce(string_agg(row_hash,'''' order by row_hash),'''')))
   from (select md5(to_jsonb(t)::text) row_hash from %I.%I t) hashed',t.nspname,t.relname) into value;
  snapshot:=snapshot||jsonb_build_object(t.nspname||'.'||t.relname,value);
 end loop;
 return snapshot;
end$$;

do $test$
declare today date:='2031-07-15'; r jsonb; g jsonb; before_data jsonb; economics_before jsonb;
 f text; patched_read text; anchor text; v uuid; i integer; role_name text; moved_net numeric:=-20000000;
 started timestamptz; gateway_duration interval; gp_duration interval;
begin
 r:=private.stockflow_growth_read(today,array['management']);
 perform pg_temp.gp_assert(r->>'companyCount'='0','isolated fixed window');
 perform pg_temp.gp_assert(r#>'{gp,window}'='{"salesPaise":0,"knownSalesPaise":0,"costPaise":0,"gpPaise":0,"gpPct":null,"coveragePct":null,"unreliableLines":0}'::jsonb,'empty totals');

 -- GP1. Weighted history includes purchases far before the Growth window.
 perform pg_temp.gp_line('old-purchase','2020-01-01',10,1000,'purchase');
 perform pg_temp.gp_line('recent-purchase','2030-06-01',30,9000,'purchase');
 perform pg_temp.gp_line('weighted-sale','2030-07-10',4,2000);
 g:=private.stockflow_growth_gp(today);
 perform pg_temp.gp_assert(g#>>'{window,costPaise}'='1000','GP1 weighted average 250');
 -- Insert same-day purchases after the sale to exercise ordering and normalized units.
 perform pg_temp.gp_line('same-day-one','2030-07-10',10,3500,'purchase','gp-item',' PACK ');
 perform pg_temp.gp_line('same-day-two','2030-07-10',10,4500,'purchase');
 perform pg_temp.gp_line('future-purchase','2030-08-01',40,22000,'purchase');
 g:=private.stockflow_growth_gp(today);
 perform pg_temp.gp_assert(g->>'method'='average_purchase_cost_to_date' and
  g->'window'='{"salesPaise":2000,"knownSalesPaise":2000,"costPaise":1200,"gpPaise":800,"gpPct":40.0,"coveragePct":100.0,"unreliableLines":0}'::jsonb,
  'GP1 same-day average 300 and later purchase excluded');

 -- GP2. A later purchase and a purchase in another company cannot cover this sale.
 perform pg_temp.gp_line('unknown-sale','2030-08-10',2,1000,'sale','gp-unknown');
 perform pg_temp.gp_line('unknown-later-purchase','2030-08-11',10,1000,'purchase','gp-unknown');
 perform pg_temp.gp_line('other-company-purchase','2020-01-01',10,1000,'purchase','gp-unknown','pack',1,false,'growth-gp-other-co');
 g:=private.stockflow_growth_gp(today);
 perform pg_temp.gp_assert(g#>>'{window,knownSalesPaise}'='2000' and g#>>'{window,coveragePct}'='66.7'
  and g#>>'{window,costPaise}'='1200','GP2 unknown cost and company key');

 perform pg_temp.gp_line('other-unit-sale','2030-09-10',2,1000,'sale','gp-item','box');
 g:=private.stockflow_growth_gp(today);
 perform pg_temp.gp_assert(g#>>'{window,knownSalesPaise}'='2000' and g#>>'{window,coveragePct}'='50.0','GP3 unit key');

 perform pg_temp.gp_line('return','2030-10-10',-2,-1000,'return');
 g:=private.stockflow_growth_gp(today);
 perform pg_temp.gp_assert(g#>>'{window,costPaise}'='600' and g#>>'{months,3,gpPaise}'='-400','GP4 matched return reverses original cost of 600');

 perform pg_temp.gp_line('price-credit','2030-11-10',0,-100,'credit','never-purchased');
 g:=private.stockflow_growth_gp(today);
 perform pg_temp.gp_assert(g#>>'{window,costPaise}'='600' and g#>>'{months,4,knownSalesPaise}'='-100'
  and g#>>'{months,4,gpPaise}'='-100','GP5 zero-quantity credit is known');

 perform pg_temp.gp_line('free-goods','2030-12-10',3,0);
 g:=private.stockflow_growth_gp(today);
 perform pg_temp.gp_assert(g#>>'{window,costPaise}'='1800' and g#>>'{months,5,gpPaise}'='-1200','GP6 free goods carry cost');

 -- GP7. Invalid purchase lines and superseded/cancelled vouchers cannot alter cost.
 before_data:=g;
 perform pg_temp.gp_line('cancelled-purchase','2020-01-01',100,999999,'purchase','gp-item','pack',1,true);
 perform pg_temp.gp_line('superseded-purchase','2020-01-01',100,999999,'purchase');
 perform pg_temp.gp_line('superseded-purchase','2032-01-01',100,999999,'purchase','gp-item','pack',2);
 perform pg_temp.gp_line('revised-cancelled','2020-01-01',100,999999,'purchase');
 perform pg_temp.gp_line('revised-cancelled','2020-01-01',100,999999,'purchase','gp-item','pack',2,true);
 perform pg_temp.gp_line('zero-purchase','2020-01-01',0,999999,'purchase');
 perform pg_temp.gp_line('negative-purchase','2020-01-01',-100,999999,'purchase');
 perform pg_temp.gp_line('free-purchase','2020-01-01',100,0,'purchase');
 perform pg_temp.gp_line('negative-net-purchase','2020-01-01',100,-999999,'purchase');
 perform pg_temp.gp_assert(private.stockflow_growth_gp(today)=before_data,'GP7 excluded purchases');

 -- Latest valid revision, fractional quantities and rounding at each line.
 perform pg_temp.gp_line('rounded-purchase','2030-01-01',3,100,'purchase','gp-round');
 perform pg_temp.gp_line('rounded-purchase','2030-01-01',3,101,'purchase','gp-round','pack',2);
 perform pg_temp.gp_line('rounded-sale','2031-01-10',0.5,100,'sale','gp-round');
 perform pg_temp.gp_line('rounded-sale-two','2031-01-10',0.5,100,'sale','gp-round');
 g:=private.stockflow_growth_gp(today);
 perform pg_temp.gp_assert(g#>>'{months,6,gpPaise}'='166','GP7 latest purchase and per-line rounding');

 -- GP8. Bulk classification uses the entire voucher, including multiple lines.
 v:=pg_temp.gp_line('bulk','2031-02-10',1,12000000);
 insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
 values(v,'2','gp-item',1,'pack',8000000,'{}');
 perform pg_temp.gp_line('bulk-return','2031-03-10',-1,-20000000,'return');
 perform pg_temp.gp_line('bulk-credit','2031-04-10',0,20000000,'credit');
 perform pg_temp.gp_line('below-bulk','2031-05-10',1,19999999);
 perform pg_temp.gp_line('cancelled-sale','2031-05-10',100,999999);
 perform pg_temp.gp_line('cancelled-sale','2031-05-10',100,999999,'sale','gp-item','pack',2,true);
 perform pg_temp.gp_line('moved-sale','2031-05-10',100,999999);
 perform pg_temp.gp_line('moved-sale','2031-07-01',100,999999,'sale','gp-item','pack',2);
 perform pg_temp.gp_line('revised-sale','2031-06-10',100,999999);
 perform pg_temp.gp_line('revised-sale','2031-06-10',1,500,'sale','gp-item','pack',2);
 perform pg_temp.gp_line('before-window','2030-06-30',100,999999);
 perform pg_temp.gp_line('end-window','2031-07-01',100,999999);
 r:=private.stockflow_growth_read(today,array['management']);g:=r->'gp';
 perform pg_temp.gp_assert(g#>'{window,salesPaise}'=r#>'{tree,revenuePaise}'
  and (g#>>'{repeat,salesPaise}')::numeric=(r#>>'{tree,repeatPaise}')::numeric-moved_net
  and (g#>>'{bulk,salesPaise}')::numeric=(r#>>'{tree,bulkPaise}')::numeric+moved_net
  and g#>>'{bulk,salesPaise}'='0' and g#>>'{bulk,costPaise}'='-400','GP8 tree adjusted by matched bulk return');
 for i in 0..1 loop
  perform pg_temp.gp_assert(g#>array['halves',i::text,'salesPaise']=r#>array['halves',i::text,'revenuePaise']
   and g#>array['halves',i::text,'half']=r#>array['halves',i::text,'half'],'GP8 half parity');
 end loop;
 perform pg_temp.gp_assert(jsonb_array_length(g->'months')=12,'twelve months');
 for i in 0..11 loop
  perform pg_temp.gp_assert(g#>>array['months',i::text,'month']=to_char('2030-07-01'::date+i*interval '1 month','YYYY-MM'),'oldest-first months');
 end loop;
 perform pg_temp.gp_assert((select sum((m->>'salesPaise')::numeric) from jsonb_array_elements(g->'months') m)=(g#>>'{window,salesPaise}')::numeric
  and (select sum((m->>'knownSalesPaise')::numeric) from jsonb_array_elements(g->'months') m)=(g#>>'{window,knownSalesPaise}')::numeric
  and (select sum((m->>'gpPaise')::numeric) from jsonb_array_elements(g->'months') m)=(g#>>'{window,gpPaise}')::numeric,'monthly reconciliation');

 -- GP11. A historical bulk sale books 10,000,000 per unit. Later purchases
 -- raise the current average to 20,000,000, but a partial-price return reverses 10,000,000.
 perform pg_temp.gp_line('instrument-purchase','2020-01-01',10,100000000,'purchase','gp-instrument');
 perform pg_temp.gp_line('instrument-sale','2030-05-10',2,30000000,'sale','gp-instrument');
 perform pg_temp.gp_line('instrument-price-rise','2030-08-01',10,300000000,'purchase','gp-instrument');
 -- Neither a cancelled sale nor a revision moved beyond the return date can match.
 perform pg_temp.gp_line('instrument-cancelled','2030-10-01',1,30000000,'sale','gp-instrument');
 perform pg_temp.gp_line('instrument-cancelled','2030-10-01',1,30000000,'sale','gp-instrument','pack',2,true);
 perform pg_temp.gp_line('instrument-moved','2030-10-01',1,30000000,'sale','gp-instrument');
 perform pg_temp.gp_line('instrument-moved','2031-07-01',1,30000000,'sale','gp-instrument','pack',2);
 before_data:=private.stockflow_growth_gp(today);
 perform pg_temp.gp_line('instrument-partial-return','2030-11-01',-1,-8000000,'return','gp-instrument',' PACK ');
 g:=private.stockflow_growth_gp(today);
 perform pg_temp.gp_assert(g->'repeat'=before_data->'repeat'
  and (g#>>'{bulk,salesPaise}')::numeric-(before_data#>>'{bulk,salesPaise}')::numeric=-8000000
  and (g#>>'{bulk,costPaise}')::numeric-(before_data#>>'{bulk,costPaise}')::numeric=-10000000
  and (g#>>'{bulk,gpPaise}')::numeric-(before_data#>>'{bulk,gpPaise}')::numeric=2000000,
  'GP11 partial return uses historical bulk sale cost and leaves repeat GP intact');
 moved_net:=moved_net-8000000;

 before_data:=g;
 perform pg_temp.gp_line('instrument-unmatched-return','2030-12-01',-1,-8000000,'return','gp-instrument','pack',1,false,'growth-gp-test-co','other-lab');
 g:=private.stockflow_growth_gp(today);
 perform pg_temp.gp_assert(g->'bulk'=before_data->'bulk'
  and (g#>>'{repeat,salesPaise}')::numeric-(before_data#>>'{repeat,salesPaise}')::numeric=-8000000
  and (g#>>'{repeat,costPaise}')::numeric-(before_data#>>'{repeat,costPaise}')::numeric=-20000000,
  'GP11 unmatched customer uses return-date average and repeat bucket');

 -- An unknown original sale cost falls back to the return-date average while
 -- still inheriting the original voucher's bulk bucket.
 perform pg_temp.gp_line('uncosted-bulk-sale','2030-05-10',2,30000000,'sale','gp-uncosted');
 perform pg_temp.gp_line('uncosted-later-purchase','2030-08-01',10,50000000,'purchase','gp-uncosted');
 before_data:=private.stockflow_growth_gp(today);
 perform pg_temp.gp_line('uncosted-bulk-return','2030-11-01',-1,-6000000,'return','gp-uncosted');
 g:=private.stockflow_growth_gp(today);
 perform pg_temp.gp_assert(g->'repeat'=before_data->'repeat'
  and (g#>>'{bulk,costPaise}')::numeric-(before_data#>>'{bulk,costPaise}')::numeric=-5000000,
  'GP11 matched unknown cost falls back and retains bulk bucket');
 moved_net:=moved_net-6000000;

 -- Date wins over id, then the greatest line id wins on that date. NULL customer
 -- keys match, and a same-day credit reverses the rounded sale cost (7 / 2 -> 4).
 perform pg_temp.gp_line('tie-purchase','2020-01-01',3,10,'purchase','gp-tie');
 perform pg_temp.gp_line('tie-older','2030-08-11',2,10,'sale','gp-tie','pack',1,false,'growth-gp-test-co',null,'ffffffff-ffff-4fff-8fff-ffffffffffff');
 perform pg_temp.gp_line('tie-smaller','2030-08-12',1,10,'sale','gp-tie','pack',1,false,'growth-gp-test-co',null,'11111111-1111-4111-8111-111111111111');
 perform pg_temp.gp_line('tie-greater','2030-08-12',2,10,'sale','gp-tie','pack',1,false,'growth-gp-test-co',null,'22222222-2222-4222-8222-222222222222');
 perform pg_temp.gp_line('tie-other-customer','2030-08-12',1,10,'sale','gp-tie','pack',1,false,'growth-gp-test-co','other-lab','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
 before_data:=private.stockflow_growth_gp(today);
 perform pg_temp.gp_line('tie-credit','2030-08-12',-1,-5,'credit','gp-tie','pack',1,false,'growth-gp-test-co',null);
 g:=private.stockflow_growth_gp(today);
 perform pg_temp.gp_assert((g#>>'{repeat,costPaise}')::numeric-(before_data#>>'{repeat,costPaise}')::numeric=-4,
  'GP11 same-day null-safe credit, date/id tie and original rounded unit cost');

 -- GP12. Positive-net costs outside [0.1,10] times net become unknown.
 perform pg_temp.gp_line('guard-purchase','2020-01-01',1000,150000000,'purchase','gp-guard');
 perform pg_temp.gp_line('guard-known-sale','2030-12-01',400,100000000,'sale','gp-guard');
 before_data:=private.stockflow_growth_gp(today);
 perform pg_temp.gp_line('guard-200-units','2031-01-01',200,160000,'sale','gp-guard');
 g:=private.stockflow_growth_gp(today);
 perform pg_temp.gp_assert((g#>>'{window,salesPaise}')::numeric-(before_data#>>'{window,salesPaise}')::numeric=160000
  and g#>'{window,costPaise}'=before_data#>'{window,costPaise}'
  and g#>'{window,knownSalesPaise}'=before_data#>'{window,knownSalesPaise}'
  and g#>'{window,gpPaise}'=before_data#>'{window,gpPaise}'
  and g#>'{months,6,knownSalesPaise}'=before_data#>'{months,6,knownSalesPaise}'
  and g#>'{months,6,gpPaise}'=before_data#>'{months,6,gpPaise}'
  and (g#>>'{window,unreliableLines}')::int=(before_data#>>'{window,unreliableLines}')::int+1
  and (g#>>'{window,coveragePct}')::numeric<(before_data#>>'{window,coveragePct}')::numeric,
  'GP12 unit mismatch lowers coverage and increments unreliableLines');
 before_data:=g;
 perform pg_temp.gp_line('guard-below-cost','2031-02-01',1,75000,'sale','gp-guard');
 perform pg_temp.gp_line('guard-half-ratio','2031-02-01',1,300000,'sale','gp-guard');
 perform pg_temp.gp_line('guard-low-boundary','2031-02-01',1,1500000,'sale','gp-guard');
 perform pg_temp.gp_line('guard-high-boundary','2031-02-01',1,15000,'sale','gp-guard');
 perform pg_temp.gp_line('guard-free-goods','2031-02-01',200,0,'sale','gp-guard');
 g:=private.stockflow_growth_gp(today);
 perform pg_temp.gp_assert((g#>>'{window,costPaise}')::numeric-(before_data#>>'{window,costPaise}')::numeric=30600000
  and (g#>>'{window,knownSalesPaise}')::numeric-(before_data#>>'{window,knownSalesPaise}')::numeric=1890000
  and g#>'{window,unreliableLines}'=before_data#>'{window,unreliableLines}',
  'GP12 below-cost sale, half ratio, exact boundaries and free goods stay known');
 before_data:=g;
 perform pg_temp.gp_line('guard-too-low','2031-03-01',1,1500001,'sale','gp-guard');
 perform pg_temp.gp_line('guard-too-high','2031-03-01',1,14999,'sale','gp-guard');
 g:=private.stockflow_growth_gp(today);
 perform pg_temp.gp_assert(g#>'{window,costPaise}'=before_data#>'{window,costPaise}'
  and g#>'{window,knownSalesPaise}'=before_data#>'{window,knownSalesPaise}'
  and (g#>>'{window,unreliableLines}')::int=(before_data#>>'{window,unreliableLines}')::int+2,
  'GP12 strict outside boundaries become unknown');
 -- A negative-quantity sale uses matching before the guard: current average
 -- would fail (>10), while the historical 10,000,000 cost is exactly on the boundary.
 before_data:=g;
 perform pg_temp.gp_line('guard-matched-negative-sale','2031-04-01',-1,1000000,'sale','gp-instrument');
 g:=private.stockflow_growth_gp(today);
 perform pg_temp.gp_assert((g#>>'{bulk,costPaise}')::numeric-(before_data#>>'{bulk,costPaise}')::numeric=-10000000
  and (g#>>'{bulk,knownSalesPaise}')::numeric-(before_data#>>'{bulk,knownSalesPaise}')::numeric=1000000
  and g#>'{window,unreliableLines}'=before_data#>'{window,unreliableLines}','GP12 guard follows return matching');
 moved_net:=moved_net+1000000;
 perform pg_temp.gp_assert(not (g->'repeat' ? 'unreliableLines') and not (g->'bulk' ? 'unreliableLines')
  and not exists(select 1 from jsonb_array_elements((g->'halves')||(g->'months')) item where item ? 'unreliableLines'),
  'GP12 unreliableLines appears only in window');

 r:=private.stockflow_growth_read(today,array['management']);g:=r->'gp';
 perform pg_temp.gp_assert(g#>'{window,salesPaise}'=r#>'{tree,revenuePaise}'
  and (g#>>'{repeat,salesPaise}')::numeric=(r#>>'{tree,repeatPaise}')::numeric-moved_net
  and (g#>>'{bulk,salesPaise}')::numeric=(r#>>'{tree,bulkPaise}')::numeric+moved_net,
  'GP8 final buckets reconcile to tree plus exact matched-return transfers');
 for i in 0..1 loop
  perform pg_temp.gp_assert(g#>array['halves',i::text,'salesPaise']=r#>array['halves',i::text,'revenuePaise'],'GP8 final half parity');
 end loop;

 -- Compare the serialized existing payload with the pre-GP return expression.
 patched_read:=pg_get_functiondef('private.stockflow_growth_read(date,text[])'::regprocedure);
 anchor:='||jsonb_build_object(''gp'',private.stockflow_growth_gp(p_today))';
 perform pg_temp.gp_assert((length(patched_read)-length(replace(patched_read,anchor,'')))/length(anchor)=1,'single GP seam');
 execute replace(patched_read,anchor,'');
 before_data:=private.stockflow_growth_read(today,array['management']);
 execute patched_read;
 perform pg_temp.gp_assert((r-'gp')::text=before_data::text,'existing payload byte-identical');

 -- Pin only the test transaction's get_growth clock to the same fixture date.
 f:=pg_get_functiondef('public.stockflow_growth_gateway(text,text,text,jsonb)'::regprocedure);
 anchor:='return private.stockflow_growth_read((now() at time zone ''Asia/Kolkata'')::date,roles);';
 perform pg_temp.gp_assert((length(f)-length(replace(f,anchor,'')))/length(anchor)=1,'gateway clock seam');
 execute replace(f,anchor,'return private.stockflow_growth_read(''2031-07-15''::date,roles);');
 insert into private.stockflow_gateway_config(name,secret_sha256) values('orders',encode(extensions.digest('growth-gp-key','sha256'),'hex'))
 on conflict(name) do update set secret_sha256=excluded.secret_sha256;
 insert into public.stockflow_members(email,role,roles,status)
 values('growth-gp-management@test.local','management',array['management'],'active');

 economics_before:=pg_temp.gp_economics_snapshot();
 perform pg_temp.gp_assert(economics_before<>'{}'::jsonb,'GP9 Economics snapshot populated');
 started:=clock_timestamp();
 r:=public.stockflow_growth_gateway('growth-gp-key','growth-gp-management@test.local','get_growth');
 gateway_duration:=clock_timestamp()-started;
 perform pg_temp.gp_assert(pg_temp.gp_economics_snapshot()=economics_before,'GP9 Economics counts and checksums');
 perform pg_temp.gp_assert(r->'gp'=g and (r-'gp')::text=before_data::text,'gateway payload parity');
 perform pg_temp.gp_assert(pg_get_functiondef('private.stockflow_growth_gp(date)'::regprocedure)!~ 'stockflow_economic_(runs|auto_cost[a-z_]*|cost_links)'
  and patched_read!~ 'stockflow_economic_(runs|auto_cost[a-z_]*|cost_links)','GP9 function dependencies');
 foreach role_name in array array['anon','authenticated','service_role'] loop
  perform pg_temp.gp_assert(not has_function_privilege(role_name,'private.stockflow_growth_gp(date)','execute'),'private GP ACL '||role_name);
 end loop;
 perform pg_temp.gp_assert(has_function_privilege('service_role','public.stockflow_growth_gateway(text,text,text,jsonb)','execute'),'gateway grant');

 started:=clock_timestamp();
 perform private.stockflow_growth_gp(today);
 gp_duration:=clock_timestamp()-started;
 raise notice 'GP10 get_growth duration %, gp-function duration %',gateway_duration,gp_duration;
 perform pg_temp.gp_assert(gateway_duration<interval '2 seconds','GP10 get_growth under 2 seconds');

 -- Nonpositive denominators and known zero-cost lines remain well-defined.
 perform pg_temp.gp_line('value-only-return','2031-08-01',0,-100,'credit','never-purchased');
 g:=private.stockflow_growth_gp('2032-08-15');
 perform pg_temp.gp_assert(g->'window'='{"salesPaise":-100,"knownSalesPaise":-100,"costPaise":0,"gpPaise":-100,"gpPct":null,"coveragePct":null,"unreliableLines":0}'::jsonb,'nonpositive percentage denominators');
end$test$;
rollback;

do $$begin
 if exists(select 1 from private.stockflow_economic_source_vouchers where company_id in ('growth-gp-test-co','growth-gp-other-co'))
  or exists(select 1 from public.stockflow_members where email='growth-gp-management@test.local') then
  raise exception 'Growth GP fixture leaked';end if;
 raise notice 'PASS growth gp GP11-GP12';
 raise notice 'PASS growth gp GP1-GP10';
end$$;
