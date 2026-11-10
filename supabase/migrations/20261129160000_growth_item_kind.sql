begin;

create table private.stockflow_growth_item_kind_overrides (
 id uuid primary key default extensions.gen_random_uuid(),
 company_id text not null, product_id text not null,
 kind text not null check(kind in ('instrument','consumable','auto')),
 reason text not null check(char_length(btrim(reason)) between 3 and 500),
 actor text not null, recorded_at timestamptz not null default clock_timestamp()
);
create index stockflow_growth_item_kind_overrides_latest
 on private.stockflow_growth_item_kind_overrides(company_id,product_id,recorded_at desc,id desc);
alter table private.stockflow_growth_item_kind_overrides enable row level security;
revoke all on private.stockflow_growth_item_kind_overrides from public,anon,authenticated,service_role;
create trigger stockflow_growth_item_kind_overrides_no_delete
 before delete on private.stockflow_growth_item_kind_overrides
 for each row execute function private.prevent_business_delete();
create trigger stockflow_growth_item_kind_overrides_immutable
 before update on private.stockflow_growth_item_kind_overrides
 for each row execute function private.prevent_immutable_pricing_update();

create function private.stockflow_growth_item_kinds()
returns table(company_id text,product_id text,kind text,source text,average_cost_paise numeric)
language sql stable security definer set search_path=pg_catalog,private as $$
 with latest as (
  select distinct on(v.company_id,v.source_id) v.id,v.company_id,v.source_id,v.kind,v.cancelled
  from private.stockflow_economic_source_vouchers v
  order by v.company_id,v.source_id,v.source_revision desc
 ), purchase_costs as (
  select v.company_id,l.product_id,
   sum(l.net_sales_paise::numeric) filter(where v.kind='purchase' and l.quantity>0 and l.net_sales_paise>0)
    /nullif(sum(l.quantity) filter(where v.kind='purchase' and l.quantity>0 and l.net_sales_paise>0),0) average_cost_paise
  from latest v join private.stockflow_economic_source_lines l on l.voucher_id=v.id
  where not v.cancelled and v.kind in ('purchase','sale')
  group by v.company_id,l.product_id
 ), identities as (
  select distinct v.company_id,l.product_id
  from private.stockflow_economic_source_vouchers v
  join private.stockflow_economic_source_lines l on l.voucher_id=v.id
  where v.kind in ('purchase','sale')
 ), items as (
  select i.company_id,i.product_id,c.average_cost_paise from identities i
  left join purchase_costs c using(company_id,product_id)
 )
 select i.company_id,i.product_id,
  case when o.kind in ('instrument','consumable') then o.kind
   when i.average_cost_paise>=2500000 then 'instrument' else 'consumable' end,
  case when o.kind in ('instrument','consumable') then 'override' else 'auto' end,
  i.average_cost_paise
 from items i left join lateral (
  select o.kind from private.stockflow_growth_item_kind_overrides o
  where o.company_id=i.company_id and o.product_id=i.product_id
  order by o.recorded_at desc,o.id desc limit 1
 ) o on true
$$;

-- Also resolves catalog-only items, including overrides before their first sale.
create function private.stockflow_growth_item_kind(p_company_id text,p_product_id text)
returns table(company_id text,product_id text,kind text,source text,average_cost_paise numeric)
language sql stable security definer set search_path=pg_catalog,private as $$
 select p_company_id,p_product_id,
  case when o.kind in ('instrument','consumable') then o.kind else coalesce(k.kind,'consumable') end,
  case when o.kind in ('instrument','consumable') then 'override' else 'auto' end,k.average_cost_paise
 from (values (1)) seed(n)
 left join private.stockflow_growth_item_kinds() k on k.company_id=p_company_id and k.product_id=p_product_id
 left join lateral (
  select o.kind from private.stockflow_growth_item_kind_overrides o
  where o.company_id=p_company_id and o.product_id=p_product_id
  order by o.recorded_at desc,o.id desc limit 1
 ) o on true
$$;
revoke all on function private.stockflow_growth_item_kinds() from public,anon,authenticated,service_role;
revoke all on function private.stockflow_growth_item_kind(text,text) from public,anon,authenticated,service_role;

-- Fail atomically if an existing function no longer has these exact seams.
do $patch$
declare f text; old_text text; new_text text;
begin
 select replace(pg_get_functiondef('public.stockflow_brand_mapping_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'') into f;
 old_text:=$old$'set_equipment_area','add_brand')$old$;
 new_text:=$new$'set_equipment_area','add_brand','set_item_kind')$new$;
 if (length(f)-length(replace(f,old_text,'')))/length(old_text)<>1 then
  raise exception 'Unexpected item kind gateway anchor 1';end if;
 f:=replace(f,old_text,new_text);
 old_text:=$old$ -- Validate the exact command shape before entering the shared replay path.$old$;
 new_text:=$new$ if p_action='set_item_kind' then
  if not coalesce(private.stockflow_valid_roles(v_roles) and v_roles&&array['administrator','management'],false) then
   raise exception 'Item kind management access required' using errcode='PT403';end if;
  if not p_payload ?& array['requestId','companyId','productId','kind','reason']
   or p_payload-array['requestId','companyId','productId','kind','reason']<>'{}'::jsonb
   or exists(select 1 from jsonb_each(p_payload) field where jsonb_typeof(field.value)<>'string')
   or char_length(btrim(p_payload->>'requestId')) not between 16 and 200
   or char_length(btrim(p_payload->>'companyId')) not between 1 and 240
   or char_length(btrim(p_payload->>'productId')) not between 1 and 240
   or p_payload->>'kind' not in ('instrument','consumable','auto')
   or char_length(btrim(p_payload->>'reason')) not between 3 and 500 then
   raise exception 'Invalid item kind request' using errcode='22023';end if;
  v_key:=p_payload->>'requestId';
  v_replay:=private.begin_stockflow_command(v_actor,p_action,v_key,p_payload);
  if v_replay is not null then return v_replay;end if;
  perform pg_advisory_xact_lock(hashtextextended('growth-item-kind:'||
   jsonb_build_array(p_payload->>'companyId',p_payload->>'productId')::text,0));
  if not exists(
   select 1 from (
    select c.content from private.stockflow_economic_item_catalogs c
    where c.company_id=p_payload->>'companyId' order by c.observed_at desc,c.id desc limit 1
   ) catalog cross join lateral jsonb_array_elements(catalog.content->'products') item
   where item->>'id'=p_payload->>'productId'
  ) then raise exception 'Item must exist in the latest company catalog' using errcode='22023';end if;
  insert into private.stockflow_growth_item_kind_overrides(company_id,product_id,kind,reason,actor)
  values(p_payload->>'companyId',p_payload->>'productId',p_payload->>'kind',btrim(p_payload->>'reason'),v_actor)
  returning id into v_id;
  insert into private.stockflow_economic_audit(action,entity_id,actor,payload)
  values(p_action,v_id,v_actor,p_payload);
  select jsonb_build_object('companyId',k.company_id,'productId',k.product_id,'kind',k.kind,'source',k.source)
  into v_result from private.stockflow_growth_item_kind(p_payload->>'companyId',p_payload->>'productId') k;
  perform private.finish_stockflow_command(v_actor,p_action,v_key,p_payload,v_id,v_result);
  return v_result;
 end if;

 -- Validate the exact command shape before entering the shared replay path.$new$;
 if (length(f)-length(replace(f,old_text,'')))/length(old_text)<>1 then
  raise exception 'Unexpected item kind gateway anchor 2';end if;
 f:=replace(f,old_text,new_text);
 old_text:=$old$  equipment as ($old$;
 new_text:=$new$  -- Brand setup identifies items by name across companies. Resolve that name
  -- against the newest matching current catalog, with deterministic tie breaks.
  latest_catalogs as materialized (
   select distinct on(c.company_id) c.company_id,c.content,c.observed_at,c.id
   from private.stockflow_economic_item_catalogs c order by c.company_id,c.observed_at desc,c.id desc
  ), item_kinds as materialized (select * from private.stockflow_growth_item_kinds()),
  catalog_items as (
   select distinct on(item->>'name') item->>'name' item_key,c.company_id,item->>'id' product_id
   from latest_catalogs c cross join lateral jsonb_array_elements(c.content->'products') item
   where item->>'name' in (select tally_item_key from selected)
   order by item->>'name',c.observed_at desc,c.id desc,c.company_id,item->>'id'
  ), selected_kinds as (
   select s.tally_item_key,c.company_id,c.product_id,
    case when k.average_cost_paise>=2500000 then 'instrument' else 'consumable' end auto_kind,
    case when o.kind in ('instrument','consumable') then o.kind else coalesce(k.kind,'consumable') end item_kind,
    case when o.kind in ('instrument','consumable') then 'override' else 'auto' end kind_source
   from selected s left join catalog_items c on c.item_key=s.tally_item_key
   left join item_kinds k on k.company_id=c.company_id and k.product_id=c.product_id
   left join lateral (
    select o.kind from private.stockflow_growth_item_kind_overrides o
    where o.company_id=c.company_id and o.product_id=c.product_id
    order by o.recorded_at desc,o.id desc limit 1
   ) o on true
  ), equipment as ($new$;
 if (length(f)-length(replace(f,old_text,'')))/length(old_text)<>1 then
  raise exception 'Unexpected item kind gateway anchor 3';end if;
 f:=replace(f,old_text,new_text);
 old_text:=$old$'linkId',id,'kind',kind,'brandCode',brand_code) order by sales_paise desc,name,tally_item_key) from selected)$old$;
 new_text:=$new$'linkId',id,'brandKind',kind,'kind',sk.item_kind,'kindSource',sk.kind_source,'brandCode',brand_code,
    'companyId',sk.company_id,'productId',sk.product_id,'autoKind',sk.auto_kind)
    order by sales_paise desc,name collate "C",tally_item_key collate "C") from selected join selected_kinds sk using(tally_item_key))$new$;
 if (length(f)-length(replace(f,old_text,'')))/length(old_text)<>1 then
  raise exception 'Unexpected item kind gateway anchor 4';end if;
 f:=replace(f,old_text,new_text);
 execute f;
end$patch$;

-- Fail atomically if an existing function no longer has these exact seams.
do $patch$
declare f text; old_text text; new_text text;
begin
 select replace(pg_get_functiondef('private.stockflow_growth_gp(date)'::regprocedure),chr(13),'') into f;
 old_text:=$old$with bounds as ($old$;
 new_text:=$new$with item_kinds as materialized (select * from private.stockflow_growth_item_kinds()),
 item_overrides as (
  select distinct on(company_id,product_id) company_id,product_id,kind
  from private.stockflow_growth_item_kind_overrides order by company_id,product_id,recorded_at desc,id desc
 ), bounds as ($new$;
 if (length(f)-length(replace(f,old_text,'')))/length(old_text)<>1 then
  raise exception 'Unexpected item kind GP anchor 1';end if;
 f:=replace(f,old_text,new_text);
 old_text:=$old$select c.business_date,c.net,$old$;
 new_text:=$new$select c.company_id,c.product_id,c.business_date,c.net,$new$;
 if (length(f)-length(replace(f,old_text,'')))/length(old_text)<>1 then
  raise exception 'Unexpected item kind GP anchor 2';end if;
 f:=replace(f,old_text,new_text);
 old_text:=$old$select business_date,net,bulk,unreliable,case when unreliable then null else cost end cost from checked$old$;
 new_text:=$new$select c.business_date,c.net,c.bulk,c.unreliable,case when c.unreliable then null else c.cost end cost,
  c.bulk or coalesce(nullif(o.kind,'auto'),k.kind,'consumable')='instrument' instrument
 from checked c left join item_kinds k on k.company_id=c.company_id and k.product_id=c.product_id
 left join item_overrides o on o.company_id=c.company_id and o.product_id=c.product_id$new$;
 if (length(f)-length(replace(f,old_text,'')))/length(old_text)<>1 then
  raise exception 'Unexpected item kind GP anchor 3';end if;
 f:=replace(f,old_text,new_text);
 old_text:=$old$('repeat'),('bulk'))$old$;
 new_text:=$new$('repeat'),('bulk'),('consumables'),('instruments'))$new$;
 if (length(f)-length(replace(f,old_text,'')))/length(old_text)<>1 then
  raise exception 'Unexpected item kind GP anchor 4';end if;
 f:=replace(f,old_text,new_text);
 old_text:=$old$or (p.period='repeat' and not c.bulk) or (p.period='bulk' and c.bulk)$old$;
 new_text:=$new$or (p.period='repeat' and not c.bulk) or (p.period='bulk' and c.bulk)
  or (p.period='consumables' and not c.instrument) or (p.period='instruments' and c.instrument)$new$;
 if (length(f)-length(replace(f,old_text,'')))/length(old_text)<>1 then
  raise exception 'Unexpected item kind GP anchor 5';end if;
 f:=replace(f,old_text,new_text);
 old_text:=$old$case when period='window' then jsonb_build_object$old$;
 new_text:=$new$case when period in ('window','consumables','instruments') then jsonb_build_object$new$;
 if (length(f)-length(replace(f,old_text,'')))/length(old_text)<>1 then
  raise exception 'Unexpected item kind GP anchor 6';end if;
 f:=replace(f,old_text,new_text);
 old_text:=$old$-coalesce(sum(c.cost),0)) value$old$;
 new_text:=$new$-coalesce(sum(c.cost),0),
  'consumablesKnownSalesPaise',coalesce(sum(c.net) filter(where not c.instrument and c.cost is not null),0),
  'consumablesGpPaise',coalesce(sum(c.net) filter(where not c.instrument and c.cost is not null),0)
   -coalesce(sum(c.cost) filter(where not c.instrument),0),
  'instrumentsKnownSalesPaise',coalesce(sum(c.net) filter(where c.instrument and c.cost is not null),0),
  'instrumentsGpPaise',coalesce(sum(c.net) filter(where c.instrument and c.cost is not null),0)
   -coalesce(sum(c.cost) filter(where c.instrument),0)) value$new$;
 if (length(f)-length(replace(f,old_text,'')))/length(old_text)<>1 then
  raise exception 'Unexpected item kind GP anchor 7';end if;
 f:=replace(f,old_text,new_text);
 old_text:=$old$'months',(select jsonb_agg(value order by month) from monthly))$old$;
 new_text:=$new$'consumables',(select value from summaries where period='consumables'),
 'instruments',(select value from summaries where period='instruments'),
 'months',(select jsonb_agg(value order by month) from monthly))$new$;
 if (length(f)-length(replace(f,old_text,'')))/length(old_text)<>1 then
  raise exception 'Unexpected item kind GP anchor 8';end if;
 f:=replace(f,old_text,new_text);
 execute f;
end$patch$;

commit;
notify pgrst,'reload schema';

