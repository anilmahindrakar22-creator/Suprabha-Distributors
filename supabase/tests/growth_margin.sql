begin;
set local statement_timeout='300s';
set local lock_timeout='60s';

create function pg_temp.m_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Growth margin assertion failed: %',label;end if;end$$;

create function pg_temp.m_line(src text,item text,lab text,qty numeric,net bigint,
 kind text default 'sale',d date default '2030-08-10',u text default 'pack',revision bigint default 1,
 cancelled boolean default false,company text default 'margin-co') returns void language plpgsql as $$
declare voucher uuid;
begin
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,kind,cancelled,evidence)
 values(company,src,revision,d,lab,kind,cancelled,'{}') returning id into voucher;
 insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
 values(voucher,'1',item,qty,u,net,'{}');
end$$;

-- Every gateway read, including sort/filter combinations, has its own budget.
create temporary table margin_read_durations(action text,elapsed interval);
create function pg_temp.m_call(action text,payload jsonb,actor text default 'management') returns jsonb language plpgsql as $$
declare started timestamptz:=clock_timestamp(); elapsed interval; result jsonb;
begin
 result:=public.stockflow_growth_gateway('margin-key','margin-'||actor||'@test.local',action,payload);
 elapsed:=clock_timestamp()-started;
 insert into margin_read_durations values(action,elapsed);
 raise notice 'M12 % % duration %',action,payload,elapsed;
 perform pg_temp.m_assert(elapsed<interval '2 seconds','M12 read under 2 seconds');
 return result;
end$$;

insert into private.stockflow_gateway_config(name,secret_sha256)
values('orders',encode(extensions.digest('margin-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,roles,status)
select 'margin-'||r||'@test.local',r,array[r],'active'
from unnest(array['administrator','management','sales','operations']) r;

do $clock$
declare f text;
begin
 select pg_get_functiondef('public.stockflow_growth_gateway(text,text,text,jsonb)'::regprocedure) into f;
 execute replace(f,'(now() at time zone ''Asia/Kolkata'')::date','''2031-07-15''::date');
end$clock$;

do $$declare r jsonb;begin
 r:=pg_temp.m_call('get_growth_margin','{"view":"labs","page":1}');
 perform pg_temp.m_assert(r->>'total'='0' and r->'rows'='[]' and r->'thresholdPct'='null'
  and r#>'{levers,priceSpread}'='{"items":0,"pairs":0,"paise":0}'::jsonb,'empty window');
end$$;

create temporary table expected_items(item text primary key,sales numeric,known numeric,gp numeric,labs integer,spread numeric default 0);
create temporary table expected_labs(lab text primary key,sales numeric,known numeric,gp numeric);

do $fixture$
declare n integer; item text; lab text; price bigint; customer uuid:='f2000000-0000-4000-8000-000000000001';
begin
 -- Equal metrics exercise lexical ties across two pages, for labs and items.
 for n in 1..24 loop
  item:='tie-'||lpad(n::text,2,'0');lab:='T'||lpad(n::text,2,'0');
  perform pg_temp.m_line('buy-'||item,item,null,10,500000,'purchase','2020-01-01');
  perform pg_temp.m_line('sale-'||item,item,lab,1,100000);
  insert into expected_items values(item,100000,100000,50000,1,0);
  insert into expected_labs values(lab,100000,100000,50000);
 end loop;
 perform pg_temp.m_line('buy-spread','spread',null,100,5000000,'purchase','2020-01-01');
 for n in 1..7 loop
  price:=(array[35000,85000,95000,100000,100000,100000,300000])[n];lab:='P'||n;
  if n=2 then
   perform pg_temp.m_line('spread-2a','spread',lab,4,280000);
   perform pg_temp.m_line('spread-2b','spread',lab,6,570000);
  else perform pg_temp.m_line('spread-'||n,'spread',lab,10,price*10);end if;
  insert into expected_labs values(lab,price*10,price*10,price*10-500000);
 end loop;
 -- Return alters GP and sales, while the sale-only lab price stays at 100000.
 perform pg_temp.m_line('spread-return','spread','P4',-1,-100000,'return','2030-09-01');
 update expected_labs set sales=sales-100000,known=known-100000,gp=gp-50000 where expected_labs.lab='P4';
 insert into expected_items values('spread',8050000,8050000,4600000,7,150000);
 foreach item in array array['low-a','low-b','small'] loop
  perform pg_temp.m_line('buy-'||item,item,null,100,9500000,'purchase','2020-01-01');
  n:=case item when 'low-a' then 150 when 'low-b' then 100 else 24 end;
  perform pg_temp.m_line('sale-'||item,item,item,n,n::bigint*100000);
  insert into expected_items values(item,n*100000,n*100000,n*5000,1,0);
  insert into expected_labs values(item,n*100000,n*100000,n*5000);
 end loop;
 perform pg_temp.m_line('free','low-a','low-a',3,0);
 update expected_items set gp=gp-285000 where expected_items.item='low-a';
 update expected_labs set gp=gp-285000 where expected_labs.lab='low-a';
 perform pg_temp.m_line('buy-loss','loss',null,10,1200000,'purchase','2020-01-01');
 perform pg_temp.m_line('sale-loss','loss','loss',3,300000);
 insert into expected_items values('loss',300000,300000,-60000,1,0);
 insert into expected_labs values('loss',300000,300000,-60000);
 perform pg_temp.m_line('unknown','unknown','unknown',1,100000);
 insert into expected_items values('unknown',100000,0,0,1,0);
 insert into expected_labs values('unknown',100000,0,0);
 perform pg_temp.m_line('credit','credit','credit',0,-100,'credit');
 insert into expected_items values('credit',-100,-100,-100,1,0);
 insert into expected_labs values('credit',-100,-100,-100);
 -- A two-lab item has no typical price, band, or spread.
 perform pg_temp.m_line('buy-two','two',null,10,500000,'purchase','2020-01-01');
 perform pg_temp.m_line('two-1','two','P1',1,80000);
 perform pg_temp.m_line('two-2','two','P2',1,100000);
 insert into expected_items values('two',180000,180000,80000,2,0);
 update expected_labs set sales=sales+80000,known=known+80000,gp=gp+30000 where expected_labs.lab='P1';
 update expected_labs set sales=sales+100000,known=known+100000,gp=gp+50000 where expected_labs.lab='P2';
 -- The classification and whole-voucher bulk rules exclude these from margins.
 perform pg_temp.m_line('buy-instrument','instrument',null,10,30000000,'purchase','2020-01-01');
 perform pg_temp.m_line('instrument','instrument','P1',1,4000000);
 perform pg_temp.m_line('buy-bulk','bulk',null,100,10000000,'purchase','2020-01-01');
 perform pg_temp.m_line('bulk','bulk','P1',100,20000000);

 insert into private.stockflow_economic_item_catalogs(company_id,source_version,observed_at,content)
 values('margin-co','old','2020-01-01','{"products":[{"id":"spread","name":"Obsolete spread"}]}');
 insert into private.stockflow_economic_item_catalogs(company_id,source_version,observed_at,content)
 select 'margin-co','latest','2031-07-15',jsonb_build_object('products',jsonb_agg(jsonb_build_object('id',e.item,'name','Margin '||e.item)))
 from expected_items e;
 insert into private.stockflow_products(tally_item_key,name,item_group)
 values('Margin spread','Margin spread','Margin fixture'),('margin two','Margin two','Margin fixture');
 insert into private.stockflow_customers(id,name,tally_key,city,created_by_email)
 values(customer,'Linked Alpha','margin-linked','Test Town','fixture');
 insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
 values('margin-co','P2',customer,'fixture');
 insert into private.stockflow_economic_ledger_generations(company_id,source_version,observed_at,valid,catalog_version,content_hash,row_count)
 values('margin-co','current','2031-07-15',true,'current','current',1);
 insert into private.stockflow_economic_ledger_masters(company_id,source_version,guid,name)
 values('margin-co','current','P1','Unlinked Ledger Alpha');
 insert into private.stockflow_customer_product_prices(customer_id,tally_item_key,price_amount,valid_from,valid_to,status,
  source_type,reason,created_by_email,approved_by_email,approved_at)
 values(customer,'Margin spread',812.34,'2031-07-15','2031-07-15','approved','customer_contract','fixture','fixture','fixture',now()),
  (customer,'Margin spread',999,'2030-01-01','2031-07-14','approved','customer_contract','fixture','fixture','fixture',now()),
  (customer,'Margin spread',999,'2031-07-16',null,'approved','customer_contract','fixture','fixture','fixture',now()),
  (customer,'Margin spread',999,'2031-01-01',null,'draft','customer_contract','fixture','fixture',null,null),
  (customer,'Margin spread',999,'2031-01-01',null,'pending_approval','customer_contract','fixture','fixture',null,null),
  (customer,'Margin spread',999,'2031-01-01',null,'superseded','customer_contract','fixture','fixture',null,null),
  (customer,'margin two',999,'2031-01-01',null,'approved','customer_contract','fixture','fixture','fixture',now());
end$fixture$;

create temporary table expected_rows(view_name text,key text,sales numeric,known numeric,gp numeric,margin numeric,
 low boolean,below_cost boolean,spread numeric,unlinked boolean);
insert into expected_rows
select 'items','margin-co|'||item||'|pack',sales,known,gp,case when known>0 then round(100*gp/known,1) end,
 false,gp<0 and sales>=250000,spread,false from expected_items
union all
select 'labs','margin-co|'||lab,sales,known,gp,case when known>0 then round(100*gp/known,1) end,
 false,false,0,lab<>'P2' from expected_labs;
update expected_rows set low=coalesce(sales>=case view_name when 'labs' then 10000000 else 2500000 end
 and margin<round((private.stockflow_growth_gp('2031-07-15')#>>'{consumables,gpPct}')::numeric/2,1),false);

do $tests$
<<tests>>
declare today date:='2031-07-15'; g jsonb; r jsonb; detail jsonb; lab_detail jsonb; expected jsonb; actual jsonb;
 view_name text; sort_name text; filter_name text; field text; role_name text; action text; payload jsonb;
 page_number integer; threshold numeric; sum_value numeric; item text; n integer; started timestamptz; duration interval;
begin
 g:=private.stockflow_growth_gp(today);threshold:=round((g#>>'{consumables,gpPct}')::numeric/2,1);
 -- M1. Independent fixture arithmetic and both paginated lists reconcile to GP.
 foreach field in array array['salesPaise','gpPaise','knownSalesPaise'] loop
  foreach view_name in array array['labs','items'] loop
   sum_value:=0;
   for page_number in 1..2 loop
    r:=pg_temp.m_call('get_growth_margin',jsonb_build_object('view',view_name,'page',page_number));
    select sum_value+coalesce(sum((v->>field)::numeric),0) into sum_value from jsonb_array_elements(r->'rows') v;
   end loop;
   perform pg_temp.m_assert(sum_value=(g#>>array['consumables',field])::numeric,'M1 '||view_name||' '||field);
  end loop;
 end loop;
 perform pg_temp.m_assert((select sum(sales) from expected_items)=(g#>>'{consumables,salesPaise}')::numeric
  and (select sum(gp) from expected_items)=(g#>>'{consumables,gpPaise}')::numeric,'M1 independent totals');

 -- M2. Exact membership AND complete ordering for every supported combination.
 foreach view_name in array array['labs','items'] loop
  foreach sort_name in array case when view_name='labs' then array['sales','gp','margin','margin_asc']
   else array['sales','gp','margin','margin_asc','spread'] end loop
   foreach filter_name in array case when view_name='labs' then array['all','low','unlinked']
    else array['all','low','below_cost','spread'] end loop
    for page_number in 1..2 loop
     r:=pg_temp.m_call('get_growth_margin',jsonb_build_object('view',view_name,'page',page_number,'sort',sort_name,'filter',filter_name));
     with selected as (
      select * from expected_rows e where e.view_name=tests.view_name and
       (filter_name='all' or (filter_name='low' and low) or (filter_name='unlinked' and unlinked)
        or (filter_name='below_cost' and below_cost) or (filter_name='spread' and spread>0))
     ), ranked as (
      select *,row_number() over(order by
       case sort_name when 'sales' then sales when 'gp' then gp when 'margin' then margin when 'spread' then spread end desc nulls last,
       case when sort_name='margin_asc' then margin end asc nulls last,key collate "C") ordinal from selected
     ), page as (select * from ranked order by ordinal limit 20 offset (page_number-1)*20)
     select jsonb_build_object('total',(select count(*) from selected),'keys',coalesce(jsonb_agg(key order by ordinal),'[]')) into expected from page;
     select jsonb_build_object('total',r->'total','keys',coalesce(jsonb_agg(coalesce(v->>'labKey',v->>'itemKey') order by a.n),'[]'))
     into actual from jsonb_array_elements(r->'rows') with ordinality a(v,n);
     perform pg_temp.m_assert(actual=expected,'M2 exact '||view_name||'/'||sort_name||'/'||filter_name||'/'||page_number);
     perform pg_temp.m_assert(r->'levers'=pg_temp.m_call('get_growth_margin','{"view":"items","page":3}')->'levers','M2 same levers');
     perform pg_temp.m_assert(r->>'pageSize'='20' and r->>'sort'=sort_name and r->>'filter'=filter_name,'M2 metadata');
    end loop;
   end loop;
  end loop;
 end loop;
 -- M3. Literal substring, trim, case folding, linked and unlinked identities.
 r:=pg_temp.m_call('get_growth_margin','{"view":"labs","page":1,"q":"  ALPHA  "}');
 perform pg_temp.m_assert(r->>'total'='2' and r->>'q'='ALPHA','M3 linked and ledger name');
 r:=pg_temp.m_call('get_growth_margin','{"view":"items","page":1,"q":"mArGiN SpReAd"}');
 perform pg_temp.m_assert(r->>'total'='1' and r#>>'{rows,0,name}'='Margin spread','M3 latest item name');
 r:=pg_temp.m_call('get_growth_margin','{"view":"items","page":1,"q":"%"}');
 perform pg_temp.m_assert(r->>'total'='0','M3 substring has no wildcard syntax');

 detail:=pg_temp.m_call('get_growth_margin_detail','{"itemKey":"margin-co|spread|pack","page":1}');
 perform pg_temp.m_assert(detail->>'typicalPricePaise'='100000' and detail->>'labs'='7' and detail->>'total'='7','M4 median of weighted lab prices');
 r:=pg_temp.m_call('get_growth_margin','{"view":"items","page":1,"q":"Margin spread"}');
 perform pg_temp.m_assert((r#>>'{rows,0,priceLowPaise}')::numeric=85000 and (r#>>'{rows,0,priceHighPaise}')::numeric=100000,'M4 band excludes pack and high outlier');
 r:=pg_temp.m_call('get_growth_margin','{"view":"items","page":1,"q":"Margin two"}');
 perform pg_temp.m_assert(r#>'{rows,0,typicalPricePaise}'='null' and r#>'{rows,0,priceLowPaise}'='null'
  and r#>'{rows,0,priceHighPaise}'='null' and r#>>'{rows,0,spreadPaise}'='0','M4 fewer than three');
 perform pg_temp.m_assert(detail#>>'{rows,0,labKey}'='margin-co|P1' and (detail#>>'{rows,0,packDifference}')::boolean
  and not (detail#>>'{rows,0,belowTypical}')::boolean and (detail#>>'{rows,1,belowTypical}')::boolean
  and not (detail#>>'{rows,1,packDifference}')::boolean and not (detail#>>'{rows,2,belowTypical}')::boolean
  and not (detail#>>'{rows,2,packDifference}')::boolean,'M5 0.35 pack, 0.85 below, 0.95 neither');
 perform pg_temp.m_assert((detail#>>'{rows,1,unitPricePaise}')::numeric=85000
  and (detail#>>'{rows,1,quantity}')::numeric=10,'M4 weighted lab price');
 perform pg_temp.m_assert(r#>'{levers,priceSpread}'='{"items":1,"pairs":1,"paise":150000}'::jsonb,'M6 spread and pairs exact');
 perform pg_temp.m_assert((r->>'thresholdPct')::numeric=threshold
  and r->'consumablesMarginPct'=g#>'{consumables,gpPct}','M7 half margin threshold');
 r:=pg_temp.m_call('get_growth_margin','{"view":"items","page":1,"filter":"low"}');
 perform pg_temp.m_assert(r->>'total'='2' and r#>>'{rows,0,itemKey}'='margin-co|low-a|pack'
  and r#>>'{rows,1,itemKey}'='margin-co|low-b|pack','M7 item minimum');
 r:=pg_temp.m_call('get_growth_margin','{"view":"labs","page":1,"filter":"low"}');
 perform pg_temp.m_assert(r->>'total'='2','M7 lab minimum including exact boundary');
 select jsonb_build_object('items',2,'paiseToThreshold',greatest(0,15000000*threshold/100-465000)+greatest(0,10000000*threshold/100-500000),
  'examples',jsonb_build_array(jsonb_build_object('name','Margin low-a','marginPct',3.1,'salesPaise',15000000,'labs',1),
   jsonb_build_object('name','Margin low-b','marginPct',5.0,'salesPaise',10000000,'labs',1))) into expected;
 perform pg_temp.m_assert(r#>'{levers,lowMargin}'=expected,'M8 threshold opportunity and top two examples');
 perform pg_temp.m_assert(r#>'{levers,freeGoods}'='{"lines":1,"costPaise":285000}'::jsonb,'M9 free goods exact');
 perform pg_temp.m_assert(r#>'{levers,instrumentsGpPaise}'=g#>'{instruments,gpPaise}','instrument lever');

 -- M10. Exact catalog/master identity and inclusive current approval dates.
 perform pg_temp.m_assert(detail->>'tallyItemKey'='Margin spread'
  and (detail#>>'{rows,1,approvedPricePaise}')::numeric=81234
  and detail#>'{rows,0,approvedPricePaise}'='null','M10 exact match and only current approved price');
 lab_detail:=pg_temp.m_call('get_growth_margin_detail','{"labKey":"margin-co|P2","page":1}');
 perform pg_temp.m_assert(lab_detail->>'name'='Linked Alpha' and lab_detail->>'town'='Test Town'
  and lab_detail#>>'{rows,0,itemKey}'='margin-co|spread|pack'
  and (lab_detail#>>'{rows,0,approvedPricePaise}')::numeric=81234
  and lab_detail#>'{rows,1,tallyItemKey}'='null' and lab_detail#>'{rows,1,approvedPricePaise}'='null','M10 lab detail match and case mismatch');
 r:=pg_temp.m_call('get_growth_margin_detail','{"itemKey":"margin-co|two|pack","page":1}');
 perform pg_temp.m_assert(r->'tallyItemKey'='null' and not exists(select 1 from jsonb_array_elements(r->'rows') x
  where x->'approvedPricePaise'<>'null'::jsonb),'M10 case mismatch cannot read approved price');
 r:=pg_temp.m_call('get_growth_margin_detail','{"itemKey":"margin-co|credit|pack","page":1}');
 perform pg_temp.m_assert(r->>'total'='0' and r->'rows'='[]','item detail requires an observed sale price');
 r:=pg_temp.m_call('get_growth_margin_detail','{"labKey":"margin-co|credit","page":1}');
 perform pg_temp.m_assert(r->>'total'='1' and r#>'{rows,0,unitPricePaise}'='null'
  and (r#>>'{rows,0,salesPaise}')::numeric=-100,'lab detail retains unpriced credit');
 -- Current approved rows are absent for these items despite other statuses.
 foreach item in array array['draft','pending_approval','superseded','expired','future'] loop
  insert into private.stockflow_products(tally_item_key,name,item_group) values('Margin '||item,'Margin '||item,'Margin fixture');
  insert into private.stockflow_customer_product_prices(customer_id,tally_item_key,price_amount,valid_from,valid_to,status,
   source_type,reason,created_by_email,approved_by_email,approved_at)
  values('f2000000-0000-4000-8000-000000000001','Margin '||item,999,
   case when item='future' then '2031-07-16'::date else '2030-01-01'::date end,
   case when item='expired' then '2031-07-14'::date end,
   case when item in ('expired','future') then 'approved' else item end,'customer_contract','fixture','fixture','fixture',now());
  perform pg_temp.m_line('status-'||item,item,'P2',1,10000);
 end loop;
 insert into private.stockflow_economic_item_catalogs(company_id,source_version,observed_at,content)
 select 'margin-co','statuses','2031-07-16',jsonb_build_object('products',(select content->'products'
  from private.stockflow_economic_item_catalogs where company_id='margin-co' and source_version='latest')||
  (select jsonb_agg(jsonb_build_object('id',x,'name','Margin '||x)) from unnest(array['draft','pending_approval','superseded','expired','future']) x));
 foreach item in array array['draft','pending_approval','superseded','expired','future'] loop
  r:=pg_temp.m_call('get_growth_margin_detail',jsonb_build_object('itemKey','margin-co|'||item||'|pack','page',1));
  perform pg_temp.m_assert(r->>'tallyItemKey'='Margin '||item and r#>'{rows,0,approvedPricePaise}'='null','M10 ignores '||item);
 end loop;

 -- M11. Invalid inputs are rejected through the public entry point.
 for payload in select x from jsonb_array_elements('[
  {"view":"bad","page":1},{"view":"labs","page":1,"sort":"spread"},
  {"view":"items","page":1,"sort":"bad"},{"view":"items","page":1,"filter":"unlinked"},
  {"view":"labs","page":1,"filter":"below_cost"},{"view":"labs","page":1,"extra":1},
  {"view":"labs","page":0},{"view":"labs","page":1.5},{"view":"labs","page":"1"},
  {"view":"labs","page":2147483648},{"view":"labs","page":1,"q":" "},
  {"view":"labs","page":1,"q":null},{"view":"labs","page":1,"sort":null},
  {"view":"labs","page":1,"filter":null},{"page":1},null,[],{}
 ]'::jsonb||jsonb_build_array(jsonb_build_object('view','labs','page',1,'q',repeat('a',61)))) x loop
  begin perform pg_temp.m_call('get_growth_margin',payload);raise exception 'M11 accepted invalid list %',payload;
  exception when sqlstate '22023' then null;end;
 end loop;
 for payload in select x from jsonb_array_elements('[
  {"itemKey":"margin-co|spread|pack","labKey":"margin-co|P1","page":1},{"page":1},
  {"itemKey":"unknown","page":1},{"labKey":"unknown","page":1},
  {"itemKey":null,"page":1},{"labKey":3,"page":1},
  {"itemKey":"margin-co|spread|pack","page":1,"q":"x"},
  {"itemKey":"margin-co|spread|pack","page":0},{"labKey":"margin-co|P1","page":2147483648},
  {"itemKey":"margin-co|spread|pack"},null,[]
 ]') x loop
  begin perform pg_temp.m_call('get_growth_margin_detail',payload);raise exception 'M11 accepted invalid detail %',payload;
  exception when sqlstate '22023' then null;end;
 end loop;
 foreach role_name in array array['sales','operations'] loop
  foreach action in array array['get_growth_margin','get_growth_margin_detail'] loop
   begin perform pg_temp.m_call(action,'{}',role_name);raise exception 'M11 unauthorized role %',role_name;
   exception when sqlstate 'PT403' then null;end;
  end loop;
 end loop;
 perform pg_temp.m_call('get_growth_margin','{"view":"labs","page":1}','administrator');
 perform pg_temp.m_call('get_growth_margin_detail','{"labKey":"margin-co|P2","page":1}','administrator');
 foreach role_name in array array['anon','authenticated','service_role'] loop
  foreach action in array array['stockflow_growth_costed_lines(date)','stockflow_growth_margin_model(date)',
   'stockflow_growth_margin_read(date,jsonb)','stockflow_growth_margin_detail(date,jsonb)'] loop
   perform pg_temp.m_assert(not has_function_privilege(role_name,'private.'||action,'execute'),'M11 private ACL '||action);
  end loop;
 end loop;
 perform pg_temp.m_assert((select proconfig @> array['statement_timeout=20s'] from pg_proc
  where oid='public.stockflow_growth_gateway(text,text,text,jsonb)'::regprocedure),'M11 gateway timeout');

 -- Both detail directions paginate ties by their keys, including an empty page.
 for n in 1..24 loop
  item:='tie-'||lpad(n::text,2,'0');
  perform pg_temp.m_line('page-lab-'||n,item,'page-lab',1,100000);
  perform pg_temp.m_line('page-item-'||n,'page-item','T'||lpad(n::text,2,'0'),1,100000);
 end loop;
 r:=pg_temp.m_call('get_growth_margin_detail','{"labKey":"margin-co|page-lab","page":2}');
 select jsonb_agg('margin-co|tie-'||lpad(x::text,2,'0')||'|pack' order by x) into expected from generate_series(21,24) x;
 select jsonb_agg(x->>'itemKey' order by a.n) into actual from jsonb_array_elements(r->'rows') with ordinality a(x,n);
 perform pg_temp.m_assert(r->>'total'='24' and actual=expected,'M2 lab detail page two tie ordering');
 r:=pg_temp.m_call('get_growth_margin_detail','{"itemKey":"margin-co|page-item|pack","page":2}');
 select jsonb_agg('margin-co|T'||lpad(x::text,2,'0') order by x) into expected from generate_series(21,24) x;
 select jsonb_agg(x->>'labKey' order by a.n) into actual from jsonb_array_elements(r->'rows') with ordinality a(x,n);
 perform pg_temp.m_assert(r->>'total'='24' and actual=expected,'M2 item detail page two tie ordering');
 r:=pg_temp.m_call('get_growth_margin_detail','{"itemKey":"margin-co|page-item|pack","page":3}');
 perform pg_temp.m_assert(r->>'total'='24' and r->'rows'='[]','M2 detail empty later page');

 perform pg_temp.m_line('buy-low-edge','low-edge',null,100,10000000,'purchase','2020-01-01');
 perform pg_temp.m_line('low-edge','low-edge','P1',25,2500000);
 perform pg_temp.m_line('buy-loss-edge','loss-edge',null,100,12000000,'purchase','2020-01-01');
 perform pg_temp.m_line('loss-edge','loss-edge','P1',2.5,250000);
 perform pg_temp.m_line('buy-loss-small','loss-small',null,100,12000000,'purchase','2020-01-01');
 perform pg_temp.m_line('loss-small','loss-small','P1',2.5,249999);
 r:=pg_temp.m_call('get_growth_margin','{"view":"items","page":1,"filter":"low"}');
 perform pg_temp.m_assert(exists(select 1 from jsonb_array_elements(r->'rows') x
  where x->>'itemKey'='margin-co|low-edge|pack'),'M7 inclusive item sales minimum');
 r:=pg_temp.m_call('get_growth_margin','{"view":"items","page":1,"filter":"below_cost"}');
 perform pg_temp.m_assert(exists(select 1 from jsonb_array_elements(r->'rows') x where x->>'itemKey'='margin-co|loss-edge|pack')
  and not exists(select 1 from jsonb_array_elements(r->'rows') x where x->>'itemKey'='margin-co|loss-small|pack'),
  'M7 inclusive below-cost minimum and one paise below');

 -- M12. Additional revisions, normalized units, unknown mismatches and returns
 -- exercise the shared costed set. GP1-GP12 and K1-K8 run earlier in this replay.
 perform pg_temp.m_line('mismatch','spread','P1',2000,10000);
 perform pg_temp.m_line('other-unit','spread','P1',1,10000,'sale','2030-08-10','box');
 perform pg_temp.m_line('revised','spread','P1',1,10000);
 perform pg_temp.m_line('revised','spread','P1',2,200000,'sale','2030-08-10',' PACK ',2);
 perform pg_temp.m_line('cancelled','spread','P1',1,10000,'sale','2030-08-10','pack',1,true);
 perform pg_temp.m_line('late-purchase','spread',null,100,7000000,'purchase','2030-10-01');
 perform pg_temp.m_line('matched-return','spread','P2',-1,-85000,'return','2030-11-01');
 g:=private.stockflow_growth_gp(today);
 foreach view_name in array array['labs','items'] loop
  foreach field in array array['salesPaise','knownSalesPaise','gpPaise'] loop
   sum_value:=0;
   for page_number in 1..3 loop
    r:=pg_temp.m_call('get_growth_margin',jsonb_build_object('view',view_name,'page',page_number));
    select sum_value+coalesce(sum((x->>field)::numeric),0) into sum_value from jsonb_array_elements(r->'rows') x;
   end loop;
   perform pg_temp.m_assert(sum_value=(g#>>array['consumables',field])::numeric,'M12 equality '||view_name||' '||field);
  end loop;
 end loop;
 started:=clock_timestamp();perform private.stockflow_growth_gp(today);duration:=clock_timestamp()-started;
 raise notice 'M12 refactored GP duration %',duration;
 perform pg_temp.m_assert(duration<interval '2 seconds','M12 GP duration');

 -- A null source is explicitly outside the lab definition. Preserve its
 -- contribution to item/company totals without creating a fabricated lab key.
 r:=pg_temp.m_call('get_growth_margin','{"view":"labs","page":1}');
 perform pg_temp.m_line('no-source','spread',null,1,100000);
 detail:=pg_temp.m_call('get_growth_margin','{"view":"labs","page":1}');
 perform pg_temp.m_assert(detail->'rows'=r->'rows' and detail->'total'=r->'total','null source excluded from labs');
 r:=pg_temp.m_call('get_growth_margin','{"view":"items","page":1,"q":"Margin spread"}');
 perform pg_temp.m_assert((r#>>'{rows,0,salesPaise}')::numeric=(select sum(net) from private.stockflow_growth_costed_lines(today)
  where not instrument and company_id='margin-co' and product_id='spread' and unit='pack'),'null source retained in item totals');
end$tests$;

do $$declare r record;begin
 for r in select action,count(*) reads,min(elapsed) fastest,max(elapsed) slowest from margin_read_durations group by action loop
  raise notice 'M12 duration summary % reads=% min=% max=%',r.action,r.reads,r.fastest,r.slowest;
 end loop;
end$$;

rollback;
do $$begin
 if exists(select 1 from private.stockflow_economic_source_vouchers where company_id='margin-co') then
  raise exception 'Margin fixture leaked';end if;
 raise notice 'PASS growth margin M1-M12';
end$$;
