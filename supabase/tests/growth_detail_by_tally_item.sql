begin;
set local statement_timeout='300s';
set local lock_timeout='60s';

create function pg_temp.m_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Growth detail by Tally item assertion failed: %',label;end if;end$$;

create function pg_temp.m_line(src text,lab text,net bigint) returns void language plpgsql as $$
declare voucher uuid;
begin
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,kind,cancelled,evidence)
 values('detail-co',src,1,'2031-06-10',lab,'sale',false,'{}') returning id into voucher;
 insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
 values(voucher,'1','detail-item',1,'pack',net,'{}');
end$$;

insert into private.stockflow_gateway_config(name,secret_sha256)
values('orders',encode(extensions.digest('detail-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,roles,status)
values('detail-management@test.local','management',array['management'],'active');
do $clock$
declare f text;
begin
 select pg_get_functiondef('public.stockflow_growth_gateway(text,text,text,jsonb)'::regprocedure) into f;
 execute replace(f,'(now() at time zone ''Asia/Kolkata'')::date','''2031-07-15''::date');
end$clock$;

create function pg_temp.m_call(payload jsonb) returns jsonb language sql as $$
 select public.stockflow_growth_gateway('detail-key','detail-management@test.local','get_growth_margin_detail',payload)
$$;

insert into private.stockflow_products(tally_item_key,name,item_group,base_unit)
values('Detail Test Item','Detail Test Item','Detail test group','pack');
insert into private.stockflow_economic_item_catalogs(company_id,source_version,observed_at,content)
values('detail-co','detail-current','2031-07-15','{"products":[{"id":"detail-item","name":"Detail Test Item"}]}');
select pg_temp.m_line('detail-sale-a','lab-a',10000);
select pg_temp.m_line('detail-sale-b','lab-b',12000);

do $checks$
declare by_item jsonb; by_tally jsonb; payload jsonb; role_name text;
begin
 by_item:=pg_temp.m_call('{"itemKey":"detail-co|detail-item|pack","page":1}');
 by_tally:=pg_temp.m_call('{"tallyItemKey":"Detail Test Item","page":1}');
 perform pg_temp.m_assert(by_tally->>'kind'='item' and by_tally->>'itemKey'='detail-co|detail-item|pack'
  and by_tally->'itemKey'=by_item->'itemKey','Tally key resolves the same item');
 perform pg_temp.m_assert(by_tally->'labs'='2'::jsonb and by_tally->'labs'=by_item->'labs'
  and jsonb_array_length(by_tally->'rows')=2 and by_tally->'rows'=by_item->'rows','same labs and lab rows');
 for payload in select value from jsonb_array_elements('[
  {"tallyItemKey":"Detail Test Item","itemKey":"detail-co|detail-item|pack","page":1},
  {"tallyItemKey":"Unknown Test Item","page":1},
  {"tallyItemKey":"","page":1}
 ]'::jsonb) loop
  begin
   perform pg_temp.m_call(payload);
   raise exception 'Accepted invalid detail payload %',payload;
  exception when sqlstate '22023' then null;end;
 end loop;
 foreach role_name in array array['authenticated','service_role'] loop
  perform pg_temp.m_assert(not has_function_privilege(role_name,'private.stockflow_growth_margin_detail(date,jsonb)','execute'),'private ACL '||role_name);
 end loop;
end$checks$;

rollback;
