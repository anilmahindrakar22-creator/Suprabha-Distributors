begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

create function pg_temp.m_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Growth new labs assertion failed: %',label;end if;end$$;

create function pg_temp.m_line(src text,lab text,d date,net bigint,cancelled boolean default false) returns void language plpgsql as $$
declare voucher uuid;
begin
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,kind,cancelled,evidence)
 values('new-labs-co',src,1,d,lab,'sale',cancelled,'{}') returning id into voucher;
 insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
 values(voucher,'1','new-labs-item',1,'pack',net,'{}');
end$$;

insert into private.stockflow_gateway_config(name,secret_sha256)
values('orders',encode(extensions.digest('new-labs-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,roles,status) values
 ('new-labs-management@test.local','management',array['management'],'active'),
 ('new-labs-operations@test.local','operations',array['operations'],'active'),
 ('new-labs-sales@test.local','sales',array['sales'],'active');

do $clock$
declare f text;
begin
 select pg_get_functiondef('public.stockflow_growth_gateway(text,text,text,jsonb)'::regprocedure) into f;
 execute replace(f,'(now() at time zone ''Asia/Kolkata'')::date','''2026-11-26''::date');
end$clock$;

do $fixture$
declare lab text; customer uuid;
begin
 foreach lab in array array['OLD','REP','OVR','DUE','EAR'] loop
  customer:=gen_random_uuid();
  insert into private.stockflow_customers(id,name,city,phone,tally_key,created_by_email)
  values(customer,'New Lab '||lab,'Fixture Town','9876543210','new-labs-'||lab,'fixture');
  insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
  values('new-labs-co',lab,customer,'fixture');
 end loop;
 perform pg_temp.m_line('old-first','OLD','2026-01-10',1000);
 perform pg_temp.m_line('old-recent','OLD','2026-11-10',1000);
 perform pg_temp.m_line('rep-first','REP','2026-10-01',8000);
 perform pg_temp.m_line('rep-second','REP','2026-10-20',2000);
 perform pg_temp.m_line('ovr-only','OVR','2026-10-05',1000);
 perform pg_temp.m_line('due-only','DUE','2026-10-20',2000);
 perform pg_temp.m_line('ear-only','EAR','2026-11-10',3000);
 perform pg_temp.m_line('cancelled','ignored-cancelled','2026-10-01',99999,true);
 perform pg_temp.m_line('negative','ignored-negative','2026-10-01',-99999);
end$fixture$;

do $checks$
declare r jsonb; role_name text;
begin
 r:=private.stockflow_growth_new_labs_read('2026-11-26');
 perform pg_temp.m_assert(r @> '{"filter":"new","windowDays":90,"asOf":"2026-11-26","totalLabs":4,"repeatLabs":1}',
  'header counts include only new positive-sale labs');
 perform pg_temp.m_assert((select jsonb_agg(e->>'labKey' order by n)
  from jsonb_array_elements(r->'rows') with ordinality t(e,n))=
  '["new-labs-co|OVR","new-labs-co|DUE","new-labs-co|EAR","new-labs-co|REP"]'::jsonb,'status ordering');
 perform pg_temp.m_assert(r#>'{rows,0}' @> '{"status":"overdue","daysSinceFirst":52,"orderDays":1,"firstOrderPaise":1000}', 'overdue lab');
 perform pg_temp.m_assert(r#>'{rows,1}' @> '{"status":"due","daysSinceFirst":37,"orderDays":1,"firstOrderPaise":2000}', 'due lab');
 perform pg_temp.m_assert(r#>'{rows,2}' @> '{"status":"early","daysSinceFirst":16,"orderDays":1,"firstOrderPaise":3000}', 'early lab');
 perform pg_temp.m_assert(r#>'{rows,3}' @> '{"status":"repeat","daysSinceFirst":56,"orderDays":2,"firstOrderPaise":8000,"totalPaise":10000,"firstPurchaseOn":"2026-10-01","lastPurchaseOn":"2026-10-20"}', 'repeat lab');
 perform pg_temp.m_assert(r#>'{rows,0}' @> '{"name":"New Lab OVR","town":"Fixture Town","phone":"9876543210"}'
  and r#>>'{rows,0,customerId}' is not null,'customer identity details');
 perform pg_temp.m_assert(public.stockflow_growth_gateway('new-labs-key','new-labs-management@test.local',
  'get_growth_lab_months','{"filter":"new"}')=r,'management dispatch with fixed clock');
 foreach role_name in array array['operations','sales','missing'] loop
  begin
   perform public.stockflow_growth_gateway('new-labs-key','new-labs-'||role_name||'@test.local',
    'get_growth_lab_months','{"filter":"new"}');
   raise exception 'Accepted unauthorized role %',role_name;
  exception when sqlstate 'PT403' then
   perform pg_temp.m_assert(sqlerrm='Growth access required','role rejection message');end;
 end loop;
 begin
  perform public.stockflow_growth_gateway('wrong-key','new-labs-management@test.local','get_growth_lab_months','{"filter":"new"}');
  raise exception 'Accepted wrong gateway key';
 exception when sqlstate '42501' then null;end;
 r:=public.stockflow_growth_gateway('new-labs-key','new-labs-management@test.local','get_growth_lab_months','{"filter":"lapsing"}');
 perform pg_temp.m_assert(r ?& array['window','months'],'lapsing payload delegates unchanged');
 foreach role_name in array array['anon','authenticated','service_role'] loop
  perform pg_temp.m_assert(not has_function_privilege(role_name,'private.stockflow_growth_new_labs_read(date)','execute'),'private ACL '||role_name);
  perform pg_temp.m_assert(not has_function_privilege(role_name,'public.stockflow_growth_gateway_before_new_labs(text,text,text,jsonb)','execute'),'delegate ACL '||role_name);
 end loop;
end$checks$;

rollback;
