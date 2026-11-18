begin;
set local statement_timeout='300s';
set local lock_timeout='60s';

create function pg_temp.m_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Growth lapsing labs assertion failed: %',label;end if;end$$;

create function pg_temp.m_line(src text,lab text,d date,net bigint) returns void language plpgsql as $$
declare voucher uuid;
begin
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,kind,cancelled,evidence)
 values('lapsing-co',src,1,d,lab,'sale',false,'{}') returning id into voucher;
 insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
 values(voucher,'1','lapsing-item',1,'pack',net,'{}');
end$$;

insert into private.stockflow_gateway_config(name,secret_sha256)
values('orders',encode(extensions.digest('lapsing-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,roles,status)
values('lapsing-management@test.local','management',array['management'],'active');
do $clock$
declare f text;
begin
 select pg_get_functiondef('public.stockflow_growth_gateway(text,text,text,jsonb)'::regprocedure) into f;
 execute replace(f,'(now() at time zone ''Asia/Kolkata'')::date','''2031-07-15''::date');
end$clock$;

create function pg_temp.m_call(payload jsonb) returns jsonb language sql as $$
 select public.stockflow_growth_gateway('lapsing-key','lapsing-management@test.local','get_growth_lab_months',payload)
$$;

do $fixture$
declare n integer; customer uuid;
begin
 for n in 1..3 loop
  customer:=gen_random_uuid();
  insert into private.stockflow_customers(id,name,tally_key,created_by_email)
  values(customer,'Test Lab '||chr(64+n),'lapsing-lab-'||n,'fixture');
  insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
  values('lapsing-co','lab-'||n,customer,'fixture');
 end loop;
 -- Core means at least five positive-net months in the 12 completed months.
 -- Lab A stopped over 60 days ago; lab B has the same history and a recent sale.
 for n in 0..4 loop
  perform pg_temp.m_line('a-'||n,'lab-1',('2030-07-10'::date+make_interval(months=>n))::date,100000);
  perform pg_temp.m_line('b-'||n,'lab-2',('2030-07-10'::date+make_interval(months=>n))::date,100000);
 end loop;
 perform pg_temp.m_line('b-recent','lab-2','2031-07-10',100000);
 -- Lab C stopped too, but its single buying month never qualified as core.
 perform pg_temp.m_line('c-only','lab-3','2030-11-10',100000);
end$fixture$;

do $checks$
declare r jsonb; entry jsonb; payload jsonb; role_name text;
begin
 r:=pg_temp.m_call('{"filter":"lapsing"}');
 perform pg_temp.m_assert(r=private.stockflow_growth_lapsing_labs_read('2031-07-15'),'lapsing gateway dispatch');
 select value into entry from jsonb_array_elements(r->'rows') where value->>'labKey'='lapsing-co|lab-1';
 perform pg_temp.m_assert(entry->>'name'='Test Lab A' and entry->'buyingMonths'='5'::jsonb
  and entry->>'lastPurchaseOn'='2030-11-10' and entry->'monthsMissed'='3'::jsonb
  and entry->'usualMonthlyPaise'='100000'::jsonb,'lapsing core lab listed');
 perform pg_temp.m_assert(not exists(select 1 from jsonb_array_elements(r->'rows') e
  where e->>'labKey' in ('lapsing-co|lab-2','lapsing-co|lab-3')),'regular buyer and never-core lab excluded');
 r:=pg_temp.m_call('{}');
 perform pg_temp.m_assert(r=private.stockflow_growth_lab_months_read('2031-07-15') and jsonb_array_length(r->'months')=12,'existing empty-payload read works');
 perform pg_temp.m_assert((select count(*)=3 from jsonb_array_elements(r->'rows') e
  where e->>'labKey' in ('lapsing-co|lab-1','lapsing-co|lab-2','lapsing-co|lab-3')),'unfiltered read retains all fixture labs');
 for payload in select value from jsonb_array_elements('[{"filter":"unknown"},{"filter":"lapsing","page":1},[],null]'::jsonb) loop
  begin
   perform pg_temp.m_call(payload);
   raise exception 'Accepted invalid lab months payload %',payload;
  exception when sqlstate '22023' then null;end;
 end loop;
 foreach role_name in array array['authenticated','service_role'] loop
  perform pg_temp.m_assert(not has_function_privilege(role_name,'private.stockflow_growth_lapsing_labs_read(date)','execute'),'private ACL '||role_name);
 end loop;
end$checks$;

rollback;
