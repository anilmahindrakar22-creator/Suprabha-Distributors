begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

create function pg_temp.m_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Lab tiers assertion failed: %',label;end if;end$$;
create function pg_temp.m_line(src text,lab text,d date,net bigint,item text default 'consumable',
 kind text default 'sale',revision bigint default 1,cancelled boolean default false) returns void language plpgsql as $$
declare voucher uuid;
begin
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,kind,cancelled,evidence)
 values('lab-tiers-co',src,revision,d,lab,kind,cancelled,'{}') returning id into voucher;
 insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
 values(voucher,'1',item,1,'pack',net,'{}');
end$$;

insert into private.stockflow_gateway_config(name,secret_sha256)
values('orders',encode(extensions.digest('lab-tiers-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,roles,status) values
 ('lab-tiers-management@test.local','management',array['management'],'active'),
 ('lab-tiers-operations@test.local','operations',array['operations'],'active'),
 ('lab-tiers-sales@test.local','sales',array['sales'],'active');
do $clock$
declare f text;
begin
 select pg_get_functiondef('public.stockflow_growth_gateway(text,text,text,jsonb)'::regprocedure) into f;
 execute replace(f,'(now() at time zone ''Asia/Kolkata'')::date','''2026-11-26''::date');
end$clock$;

insert into private.stockflow_economic_item_catalogs(company_id,source_version,observed_at,content)
values('lab-tiers-co','fixture','2026-11-26',
 '{"groups":[],"products":[{"id":"consumable","name":"Consumable"},{"id":"instrument","name":"Instrument"}]}');
insert into private.stockflow_growth_item_kind_overrides(company_id,product_id,kind,reason,actor)
values('lab-tiers-co','instrument','instrument','Lab tiers fixture','fixture');
do $fixture$
declare lab text; customer uuid;
begin
 foreach lab in array array['D','P','G','G2','S','U','X'] loop
  customer:=gen_random_uuid();
  insert into private.stockflow_customers(id,name,city,phone,tally_key,created_by_email)
  values(customer,'Tier Lab '||lab,'Fixture Town','9876543210','lab-tiers-'||lab,'fixture');
  insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
  values('lab-tiers-co',lab,customer,'fixture');
 end loop;
 -- The task's fixture amounts are scaled by ten to match its exact policy thresholds.
 perform pg_temp.m_line('D','D','2026-10-10',120000000);
 perform pg_temp.m_line('P','P','2026-10-10',50000000);
 perform pg_temp.m_line('G','G','2026-10-10',15000000);
 perform pg_temp.m_line('G-instrument','G','2024-01-01',5000000,'instrument');
 perform pg_temp.m_line('G2','G2','2026-10-10',12000000);
 perform pg_temp.m_line('S','S','2026-10-10',5000000);
 perform pg_temp.m_line('U','U','2025-11-01',1000000);
 perform pg_temp.m_line('X','X','2025-10-31',120000000);
 -- Credits and returns subtract even when the source uses positive magnitudes.
 perform pg_temp.m_line('G2-extra','G2','2026-10-10',3000000);
 perform pg_temp.m_line('G2-return','G2','2026-10-10',1000000,'consumable','return');
 perform pg_temp.m_line('G2-credit','G2','2026-10-10',2000000,'consumable','credit');
 perform pg_temp.m_line('future','U','2026-11-01',120000000);
 perform pg_temp.m_line('cancelled','U','2026-10-10',120000000,'consumable','sale',1,true);
 perform pg_temp.m_line('moved','U','2026-10-10',120000000);
 perform pg_temp.m_line('moved','U','2026-12-01',120000000,'consumable','sale',2);
end$fixture$;

do $checks$
declare r jsonb; first_refresh jsonb; role_name text; bad jsonb; snapshot jsonb;
begin
 perform pg_temp.m_assert((select count(*)=6 from private.stockflow_compute_lab_tiers('2026-11-01')
  where company_id='lab-tiers-co'),'only six positive window labs');
 perform pg_temp.m_assert(not exists(
  select 1 from (values ('D','diamond',120000000::numeric,false),('P','platinum',50000000,false),
   ('G','gold',15000000,true),('G2','gold',12000000,false),('S','silver',5000000,false),('U','untiered',1000000,false))
   e(lab,tier,paise,instrument)
  left join private.stockflow_compute_lab_tiers('2026-11-01') t
   on t.company_id='lab-tiers-co' and t.customer_source_id=e.lab
  where t.tier is distinct from e.tier or t.consumables_paise is distinct from e.paise
   or t.has_instrument is distinct from e.instrument),'tiers, net consumables and installed flags');
 r:=private.stockflow_growth_lab_tiers_read('2026-11-26','{}');
 perform pg_temp.m_assert(r->>'stale'='true','compute fallback before refresh');
 first_refresh:=private.stockflow_refresh_lab_tiers('2026-11-26');
 perform pg_temp.m_assert(first_refresh->>'previousMonthSeeded'='true','previous month seeded initially');
 select jsonb_agg(to_jsonb(s) order by company_id,customer_source_id) into snapshot
  from private.stockflow_lab_tier_snapshots s;
 r:=private.stockflow_refresh_lab_tiers('2026-11-26');
 perform pg_temp.m_assert(r->>'previousMonthSeeded'='false','previous month seeded only once');
 perform pg_temp.m_assert(r-'previousMonthSeeded'=first_refresh-'previousMonthSeeded'
  and snapshot=(select jsonb_agg(to_jsonb(s) order by company_id,customer_source_id) from private.stockflow_lab_tier_snapshots s),
  'same-day refresh is idempotent');
 r:=private.stockflow_growth_lab_tiers_read('2026-11-26','{}');
 perform pg_temp.m_assert(r @> '{"month":"2026-11-01","stale":false,"placement":{"labs":2,"consumablesPaise":62000000}}','summary and placement');
 perform pg_temp.m_assert((select jsonb_agg(e->>'tier' order by n) from jsonb_array_elements(r->'tiers') with ordinality t(e,n))
  ='["diamond","platinum","gold","silver","untiered"]'::jsonb,'tier order');
 perform pg_temp.m_assert((select jsonb_agg(e->'labs' order by n) from jsonb_array_elements(r->'tiers') with ordinality t(e,n))
  ='[1,1,2,1,1]'::jsonb,'tier counts');
 perform pg_temp.m_assert(r#>>'{tiers,2,withInstrument}'='1','gold instrument count');
 r:=private.stockflow_growth_lab_tiers_read('2026-11-26','{"list":"placement"}');
 perform pg_temp.m_assert(r->>'totalLabs'='2' and r#>>'{rows,0,labKey}'='lab-tiers-co|P'
  and r#>>'{rows,1,labKey}'='lab-tiers-co|G2','placement order');
 perform pg_temp.m_assert(r#>'{rows,0}' @> '{"name":"Tier Lab P","town":"Fixture Town","phone":"9876543210","previousTier":null,"change":"new"}'
  and r#>>'{rows,0,customerId}' is not null,'identity and new lab details');
 -- October sales do not occur in the previous month's window, so G is absent there.
 insert into private.stockflow_lab_tier_snapshots values('2026-10-01','lab-tiers-co','G','silver',5000000,true,now());
 r:=private.stockflow_growth_lab_tiers_read('2026-11-26','{"list":"movers"}');
 perform pg_temp.m_assert(r->>'totalLabs'='1' and r#>'{rows,0}' @>
  '{"labKey":"lab-tiers-co|G","tier":"gold","previousTier":"silver","change":"up"}','G moved up');
 r:=private.stockflow_growth_lab_tiers_read('2026-11-26','{}');
 perform pg_temp.m_assert(r->'movers'='{"up":1,"down":0}'::jsonb,'mover summary');
 perform pg_temp.m_assert(public.stockflow_growth_gateway('lab-tiers-key','lab-tiers-management@test.local','get_growth_lab_tiers','{}')=r,
  'management gateway');
 r:=private.stockflow_growth_lab_tiers_read('2026-11-26','{"tier":"gold"}');
 perform pg_temp.m_assert(r->>'list'='gold' and r->>'totalLabs'='2','tier list');
 foreach role_name in array array['operations','sales','missing'] loop
  begin
   perform public.stockflow_growth_gateway('lab-tiers-key','lab-tiers-'||role_name||'@test.local','get_growth_lab_tiers','{}');
   raise exception 'Accepted unauthorized role %',role_name;
  exception when sqlstate 'PT403' then null;end;
 end loop;
 begin
  perform public.stockflow_growth_gateway('wrong-key','lab-tiers-management@test.local','get_growth_lab_tiers','{}');
  raise exception 'Accepted wrong key';
 exception when sqlstate '42501' then null;end;
 foreach bad in array array['null'::jsonb,'[]'::jsonb,'"gold"'::jsonb,'{"tier":"bronze"}'::jsonb,
  '{"tier":"gold","list":"placement"}'::jsonb,'{"list":"placement","page":1}'::jsonb,'{"tier":null}'::jsonb] loop
  begin
   perform public.stockflow_growth_gateway('lab-tiers-key','lab-tiers-management@test.local','get_growth_lab_tiers',bad);
   raise exception 'Accepted invalid payload %',bad;
  exception when sqlstate '22023' then
   perform pg_temp.m_assert(sqlerrm='Invalid lab tiers request','bad payload message');end;
 end loop;
 foreach role_name in array array['anon','authenticated','service_role'] loop
  perform pg_temp.m_assert(not has_table_privilege(role_name,'private.stockflow_lab_tier_policies','select,insert,update,delete,truncate,references,trigger'),
   'private policy ACL '||role_name);
  perform pg_temp.m_assert(not has_table_privilege(role_name,'private.stockflow_lab_tier_snapshots','select,insert,update,delete,truncate,references,trigger'),
   'private snapshot ACL '||role_name);
  perform pg_temp.m_assert(not has_function_privilege(role_name,'private.stockflow_compute_lab_tiers(date)','execute')
   and not has_function_privilege(role_name,'private.stockflow_refresh_lab_tiers(date)','execute')
   and not has_function_privilege(role_name,'private.stockflow_growth_lab_tiers_read(date,jsonb)','execute')
   and not has_function_privilege(role_name,'public.stockflow_growth_gateway_before_lab_tiers(text,text,text,jsonb)','execute'),
   'private function ACL '||role_name);
 end loop;
 -- Installation evidence independently sets the flag without a positive instrument sale.
 perform pg_temp.m_line('D-installation','D','2024-01-01',0,'instrument');
 insert into private.stockflow_equipment_installations(customer_id,historical_sale_line_id,installed_on,
  tally_key,item_name,status,scheduled_date,serial_number,created_by_email)
 select i.customer_id,l.id,'2024-01-01','lab-tiers-D-installation','Fixture instrument','completed','2024-01-01','LAB-TIERS-D-SERIAL','fixture'
 from private.stockflow_economic_customer_identities i
 join private.stockflow_economic_source_vouchers v on v.company_id=i.company_id and v.source_id='D-installation'
 join private.stockflow_economic_source_lines l on l.voucher_id=v.id
 where i.company_id='lab-tiers-co' and i.source_id='D';
 perform pg_temp.m_assert((select has_instrument from private.stockflow_compute_lab_tiers('2026-11-01')
  where company_id='lab-tiers-co' and customer_source_id='D'),'completed installation identity fallback');
 begin
  update private.stockflow_lab_tier_policies set reason='must fail';
  raise exception 'Accepted policy mutation';
 exception when raise_exception then
  perform pg_temp.m_assert(sqlerrm='Acknowledgements are append-only','append-only policy');end;
end$checks$;
rollback;
