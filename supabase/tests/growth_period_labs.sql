begin;
set local statement_timeout='300s';

create function pg_temp.gp_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Growth period assertion failed: %',label;end if;end$$;
create function pg_temp.gp_voucher(src text,lab text,d date,net bigint,kind text default 'sale',
 revision integer default 1,cancelled boolean default false,company text default 'gp-co') returns void language plpgsql as $$
declare voucher uuid;
begin
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,kind,cancelled,evidence)
 values(company,src,revision,d,lab,kind,cancelled,'{}') returning id into voucher;
 insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
 values(voucher,'1','gp-item',1,'pack',net,'{}');
end$$;
create function pg_temp.gp_call(payload jsonb,actor text default 'management',key text default 'growth-period-key') returns jsonb language sql as $$
 select public.stockflow_growth_gateway(key,'gp-'||actor||'@test.local','get_growth_period',payload)
$$;
insert into private.stockflow_gateway_config(name,secret_sha256)
values('orders',encode(extensions.digest('growth-period-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,roles,status)
select 'gp-'||r||'@test.local',r,array[r],'active'
from unnest(array['administrator','management','sales','operations','accounts','warehouse']) r;

do $periods$
declare p jsonb; args jsonb;
begin
 p:=private.stockflow_growth_period('2027-03-31','fy',2026,null);
 perform pg_temp.gp_assert(p->>'to'='2027-03-31' and p->'running'='false','FY end');
 perform pg_temp.gp_assert(private.stockflow_growth_period('2027-04-01','fy',2027,null)->>'from'='2027-04-01','FY rollover');
 p:=private.stockflow_growth_period('2026-11-22','quarter',2026,3);
 perform pg_temp.gp_assert(p->>'from'='2026-10-01' and p->>'to'='2026-11-22' and p->'running'='true'
  and p->>'label'='Q3 FY 2026-27 to 22 Nov','running quarter');
 perform pg_temp.gp_assert(p->'comparisons'='[{"key":"last_year","label":"Q3 FY 2025-26 (same days)","from":"2025-10-01","to":"2025-11-22"},{"key":"previous","label":"Q2 FY 2026-27 (same days)","from":"2026-07-01","to":"2026-08-22"}]','same days');
 p:=private.stockflow_growth_period('2027-03-31','quarter',2026,4);
 perform pg_temp.gp_assert(p#>>'{comparisons,1,from}'='2026-10-01' and p#>>'{comparisons,1,to}'='2026-12-29','90 day quarter');
 p:=private.stockflow_growth_period('2027-04-01','quarter',2027,1);
 perform pg_temp.gp_assert(p#>>'{comparisons,1,label}'='Q4 FY 2026-27 (same days)' and p#>>'{comparisons,1,from}'='2027-01-01','previous FY quarter');
 p:=private.stockflow_growth_period('2028-03-31','quarter',2027,4);
 perform pg_temp.gp_assert(p#>>'{comparisons,0,from}'='2027-01-01' and p#>>'{comparisons,0,to}'='2027-03-31','leap cap');
 for args in select value from jsonb_array_elements('[{"kind":"fy","fy":2027},{"kind":"h1","fy":2026},{"kind":"fy","fy":2026,"quarter":1},{"kind":"quarter","fy":2026},{"kind":"fy","fy":2016},{"kind":"quarter","fy":2026,"quarter":4}]') loop
  begin perform private.stockflow_growth_period('2026-11-22',args->>'kind',(args->>'fy')::int,(args->>'quarter')::int);
   raise exception 'Accepted invalid period %',args;
  exception when sqlstate '22023' then perform pg_temp.gp_assert(sqlerrm='Invalid growth period','validation message');end;
 end loop;
 begin perform private.stockflow_growth_period('2027-03-31','fy',2027,null);raise exception 'Accepted future FY';
 exception when sqlstate '22023' then null;end;
end$periods$;

do $fixture$
begin
 perform pg_temp.gp_voucher('first','history','2026-05-01',1);
 perform pg_temp.gp_voucher('grew-prev','grew','2026-07-10',100);
 perform pg_temp.gp_voucher('grew-cur','grew','2026-10-10',200);
 perform pg_temp.gp_voucher('grew-return','grew','2026-10-11',-50,'return');
 perform pg_temp.gp_voucher('fell-prev','fell','2026-07-10',300);
 perform pg_temp.gp_voucher('fell-cur','fell','2026-10-10',100);
 perform pg_temp.gp_voucher('same-prev','same','2026-07-10',50);
 perform pg_temp.gp_voucher('same-cur','same','2026-10-10',50);
 perform pg_temp.gp_voucher('stopped-jul','stopped','2026-07-10',100);
 perform pg_temp.gp_voucher('stopped-aug','stopped','2026-08-10',100);
 perform pg_temp.gp_voucher('stopped-sep','stopped','2026-09-10',100);
 perform pg_temp.gp_voucher('stopped-cur','stopped','2026-10-10',-20,'credit');
 perform pg_temp.gp_voucher('new-cur','new','2026-10-10',400);
 perform pg_temp.gp_voucher('other-prev','other','2026-07-10',-30,'credit');
 perform pg_temp.gp_voucher('other-cur','other','2026-10-10',-10,'credit');
 perform pg_temp.gp_voucher('bulk','bulk','2026-10-10',20000000);
 perform pg_temp.gp_voucher('below','below','2026-10-10',19999999);
 perform pg_temp.gp_voucher('null-prev',null,'2026-07-10',70);
 perform pg_temp.gp_voucher('null-cur',null,'2026-10-10',90);
 perform pg_temp.gp_voucher('revision','revision','2026-07-10',9000);
 perform pg_temp.gp_voucher('revision','revision','2026-10-10',250,revision=>2);
 perform pg_temp.gp_voucher('cancel','cancel','2026-10-10',9000,cancelled=>true);
 perform pg_temp.gp_voucher('void','cancel','2026-07-10',9000);
 perform pg_temp.gp_voucher('void','cancel','2026-10-10',9000,revision=>2,cancelled=>true);
 perform pg_temp.gp_voucher('moved','moved','2026-10-10',9000);
 perform pg_temp.gp_voucher('moved','moved','2027-01-10',9000,revision=>2);
end$fixture$;

do $months$
declare p jsonb; r jsonb; row_value jsonb;
begin
 p:=private.stockflow_growth_period('2026-11-22','quarter',2026,3);
 r:=private.stockflow_growth_lab_months_window((p->>'from')::date,(p->>'to')::date);
 perform pg_temp.gp_assert(r->'months'='["2026-10","2026-11"]' and r->'window'='{"from":"2026-10-01","to":"2026-11-22"}','running months and inclusive window');
 perform pg_temp.gp_assert(r->>'totalLabs'='8','positive current labs including bulk');
 select value into row_value from jsonb_array_elements(r->'rows') where value->>'labKey'='gp-co|grew';
 perform pg_temp.gp_assert(row_value->'monthsPaise'='[150,0]' and row_value->>'totalPaise'='150' and row_value->>'buyingMonths'='1','return nets');
 select value into row_value from jsonb_array_elements(r->'rows') where value->>'labKey'='gp-co|revision';
 perform pg_temp.gp_assert(row_value->>'totalPaise'='250','new revision replaces old');
 perform pg_temp.gp_assert(not exists(select 1 from jsonb_array_elements(r->'rows') where value->>'labKey' in ('gp-co|cancel','gp-co|moved')),'cancelled and moved latest suppress old');
 perform pg_temp.gp_voucher('inclusive','inclusive','2026-11-22',17);
 perform pg_temp.gp_voucher('excluded','excluded','2026-11-23',19);
 r:=private.stockflow_growth_lab_months_window('2026-10-01','2026-11-22');
 perform pg_temp.gp_assert(exists(select 1 from jsonb_array_elements(r->'rows') where value->>'labKey'='gp-co|inclusive')
  and not exists(select 1 from jsonb_array_elements(r->'rows') where value->>'labKey'='gp-co|excluded'),'inclusive end');
 p:=private.stockflow_growth_period('2027-03-31','fy',2026,null);
 r:=private.stockflow_growth_lab_months_window((p->>'from')::date,(p->>'to')::date);
 perform pg_temp.gp_assert(jsonb_array_length(r->'months')=12 and r#>>'{months,0}'='2026-04' and r#>>'{months,11}'='2027-03','FY Apr to Mar');
 perform pg_temp.gp_assert((select sum((value->>'totalPaise')::numeric) from jsonb_array_elements(r->'rows'))=40010876,'FY voucher totals');
end$months$;

do $lists$
declare p jsonb:='{"kind":"quarter","fy":2026,"quarter":3}'; r jsonb; summary jsonb; cls text; n integer; total_value numeric; expected jsonb;
begin
 -- Force a second page and deterministic ties, while retaining the P1 fixtures.
 for n in 1..23 loop perform pg_temp.gp_voucher('page-'||n,'page-'||lpad(n::text,2,'0'),'2026-10-12',10);end loop;
 perform pg_temp.gp_voucher('stopped-short','stopped-short','2026-07-12',25);
 summary:=private.stockflow_growth_period_read('2026-12-31',array['management'],p);
 foreach cls in array array['new','stopped','grew','fell'] loop
  total_value:=0; n:=1;
  loop
   r:=private.stockflow_growth_period_labs('2026-12-31',array['management'],jsonb_build_object('period',p,'comparison','previous','list','bridge_'||cls,'page',n));
   total_value:=total_value+coalesce((select sum((value->>'valuePaise')::numeric) from jsonb_array_elements(r->'rows')),0);
   perform pg_temp.gp_assert((r->>'total')::int=(summary#>>array['comparisons','1','bridge',cls,'labs'])::int,'class total '||cls);
   exit when n*20>=(r->>'total')::int; n:=n+1;
  end loop;
  perform pg_temp.gp_assert(total_value=(summary#>>array['comparisons','1','bridge',cls,'paise'])::numeric,'all pages P1 bridge identity '||cls);
 end loop;
 r:=private.stockflow_growth_period_labs('2026-12-31',array['management'],jsonb_build_object('period',p,'comparison','previous','list','bridge_new','page',1));
 perform pg_temp.gp_assert((select jsonb_agg(jsonb_build_array(value->>'labKey',value->'valuePaise') order by ordinal)
  from jsonb_array_elements(r->'rows') with ordinality x(value,ordinal) where ordinal<=6)
  ='[["gp-co|bulk",20000000],["gp-co|below",19999999],["gp-co|new",400],["gp-co|revision",250],["gp-co|excluded",19],["gp-co|inclusive",17]]','new fixture rows and values');
 r:=private.stockflow_growth_period_labs('2026-12-31',array['management'],jsonb_build_object('period',p,'comparison','previous','list','bridge_new','page',2));
 perform pg_temp.gp_assert(r->>'total'='29' and jsonb_array_length(r->'rows')=9 and r#>>'{rows,8,labKey}'='gp-co|page-23','new page two and C ties');
 r:=private.stockflow_growth_period_labs('2026-12-31',array['management'],jsonb_build_object('period',p,'comparison','previous','list','bridge_stopped','page',1,'regularOnly',true));
 perform pg_temp.gp_assert(r->>'total'='1' and r#>>'{rows,0,labKey}'='gp-co|stopped' and r#>>'{rows,0,valuePaise}'='320'
  and r#>>'{rows,0,comparisonPaise}'='300' and r#>>'{rows,0,currentPaise}'='-20' and r#>>'{rows,0,monthsBought}'='0'
  and r#>>'{rows,0,lastBoughtOn}'='2026-10-10','regular stopped fields');
 foreach cls in array array['grew','fell'] loop
  r:=private.stockflow_growth_period_labs('2026-12-31',array['management'],jsonb_build_object('period',p,'comparison','previous','list','bridge_'||cls,'page',1));
  expected:=case when cls='grew' then '[ ["gp-co|grew",50], ["gp-co|",20] ]'::jsonb else '[["gp-co|fell",200]]'::jsonb end;
  perform pg_temp.gp_assert((select jsonb_agg(jsonb_build_array(value->>'labKey',value->'valuePaise') order by ordinal) from jsonb_array_elements(r->'rows') with ordinality x(value,ordinal))=expected,'fixture rows '||cls);
 end loop;
 r:=private.stockflow_growth_period_labs('2026-12-31',array['management'],jsonb_build_object('period',p,'list','window_labs','page',1));
 perform pg_temp.gp_assert(r->>'total'='33' and r->'comparison'='null' and r#>>'{rows,0,labKey}'='gp-co|bulk'
  and r#>>'{rows,0,valuePaise}'='20000000' and r#>'{rows,0,comparisonPaise}'='null','window totals and order');
 r:=private.stockflow_growth_period_labs('2026-12-31',array['management'],jsonb_build_object('period',p,'comparison','last_year','list','bridge_new','page',1));
 perform pg_temp.gp_assert(r->>'reason'='no_history' and r->>'total'='0' and r->'rows'='[]','no history empty');
 begin perform private.stockflow_growth_period_labs('2026-12-31',array['sales'],jsonb_build_object('period',p,'list','window_labs','page',1));raise exception 'Accepted sales';
 exception when sqlstate 'PT403' then null;end;
end$lists$;

do $gateway$
declare action_name text; payload jsonb; f text; signature text; role_name text; r jsonb;
begin
 select pg_get_functiondef('public.stockflow_growth_gateway(text,text,text,jsonb)'::regprocedure) into f;
 execute replace(f,'(now() at time zone ''Asia/Kolkata'')::date','''2026-12-31''::date');
 foreach action_name in array array['get_growth_lab_months_period','get_growth_labs_period'] loop
  payload:=case when action_name='get_growth_lab_months_period' then '{"period":{"kind":"quarter","fy":2026,"quarter":3}}'::jsonb
   else '{"period":{"kind":"quarter","fy":2026,"quarter":3},"list":"bridge_new","comparison":"previous","page":1}'::jsonb end;
  begin perform public.stockflow_growth_gateway('wrong','gp-management@test.local',action_name,payload);raise exception 'Accepted key';
  exception when sqlstate '42501' then null;end;
  foreach role_name in array array['sales','missing'] loop
   begin perform public.stockflow_growth_gateway('growth-period-key','gp-'||role_name||'@test.local',action_name,payload);raise exception 'Accepted role';
   exception when sqlstate 'PT403' then null;end;
  end loop;
  r:=public.stockflow_growth_gateway('growth-period-key','gp-management@test.local',action_name,payload);
  perform pg_temp.gp_assert(r->'rows' is not null,'gateway success '||action_name);
 end loop;
 for payload in select value from jsonb_array_elements('[
  {"period":{"kind":"quarter","fy":2026,"quarter":3},"list":"bridge_new","comparison":"previous","page":1,"extra":1},
  {"period":{"kind":"quarter","fy":2026,"quarter":3},"list":"window_labs","comparison":"previous","page":1},
  {"period":{"kind":"fy","fy":2026},"list":"bridge_new","comparison":"previous","page":1},
  {"period":{"kind":"quarter","fy":2026,"quarter":3},"list":"bridge_new","comparison":"previous","page":0},
  {"period":{"kind":"quarter","fy":2026,"quarter":3},"list":"bridge_new","comparison":"previous","page":1.5},
  {"period":{"kind":"quarter","fy":2026,"quarter":3},"list":"bridge_new","comparison":"previous","page":1,"regularOnly":false},
  {"period":{"kind":"quarter","fy":2026,"quarter":3},"list":"bridge_new","page":1},
  {"period":{"kind":"quarter","fy":2026,"quarter":3},"list":"window_labs","page":1001},
  {"period":{"kind":"quarter","fy":2026,"quarter":3},"list":"bridge_stopped","comparison":"previous","page":1,"regularOnly":null}
 ]') loop
  begin perform public.stockflow_growth_gateway('growth-period-key','gp-management@test.local','get_growth_labs_period',payload);raise exception 'Accepted labs payload %',payload;
  exception when sqlstate '22023' then perform pg_temp.gp_assert(sqlerrm='Invalid growth labs request','labs validation message');end;
 end loop;
 foreach action_name in array array['get_growth_lab_months_period','get_growth_labs_period'] loop
  for payload in select value from jsonb_array_elements('[{"kind":"fy","fy":"2026"},{"kind":"fy","fy":2026,"quarter":null},{"kind":"quarter","fy":2026,"quarter":2.5},{"kind":"fy","fy":2026.5},{"kind":"fy","fy":2026,"extra":1},null]') loop
   payload:=jsonb_build_object('period',payload)||case when action_name='get_growth_labs_period' then '{"list":"window_labs","page":1}'::jsonb else '{}'::jsonb end;
   begin perform public.stockflow_growth_gateway('growth-period-key','gp-management@test.local',action_name,payload);raise exception 'Accepted period payload';
   exception when sqlstate '22023' then perform pg_temp.gp_assert(sqlerrm='Invalid growth period','P1 period validation');end;
  end loop;
 end loop;
 begin perform public.stockflow_growth_gateway('growth-period-key','gp-management@test.local','get_growth_lab_months_period','{"period":{"kind":"fy","fy":2026},"extra":1}');raise exception 'Accepted months extra';
 exception when sqlstate '22023' then null;end;
 perform pg_temp.gp_assert(public.stockflow_growth_gateway('growth-period-key','gp-management@test.local','get_growth_period','{"period":{"kind":"fy","fy":2026}}')
  =public.stockflow_growth_gateway_before_period_labs('growth-period-key','gp-management@test.local','get_growth_period','{"period":{"kind":"fy","fy":2026}}'),'period delegate');
 perform pg_temp.gp_assert(public.stockflow_growth_gateway('growth-period-key','gp-management@test.local','get_growth','{}')
  =public.stockflow_growth_gateway_before_period_labs('growth-period-key','gp-management@test.local','get_growth','{}'),'rolling delegate');
 perform pg_temp.gp_assert((select 'statement_timeout=20s'=any(proconfig) from pg_proc where oid='public.stockflow_growth_gateway(text,text,text,jsonb)'::regprocedure),'20s timeout');
 foreach signature in array array['private.stockflow_growth_lab_months_window(date,date)','private.stockflow_growth_period_labs(date,text[],jsonb)','public.stockflow_growth_gateway_before_period_labs(text,text,text,jsonb)'] loop
  foreach role_name in array array['anon','authenticated','service_role'] loop
   perform pg_temp.gp_assert(not has_function_privilege(role_name,signature,'execute'),'private ACL '||signature||role_name);
  end loop;
 end loop;
 perform pg_temp.gp_assert(has_function_privilege('service_role','public.stockflow_growth_gateway(text,text,text,jsonb)','execute')
  and not has_function_privilege('anon','public.stockflow_growth_gateway(text,text,text,jsonb)','execute')
  and not has_function_privilege('authenticated','public.stockflow_growth_gateway(text,text,text,jsonb)','execute'),'gateway ACL');
 raise notice 'PASS growth period lab months, bridge identities, paging, validation and privacy';
end$gateway$;
rollback;
