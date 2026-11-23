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

do $read$
declare r jsonb; b jsonb; c jsonb; role_name text;
begin
 c:=private.stockflow_growth_window_check(array['gp-co'],'2026-01-01','2026-03-31');
 perform pg_temp.gp_assert(c->>'state'='no_history' and c->'historyDays'='0','no history before first sale');
 perform pg_temp.gp_assert(private.stockflow_growth_window_check(array[]::text[],'2026-01-01','2026-03-31')->'coverageComplete'='false','empty coverage');
 r:=private.stockflow_growth_period_read('2026-12-31',array['management'],'{"kind":"quarter","fy":2026,"quarter":3}');
 perform pg_temp.gp_assert(r#>'{current,tree}'='{"revenuePaise":40001009,"repeatPaise":20001009,"bulkPaise":20000000,"bulkInvoices":1,"labsBuying":7,"buyingMonths":7,"perBuyingMonthPaise":2857287}', 'current net tree, threshold, null lab and revisions');
 perform pg_temp.gp_assert(r#>'{comparisons,1,tree}'='{"revenuePaise":790,"repeatPaise":790,"bulkPaise":0,"bulkInvoices":0,"labsBuying":5,"buyingMonths":7,"perBuyingMonthPaise":113}','comparison tree');
 b:=r#>'{comparisons,1,bridge}';
 perform pg_temp.gp_assert(b='{"h1Paise":790,"h2Paise":40001009,"new":{"labs":4,"paise":40000649},"stopped":{"labs":1,"paise":320},"stoppedRegular":{"labs":1,"paise":320},"grew":{"labs":2,"paise":70},"fell":{"labs":1,"paise":200},"same":{"labs":1,"paise":0},"other":{"labs":1,"paise":20}}','all bridge classes and regular months');
 perform pg_temp.gp_assert((b->>'h1Paise')::numeric+(b#>>'{new,paise}')::numeric-(b#>>'{stopped,paise}')::numeric
  +(b#>>'{grew,paise}')::numeric-(b#>>'{fell,paise}')::numeric+(b#>>'{other,paise}')::numeric=(b->>'h2Paise')::numeric,'bridge identity');
 perform pg_temp.gp_assert(r#>>'{comparisons,0,check,state}'='no_history' and r#>'{comparisons,0,tree}'='null' and r#>'{comparisons,0,bridge}'='null','hidden comparison');
 r:=private.stockflow_growth_period_read('2026-06-30',array['administrator'],'{"kind":"quarter","fy":2026,"quarter":1}');
 perform pg_temp.gp_assert(r#>>'{comparisons,1,from}'='2026-01-01' and r#>'{comparisons,1,tree}'='null' and r#>'{comparisons,1,bridge}'='null','Q4 history hidden');
 foreach role_name in array array['sales','operations','accounts','warehouse'] loop
  begin perform private.stockflow_growth_period_read('2026-12-31',array[role_name],'{"kind":"fy","fy":2026}');raise exception 'Accepted private role';
  exception when sqlstate 'PT403' then null;end;
 end loop;
end$read$;

-- Real control and coverage rows exercise state precedence; no function stubs.
insert into private.stockflow_sales_control_imports(company_id,source_version,valid_months)
values('gp-co','gp-controls',array['2026-07-01'::date,'2026-08-01'::date,'2026-09-01'::date]);
insert into private.stockflow_sales_control_totals(company_id,month,kind,source_key,net_paise,source_version)
values('gp-co','2026-07-01','sales_ledger','sales',590,'gp-controls'),
 ('gp-co','2026-08-01','sales_ledger','sales',100,'gp-controls'),
 ('gp-co','2026-09-01','sales_ledger','sales',100,'gp-controls');
do $states$
declare c jsonb;
begin
 c:=private.stockflow_growth_window_check(array['gp-co'],'2026-07-01','2026-09-30');
 perform pg_temp.gp_assert(c->>'state'='unconfirmed' and c#>>'{months,0,state}'='matches','matching controls without coverage');
end$states$;
insert into private.stockflow_economic_source_coverage(company_id,window_from,window_to,source_version,imported_at)
values('gp-co','2026-01-01','2027-01-01','gp-coverage',clock_timestamp()+interval '1 day');
insert into private.stockflow_sales_control_imports(company_id,source_version,valid_months)
values('gp-co','gp-current',array['2026-10-01'::date,'2026-11-01'::date,'2026-12-01'::date]);
insert into private.stockflow_sales_control_totals(company_id,month,kind,source_key,net_paise,source_version)
values('gp-co','2026-10-01','sales_ledger','sales',40001009,'gp-current'),
 ('gp-co','2026-11-01','sales_ledger','sales',0,'gp-current'),
 ('gp-co','2026-12-01','sales_ledger','sales',0,'gp-current');
do $confirmed$
declare c jsonb;
begin
 c:=private.stockflow_growth_window_check(array['gp-co'],'2026-07-01','2026-09-30');
 perform pg_temp.gp_assert(c->>'state'='confirmed' and c->'coverageComplete'='true','coverage plus matching controls confirmed');
 c:=private.stockflow_growth_window_check(array['gp-co'],'2026-05-01','2026-05-31');
 perform pg_temp.gp_assert(c->>'state'='unconfirmed' and c->'coverageComplete'='true' and c#>>'{months,0,state}'='no_control','no control despite coverage');
 c:=private.stockflow_growth_period_read('2026-12-31',array['management'],'{"kind":"quarter","fy":2026,"quarter":3}');
 perform pg_temp.gp_assert(c#>>'{current,check,state}'='confirmed','current confirmed before union-only company');
end$confirmed$;
insert into private.stockflow_sales_control_imports(company_id,source_version,valid_months,imported_at)
values('gp-co','gp-different',array['2026-08-01'::date],clock_timestamp()+interval '1 second');
insert into private.stockflow_sales_control_totals(company_id,month,kind,source_key,net_paise,source_version)
values('gp-co','2026-08-01','sales_ledger','sales',999,'gp-different');
do $differs$
declare c jsonb;
begin
 c:=private.stockflow_growth_window_check(array['gp-co'],'2026-07-01','2026-09-30');
 perform pg_temp.gp_assert(c->>'state'='differs' and c#>>'{months,1,state}'='differs','differs precedes incomplete coverage');
 perform pg_temp.gp_voucher('other-company','lab','2026-07-01',1,company=>'gp-other');
 c:=private.stockflow_growth_period_read('2026-12-31',array['management'],'{"kind":"quarter","fy":2026,"quarter":3}');
 perform pg_temp.gp_assert(c#>>'{current,check,state}'='unconfirmed' and c#>>'{comparisons,1,check,state}'='differs','union companies');
end$differs$;

do $gateway$
declare payload jsonb; role_name text; signature text; f text;
begin
 -- Pin only the new wrapper for deterministic gateway period validation.
 select pg_get_functiondef('public.stockflow_growth_gateway(text,text,text,jsonb)'::regprocedure) into f;
 execute replace(f,'(now() at time zone ''Asia/Kolkata'')::date','''2026-12-31''::date');
 begin perform pg_temp.gp_call('{"period":{"kind":"fy","fy":2026}}',key=>'wrong');raise exception 'Accepted wrong key';
 exception when sqlstate '42501' then perform pg_temp.gp_assert(sqlerrm='Unauthorized gateway','key error');end;
 foreach role_name in array array['sales','operations','accounts','warehouse','missing'] loop
  begin perform pg_temp.gp_call('{"period":{"kind":"fy","fy":2026}}',role_name);raise exception 'Accepted role';
  exception when sqlstate 'PT403' then perform pg_temp.gp_assert(sqlerrm='Growth access required','role error');end;
 end loop;
 for payload in select value from jsonb_array_elements('[{"period":{"kind":"fy","fy":2026},"extra":1},{"period":{"kind":"fy","fy":2026,"extra":1}},{"period":{"kind":"fy","fy":"2026"}},{"period":{"kind":"quarter","fy":2026,"quarter":2.5}},{"period":{"kind":"fy","fy":2026,"quarter":null}},{"period":{"kind":"quarter","fy":2026}},{"period":{"kind":"fy","fy":2026.5}},{"period":null},{},[],null]') loop
  begin perform pg_temp.gp_call(payload);raise exception 'Accepted payload %',payload;
  exception when sqlstate '22023' then perform pg_temp.gp_assert(sqlerrm='Invalid growth period','payload error');end;
 end loop;
 perform pg_temp.gp_assert(pg_temp.gp_call('{"period":{"kind":"quarter","fy":2026.0,"quarter":3.0}}')->>'view'='period','integer numeric values accepted');
 perform pg_temp.gp_assert(pg_temp.gp_call('{"period":{"kind":"fy","fy":2026}}','administrator')->>'view'='period','administrator allowed');
 perform pg_temp.gp_assert(public.stockflow_growth_gateway('growth-period-key','gp-management@test.local','get_growth','{}')
  =public.stockflow_growth_gateway_before_period('growth-period-key','gp-management@test.local','get_growth','{}'),'rolling delegate');
 perform pg_temp.gp_assert((select 'statement_timeout=20s'=any(proconfig) from pg_proc where oid='public.stockflow_growth_gateway(text,text,text,jsonb)'::regprocedure),'gateway timeout');
 foreach role_name in array array['anon','authenticated','service_role'] loop
  foreach signature in array array['private.stockflow_growth_period(date,text,integer,integer)','private.stockflow_growth_window_check(text[],date,date)','private.stockflow_growth_period_read(date,text[],jsonb)','public.stockflow_growth_gateway_before_period(text,text,text,jsonb)'] loop
   perform pg_temp.gp_assert(not has_function_privilege(role_name,signature,'execute'),'private ACL '||role_name||signature);
  end loop;
 end loop;
 perform pg_temp.gp_assert(has_function_privilege('service_role','public.stockflow_growth_gateway(text,text,text,jsonb)','execute')
  and not has_function_privilege('anon','public.stockflow_growth_gateway(text,text,text,jsonb)','execute')
  and not has_function_privilege('authenticated','public.stockflow_growth_gateway(text,text,text,jsonb)','execute'),'gateway ACL');
 raise notice 'PASS growth period boundaries, trees, bridges, reconciliation, gateway and privacy';
end$gateway$;
rollback;
