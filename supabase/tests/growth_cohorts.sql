begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

create function pg_temp.m_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Growth cohorts assertion failed: %',label;end if;end$$;

create function pg_temp.m_line(src text,lab text,d date,net bigint,cancelled boolean default false) returns void language plpgsql as $$
declare voucher uuid;
begin
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,kind,cancelled,evidence)
 values('cohorts-co',src,1,d,lab,'sale',cancelled,'{}') returning id into voucher;
 insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
 values(voucher,'1','cohorts-item',1,'pack',net,'{}');
end$$;

insert into private.stockflow_gateway_config(name,secret_sha256)
values('orders',encode(extensions.digest('cohorts-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,roles,status) values
 ('cohorts-management@test.local','management',array['management'],'active'),
 ('cohorts-operations@test.local','operations',array['operations'],'active'),
 ('cohorts-sales@test.local','sales',array['sales'],'active');
do $clock$
declare f text;
begin
 select pg_get_functiondef('public.stockflow_growth_gateway(text,text,text,jsonb)'::regprocedure) into f;
 execute replace(f,'(now() at time zone ''Asia/Kolkata'')::date','''2026-11-25''::date');
end$clock$;

do $fixture$
declare lab text; customer uuid;
begin
 foreach lab in array array['E','A','B','C'] loop
  customer:=gen_random_uuid();
  insert into private.stockflow_customers(id,name,city,tally_key,created_by_email)
  values(customer,'Cohort Lab '||lab,'Fixture Town','cohorts-'||lab,'fixture');
  insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
  values('cohorts-co',lab,customer,'fixture');
 end loop;
 perform pg_temp.m_line('e-first','E','2023-08-15',1000);
 perform pg_temp.m_line('e-last','E','2026-10-15',1000);
 perform pg_temp.m_line('a-first','A','2025-03-15',5000);
 perform pg_temp.m_line('a-last','A','2026-02-10',10000);
 perform pg_temp.m_line('b-only','B','2025-05-20',2000);
 perform pg_temp.m_line('c-first','C','2026-06-15',1000);
 perform pg_temp.m_line('c-last','C','2026-10-15',1000);
 perform pg_temp.m_line('cancelled','ignored-cancelled','2020-01-01',99999,true);
 perform pg_temp.m_line('negative','ignored-negative','2021-01-01',-99999);
end$fixture$;

do $checks$
declare r jsonb; entry jsonb; payload jsonb; role_name text;
begin
 r:=private.stockflow_growth_cohorts_read('2026-11-25',null);
 perform pg_temp.m_assert(jsonb_array_length(r->'rows')=3,'three cohorts, ignored vouchers');
 perform pg_temp.m_assert(r#>>'{rows,0,cohort}'='existing' and r#>>'{rows,1,cohort}'='2025'
  and r#>>'{rows,2,cohort}'='2026','cohort order');
 entry:=r#>'{rows,0}';
 perform pg_temp.m_assert(entry @> '{"labs":1,"active":1,"activePct":100,"stopped":0,"lostPaise":0}', 'existing counts');
 perform pg_temp.m_assert(entry->>'label'='Buying when records start (Aug 2023–Oct 2023)','existing label');
 perform pg_temp.m_assert(r#>'{rows,1}' @> '{"labs":2,"active":0,"activePct":0,"stopped":2,"lostPaise":17000}',
  '2025 loss includes both A sales within its own 365-day window');
 perform pg_temp.m_assert(r#>'{rows,2}' @> '{"labs":1,"active":1,"activePct":100,"stopped":0,"lostPaise":0}','2026 counts');
 perform pg_temp.m_assert(r->'totals'='{"labs":4,"active":2,"activePct":50,"stopped":2,"lostPaise":17000}'::jsonb,'totals');
 perform pg_temp.m_assert(r->>'historyFrom'='2023-08-01' and r->>'asOf'='2026-11-25','history and as of');
 perform pg_temp.m_assert(jsonb_typeof(r->'reconciled')='boolean' and r->'reconciled'='false'::jsonb,
  'not reconciled without coverage rows');
 perform pg_temp.m_assert(public.stockflow_growth_gateway('cohorts-key','cohorts-management@test.local','get_growth_cohorts','{}')=r,'management grid dispatch');
 r:=private.stockflow_growth_cohorts_read('2026-11-25','2025');
 perform pg_temp.m_assert(r @> '{"cohort":"2025","label":"2025","totalLabs":2}','list header');
 perform pg_temp.m_assert(jsonb_array_length(r->'rows')=2 and r#>>'{rows,0,labKey}'='cohorts-co|A'
  and r#>>'{rows,1,labKey}'='cohorts-co|B','loss ordering');
 perform pg_temp.m_assert(r#>'{rows,0}' @> '{"name":"Cohort Lab A","town":"Fixture Town","firstPurchaseOn":"2025-03-15","lastPurchaseOn":"2026-02-10","lostPaise":15000}'
  and r#>>'{rows,0,customerId}' is not null and r#>'{rows,1,lostPaise}'='2000'::jsonb,'list details and per-lab loss');
 perform pg_temp.m_assert(public.stockflow_growth_gateway('cohorts-key','cohorts-management@test.local','get_growth_cohorts','{"cohort":"2025"}')=r,'management list dispatch');
 begin
  perform private.stockflow_growth_cohorts_read('2026-11-25','unknown');
  raise exception 'Accepted unknown cohort';
 exception when sqlstate '22023' then null;end;
 foreach role_name in array array['operations','sales','missing'] loop
  begin
   perform public.stockflow_growth_gateway('cohorts-key','cohorts-'||role_name||'@test.local','get_growth_cohorts','{}');
   raise exception 'Accepted unauthorized role %',role_name;
  exception when sqlstate 'PT403' then
   perform pg_temp.m_assert(sqlerrm='Growth access required','role rejection message');end;
 end loop;
 for payload in select value from jsonb_array_elements('[{"extra":1},{"cohort":"2025","extra":1},{"cohort":null},{"cohort":1},{"cohort":""},{"cohort":"123456789012345678901"},{"cohort":"unknown"},[],null]'::jsonb) loop
  begin
   perform public.stockflow_growth_gateway('cohorts-key','cohorts-management@test.local','get_growth_cohorts',payload);
   raise exception 'Accepted invalid cohorts payload %',payload;
  exception when sqlstate '22023' then
   perform pg_temp.m_assert(sqlerrm='Invalid growth cohorts request','payload rejection message');end;
 end loop;
 begin
  perform public.stockflow_growth_gateway('wrong-key','cohorts-management@test.local','get_growth_cohorts','{}');
  raise exception 'Accepted wrong gateway key';
 exception when sqlstate '42501' then null;end;
 foreach role_name in array array['anon','authenticated','service_role'] loop
  perform pg_temp.m_assert(not has_function_privilege(role_name,'private.stockflow_growth_cohorts_read(date,text)','execute'),'private ACL '||role_name);
  perform pg_temp.m_assert(not has_function_privilege(role_name,'public.stockflow_growth_gateway_before_cohorts(text,text,text,jsonb)','execute'),'delegate ACL '||role_name);
 end loop;
end$checks$;

rollback;
