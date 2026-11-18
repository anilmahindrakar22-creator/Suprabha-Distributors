begin;
set local statement_timeout='300s';
set local lock_timeout='60s';

create function pg_temp.m_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Growth target margin lift assertion failed: %',label;end if;end$$;

create function pg_temp.m_line(src text,lab text,net bigint) returns void language plpgsql as $$
declare voucher uuid;
begin
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,kind,cancelled,evidence)
 values('lift-co',src,1,'2031-06-10',lab,'sale',false,'{}') returning id into voucher;
 insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
 values(voucher,'1','lift-item',1,'pack',net,'{}');
end$$;

insert into private.stockflow_gateway_config(name,secret_sha256)
values('orders',encode(extensions.digest('lift-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,roles,status)
values('lift-management@test.local','management',array['management'],'active');
do $clock$
declare f text;
begin
 select pg_get_functiondef('public.stockflow_growth_gateway(text,text,text,jsonb)'::regprocedure) into f;
 execute replace(f,'(now() at time zone ''Asia/Kolkata'')::date','''2031-07-15''::date');
end$clock$;

create function pg_temp.m_call() returns jsonb language sql as $$
 select public.stockflow_growth_gateway('lift-key','lift-management@test.local','get_growth_margin_detail',
  '{"itemKey":"lift-co|lift-item|pack","page":1}')
$$;

-- Supersede overlapping policies only within this rolled-back transaction.
update private.stockflow_pricing_policies set active=false
where active and effective_from<='2031-07-15' and (effective_to is null or effective_to>='2031-07-15');
insert into private.stockflow_pricing_policies(policy_version,minimum_margin_percent,target_margin_percent,
 override_approval_percent,rounding_increment,rounding_rule_version,effective_from,effective_to,created_by_email)
values('lift-target-v1',25,30,0,1,'lift-round-v1','2031-07-15','2031-07-15','fixture');

-- Pricing cost evidence needs just one purchase-cost row, independently of Growth sales.
do $fixture$
declare customer uuid:=gen_random_uuid();
begin
 insert into private.stockflow_products(tally_item_key,name,item_group,base_unit)
 values('Lift Test Item','Lift Test Item','Lift test group','pack');
 insert into private.stockflow_economic_item_catalogs(company_id,source_version,observed_at,content)
 values('lift-co','lift-current','2031-07-15','{"products":[{"id":"lift-item","name":"Lift Test Item"}]}');
 insert into private.stockflow_customers(id,name,tally_key,created_by_email)
 values(customer,'Test Lab A','lift-lab-a','fixture');
 insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
 values('lift-co','lab-a',customer,'fixture');
 insert into private.stockflow_tally_purchase_costs(tally_item_key,cost_amount,cost_kind,effective_at,source_reference,source_id,source_version)
 values('Lift Test Item',80,'purchase_price','2031-06-01','lift-purchase','lift-purchase','lift-current');
 perform pg_temp.m_line('lift-sale-a','lab-a',10000);
 perform pg_temp.m_line('lift-sale-b','lab-b',10000);
end$fixture$;

do $checks$
declare r jsonb; entry jsonb; price jsonb; role_name text;
begin
 r:=pg_temp.m_call();
 perform pg_temp.m_assert(r->'pricePolicy'='{"minimumMarginPct":25,"targetMarginPct":30}'::jsonb,'active policy');
 perform pg_temp.m_assert(jsonb_array_length(r->'rows')=2,'both lab rows returned');
 for entry in select value from jsonb_array_elements(r->'rows') loop
  perform pg_temp.m_assert(entry ?& array['liftToPricePaise','minimumPricePaise','belowMinimum','belowTarget'],'lift keys on every lab');
 end loop;
 select value into entry from jsonb_array_elements(r->'rows') where value->>'labKey'='lift-co|lab-a';
 price:=private.stockflow_customer_price((entry->>'customerId')::uuid,'Lift Test Item','2031-07-15');
 perform pg_temp.m_assert((price#>>'{suggestion,amount}')::numeric>0
  and (entry->>'liftToPricePaise')::numeric=(price#>>'{suggestion,amount}')::numeric*100,'lift equals pricing suggestion in paise');
 perform pg_temp.m_assert(entry->'minimumPricePaise'='10700'::jsonb
  and entry->'belowMinimum'='true'::jsonb and entry->'belowTarget'='true'::jsonb,'known cost minimum and target flags');
 select value into entry from jsonb_array_elements(r->'rows') where value->>'labKey'='lift-co|lab-b';
 perform pg_temp.m_assert(entry->'liftToPricePaise'='null'::jsonb and entry->'minimumPricePaise'='null'::jsonb
  and entry->'belowMinimum'='null'::jsonb and entry->'belowTarget'='null'::jsonb,'unlinked lab has no cost evidence');
 foreach role_name in array array['authenticated','service_role'] loop
  perform pg_temp.m_assert(not has_function_privilege(role_name,'private.stockflow_growth_margin_detail(date,jsonb)','execute'),'private ACL '||role_name);
 end loop;
end$checks$;

update private.stockflow_pricing_policies set active=false where policy_version='lift-target-v1';
insert into private.stockflow_pricing_policies(policy_version,minimum_margin_percent,target_margin_percent,
 override_approval_percent,rounding_increment,rounding_rule_version,effective_from,effective_to,created_by_email)
values('lift-no-target-v2',25,null,0,1,'lift-round-v1','2031-07-15','2031-07-15','fixture');

do $no_target$
declare r jsonb;
begin
 r:=pg_temp.m_call();
 perform pg_temp.m_assert(r->'pricePolicy'='{"minimumMarginPct":25,"targetMarginPct":null}'::jsonb,'null target policy');
 perform pg_temp.m_assert(jsonb_array_length(r->'rows')=2 and not exists(
  select 1 from jsonb_array_elements(r->'rows') e where e->>'liftToPricePaise' is not null),'null target disables every lift');
end$no_target$;

rollback;
