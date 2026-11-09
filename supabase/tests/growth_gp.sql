begin;
set local lock_timeout='60s';
set local statement_timeout='300s';

create function pg_temp.gp_line(src text,d date,qty numeric,amount bigint,k text default 'sale',
 item text default 'gp-item',u text default 'pack',rev bigint default 1,cancel boolean default false,
 company text default 'growth-gp-test-co') returns uuid language plpgsql as $$
declare v uuid;
begin
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,kind,cancelled,evidence)
 values(company,src,rev,d,'gp-lab',k,cancel,'{}') returning id into v;
 insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
 values(v,'1',item,qty,u,amount,'{}');
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
 f text; patched_read text; anchor text; v uuid; i integer; role_name text;
 started timestamptz; gateway_duration interval; gp_duration interval;
begin
 r:=private.stockflow_growth_read(today,array['management']);
 perform pg_temp.gp_assert(r->>'companyCount'='0','isolated fixed window');
 perform pg_temp.gp_assert(r#>'{gp,window}'='{"salesPaise":0,"knownSalesPaise":0,"costPaise":0,"gpPaise":0,"gpPct":null,"coveragePct":null}'::jsonb,'empty totals');

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
  g->'window'='{"salesPaise":2000,"knownSalesPaise":2000,"costPaise":1200,"gpPaise":800,"gpPct":40.0,"coveragePct":100.0}'::jsonb,
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
 perform pg_temp.gp_assert(g#>>'{window,costPaise}'='400' and g#>>'{months,3,gpPaise}'='-200','GP4 return reverses 800 at return-date average');

 perform pg_temp.gp_line('price-credit','2030-11-10',0,-100,'credit','never-purchased');
 g:=private.stockflow_growth_gp(today);
 perform pg_temp.gp_assert(g#>>'{window,costPaise}'='400' and g#>>'{months,4,knownSalesPaise}'='-100'
  and g#>>'{months,4,gpPaise}'='-100','GP5 zero-quantity credit is known');

 perform pg_temp.gp_line('free-goods','2030-12-10',3,0);
 g:=private.stockflow_growth_gp(today);
 perform pg_temp.gp_assert(g#>>'{window,costPaise}'='1600' and g#>>'{months,5,gpPaise}'='-1200','GP6 free goods carry cost');

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
  and g#>'{repeat,salesPaise}'=r#>'{tree,repeatPaise}' and g#>'{bulk,salesPaise}'=r#>'{tree,bulkPaise}'
  and g#>>'{bulk,salesPaise}'='20000000' and g#>>'{bulk,costPaise}'='800','GP8 tree and bulk/repeat parity');
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
 perform pg_temp.gp_assert(g->'window'='{"salesPaise":-100,"knownSalesPaise":-100,"costPaise":0,"gpPaise":-100,"gpPct":null,"coveragePct":null}'::jsonb,'nonpositive percentage denominators');
end$test$;
rollback;

do $$begin
 if exists(select 1 from private.stockflow_economic_source_vouchers where company_id in ('growth-gp-test-co','growth-gp-other-co'))
  or exists(select 1 from public.stockflow_members where email='growth-gp-management@test.local') then
  raise exception 'Growth GP fixture leaked';end if;
 raise notice 'PASS growth gp GP1-GP10';
end$$;
