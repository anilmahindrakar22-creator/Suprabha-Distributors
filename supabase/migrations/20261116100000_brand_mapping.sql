begin;

create table private.stockflow_brands (
 code text primary key,
 name text not null unique,
 active boolean not null default true,
 created_by text, created_at timestamptz not null default clock_timestamp(),
 constraint stockflow_brands_code_rule check (code ~ '^[A-Z][A-Z0-9_]{1,39}$')
);
insert into private.stockflow_brands(code,name,created_by) values
 ('NIHON_KOHDEN','Nihon Kohden','system'),('SYSMEX','Sysmex','system'),('ARKRAY','Arkray','system'),
 ('TULIP','Tulip','system'),('J_MITRA','J Mitra','system'),('DIASYS','DiaSys','system'),
 ('BIOMERIEUX','bioMérieux','system'),('MERIL','Meril','system'),('AGAPPE','Agappe','system');
create table private.stockflow_brand_areas (
 brand_code text references private.stockflow_brands(code),
 area_code text references private.stockflow_lab_areas(code),
 primary key (brand_code,area_code)
);
insert into private.stockflow_brand_areas(brand_code,area_code) values
 ('NIHON_KOHDEN','HAEM'),('SYSMEX','HAEM'),('SYSMEX','URINE'),('SYSMEX','COAG'),
 ('ARKRAY','URINE'),('TULIP','COAG'),('TULIP','RAPID'),('J_MITRA','RAPID'),
 ('DIASYS','BIOCHEM'),('DIASYS','IMMUNO'),('MERIL','BIOCHEM'),('MERIL','IMMUNO'),
 ('AGAPPE','BIOCHEM'),('BIOMERIEUX','IMMUNO'),('BIOMERIEUX','CULTURE');

create table private.stockflow_brand_group_links (
 id uuid primary key default extensions.gen_random_uuid(), item_group text not null,
 kind text not null, brand_code text references private.stockflow_brands(code),
 recorded_by text, recorded_at timestamptz not null default clock_timestamp(),
 constraint stockflow_brand_group_links_kind_rule check (
  (kind='brand' and brand_code is not null) or (kind='none' and brand_code is null))
);
create index stockflow_brand_group_links_latest on private.stockflow_brand_group_links(item_group,recorded_at desc,id desc);
create table private.stockflow_brand_item_links (
 id uuid primary key default extensions.gen_random_uuid(), tally_item_key text not null,
 kind text not null, brand_code text references private.stockflow_brands(code),
 recorded_by text, recorded_at timestamptz not null default clock_timestamp(),
 constraint stockflow_brand_item_links_kind_rule check (
  (kind='brand' and brand_code is not null) or (kind in ('none','inherit') and brand_code is null))
);
create index stockflow_brand_item_links_latest on private.stockflow_brand_item_links(tally_item_key,recorded_at desc,id desc);
create table private.stockflow_equipment_area_links (
 id uuid primary key default extensions.gen_random_uuid(), tally_item_key text not null,
 area_code text references private.stockflow_lab_areas(code),
 recorded_by text, recorded_at timestamptz not null default clock_timestamp()
);
create index stockflow_equipment_area_links_latest on private.stockflow_equipment_area_links(tally_item_key,recorded_at desc,id desc);

do $protect$
declare v_table text;
begin
 foreach v_table in array array['stockflow_brands','stockflow_brand_areas','stockflow_brand_group_links',
  'stockflow_brand_item_links','stockflow_equipment_area_links'] loop
  execute format('alter table private.%I enable row level security',v_table);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role',v_table);
  execute format('create trigger %I before delete on private.%I for each row execute function private.prevent_business_delete()',v_table||'_no_delete',v_table);
  execute format('create trigger %I before update on private.%I for each row execute function private.prevent_immutable_pricing_update()',v_table||'_immutable',v_table);
 end loop;
end $protect$;

-- P4 consumes all products, including historical/inactive products with sales.
create function private.stockflow_item_brand_map()
returns table(tally_item_key text,brand_code text,source text)
language sql stable security definer set search_path=pg_catalog,private,extensions as $$
 select p.tally_item_key,
  case when i.kind in ('brand','none') then i.brand_code else g.brand_code end,
  case when i.kind in ('brand','none') then 'item' when g.id is not null then 'group' else 'unmapped' end
 from private.stockflow_products p
 left join lateral (select l.id,l.kind,l.brand_code from private.stockflow_brand_item_links l
  where l.tally_item_key=p.tally_item_key order by l.recorded_at desc,l.id desc limit 1) i on true
 left join lateral (select l.id,l.brand_code from private.stockflow_brand_group_links l
  where l.item_group=p.item_group order by l.recorded_at desc,l.id desc limit 1) g on true
$$;
revoke all on function private.stockflow_item_brand_map() from public,anon,authenticated,service_role;

-- Select the latest revision before applying cancellation, kind or date filters.
-- Tally product_id is a GUID; evidence.label is the product master join key.
create function private.stockflow_brand_sales_180(p_today date)
returns table(tally_item_key text,sales_paise numeric,lines bigint)
language sql stable security definer set search_path=pg_catalog,private,extensions as $$
 with latest as (
  select distinct on(v.company_id,v.source_id) v.* from private.stockflow_economic_source_vouchers v
  order by v.company_id,v.source_id,v.source_revision desc
 )
 select p.tally_item_key,sum(l.net_sales_paise::numeric),count(*)
 from latest v join private.stockflow_economic_source_lines l on l.voucher_id=v.id
 join private.stockflow_products p on l.evidence->>'label'=p.tally_item_key
 where not v.cancelled and v.kind in ('sale','return','credit')
  and v.business_date>=p_today-180 and v.business_date<p_today+1
 group by p.tally_item_key
$$;
revoke all on function private.stockflow_brand_sales_180(date) from public,anon,authenticated,service_role;

create function public.stockflow_brand_mapping_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private,extensions as $$
declare
 v_actor text:=lower(btrim(p_actor_email)); v_roles text[]; v_hash text;
 v_today date:=(now() at time zone 'Asia/Kolkata')::date;
 v_page numeric:=1; v_query text:=''; v_key text; v_target text; v_code text; v_kind text; v_name text;
 v_expected uuid; v_current uuid; v_id uuid; v_result jsonb; v_replay jsonb;
 v_uuid_pattern constant text:='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
 select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
 if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_hash then
  raise exception 'Unauthorized gateway' using errcode='42501';end if;
 select roles into v_roles from public.stockflow_members where email=v_actor and status='active';
 if not coalesce(private.stockflow_valid_roles(v_roles) and v_roles&&array['administrator','management'],false) then
  raise exception 'Brand mapping access required' using errcode='PT403';end if;
 if p_action is null or p_action not in ('get_brand_mapping','set_group_brand','set_item_brand','set_equipment_area','add_brand') then
  raise exception 'Unsupported brand mapping action' using errcode='22023';end if;
 if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid brand mapping request' using errcode='22023';end if;

 if p_action='get_brand_mapping' then
  if p_payload-array['q','page']<>'{}'::jsonb
   or (p_payload ? 'q' and (jsonb_typeof(p_payload->'q') is distinct from 'string' or char_length(p_payload->>'q')>120))
   or (p_payload ? 'page' and jsonb_typeof(p_payload->'page') is distinct from 'number') then
   raise exception 'Invalid brand mapping query' using errcode='22023';end if;
  v_page:=coalesce((p_payload->>'page')::numeric,1);v_query:=coalesce(p_payload->>'q','');
  if v_page<>trunc(v_page) or v_page not between 1 and 4000 then raise exception 'Invalid brand mapping page' using errcode='22023';end if;
  with sales as materialized (select * from private.stockflow_brand_sales_180(v_today)),
  group_links as materialized (
   select distinct on(item_group) * from private.stockflow_brand_group_links order by item_group,recorded_at desc,id desc
  ), item_links as materialized (
   select distinct on(tally_item_key) * from private.stockflow_brand_item_links order by tally_item_key,recorded_at desc,id desc
  ), equipment_links as (
   select distinct on(tally_item_key) * from private.stockflow_equipment_area_links order by tally_item_key,recorded_at desc,id desc
  ), groups as (
   select p.item_group,btrim(regexp_replace(p.item_group,'[[:cntrl:]]','','g')) label,
    count(*) items,coalesce(sum(s.sales_paise),0) sales_paise
   from private.stockflow_products p left join sales s on s.tally_item_key=p.tally_item_key
   where p.active group by p.item_group
  ), candidates as materialized (
   select p.tally_item_key,p.name,btrim(regexp_replace(p.item_group,'[[:cntrl:]]','','g')) label,
    coalesce(s.sales_paise,0) sales_paise,i.id,i.kind,i.brand_code
   from private.stockflow_products p left join group_links g on g.item_group=p.item_group
   left join sales s on s.tally_item_key=p.tally_item_key left join item_links i on i.tally_item_key=p.tally_item_key
   where p.active and (g.id is null or p.item_group=E'\u0004 Primary') and p.name ilike '%'||v_query||'%'
  ), selected as (select * from candidates order by sales_paise desc,name,tally_item_key limit 20 offset (v_page::integer-1)*20),
  equipment as (
   select e.tally_key,coalesce(p.name,min(e.item_name)) name,count(*) installs
   from private.stockflow_equipment_installations e left join private.stockflow_products p on p.tally_item_key=e.tally_key
   group by e.tally_key,p.name
  ), mapped_sales as (
   select s.sales_paise,m.source from sales s join private.stockflow_item_brand_map() m using(tally_item_key)
  )
  select jsonb_build_object(
   'brands',coalesce((select jsonb_agg(jsonb_build_object('code',b.code,'name',b.name,'areas',
    coalesce((select jsonb_agg(a.area_code order by a.area_code) from private.stockflow_brand_areas a where a.brand_code=b.code),'[]'::jsonb)) order by b.name,b.code)
    from private.stockflow_brands b where b.active),'[]'::jsonb),
   'groups',coalesce((select jsonb_agg(jsonb_build_object('group',g.item_group,'label',g.label,'items',g.items,'salesPaise',g.sales_paise,
    'linkId',l.id,'kind',l.kind,'brandCode',l.brand_code) order by g.sales_paise desc,g.label,g.item_group)
    from groups g left join group_links l on l.item_group=g.item_group),'[]'::jsonb),
   'items',coalesce((select jsonb_agg(jsonb_build_object('itemKey',tally_item_key,'name',name,'group',label,'salesPaise',sales_paise,
    'linkId',id,'kind',kind,'brandCode',brand_code) order by sales_paise desc,name,tally_item_key) from selected),'[]'::jsonb),
   'total',(select count(*) from candidates),'page',v_page,
   'equipment',coalesce((select jsonb_agg(jsonb_build_object('itemKey',e.tally_key,'name',e.name,'installs',e.installs,
    'linkId',l.id,'areaCode',l.area_code) order by e.name,e.tally_key)
    from equipment e left join equipment_links l on l.tally_item_key=e.tally_key),'[]'::jsonb),
   'unmappedSalesPaise',(select coalesce(sum(sales_paise) filter(where source='unmapped'),0) from mapped_sales),
   'totalSalesPaise',(select coalesce(sum(sales_paise),0) from sales)) into v_result;
  return v_result;
 end if;

 -- Validate the exact command shape before entering the shared replay path.
 v_key:=p_payload->>'idempotencyKey';
 if jsonb_typeof(p_payload->'idempotencyKey') is distinct from 'string' or char_length(btrim(v_key))<16 or char_length(v_key)>200 then
  raise exception 'A valid idempotency key is required' using errcode='22023';end if;
 if p_action='add_brand' then
  if p_payload-array['name','idempotencyKey']<>'{}'::jsonb or jsonb_typeof(p_payload->'name') is distinct from 'string'
   or char_length(btrim(p_payload->>'name')) not between 2 and 60 then
   raise exception 'Brand name must have 2 to 60 characters' using errcode='22023';end if;
  v_name:=btrim(p_payload->>'name');
  v_code:=left(btrim(regexp_replace(upper(v_name),'[^A-Z0-9]+','_','g'),'_'),40);
  if v_code !~ '^[A-Z][A-Z0-9_]{1,39}$' then raise exception 'Brand name must produce a valid brand code' using errcode='22023';end if;
 else
  if not (p_payload ? 'expectedLinkId') or (p_payload->'expectedLinkId'<>'null'::jsonb and
   (jsonb_typeof(p_payload->'expectedLinkId') is distinct from 'string' or (p_payload->>'expectedLinkId') !~* v_uuid_pattern)) then
   raise exception 'Expected link ID must be a UUID or null' using errcode='22023';end if;
  v_expected:=(p_payload->>'expectedLinkId')::uuid;
  if p_action='set_group_brand' then
   if p_payload-array['group','expectedLinkId','brandCode','idempotencyKey']<>'{}'::jsonb or jsonb_typeof(p_payload->'group') is distinct from 'string' then
    raise exception 'Invalid group mapping' using errcode='22023';end if;
   v_target:=p_payload->>'group';
  else
   if jsonb_typeof(p_payload->'itemKey') is distinct from 'string' or btrim(p_payload->>'itemKey')='' then
    raise exception 'Item key required' using errcode='22023';end if;
   v_target:=p_payload->>'itemKey';
   if p_action='set_item_brand' then
    if p_payload ? 'clear' then
     if p_payload-array['itemKey','expectedLinkId','clear','idempotencyKey']<>'{}'::jsonb or p_payload->'clear' is distinct from 'true'::jsonb then
      raise exception 'Invalid item clear request' using errcode='22023';end if;
     v_kind:='inherit';
    elsif p_payload-array['itemKey','expectedLinkId','brandCode','idempotencyKey']<>'{}'::jsonb then
     raise exception 'Invalid item mapping' using errcode='22023';end if;
   elsif p_payload-array['itemKey','expectedLinkId','areaCode','idempotencyKey']<>'{}'::jsonb
    or not (p_payload ? 'areaCode') or jsonb_typeof(p_payload->'areaCode') not in ('string','null') then
    raise exception 'Invalid equipment mapping' using errcode='22023';end if;
  end if;
  if p_action in ('set_group_brand','set_item_brand') and v_kind is distinct from 'inherit' then
   if not (p_payload ? 'brandCode') or jsonb_typeof(p_payload->'brandCode') not in ('string','null') then
    raise exception 'Brand code must be a string or null' using errcode='22023';end if;
   v_code:=p_payload->>'brandCode';v_kind:=case when v_code is null then 'none' else 'brand' end;
  elsif p_action='set_equipment_area' then v_code:=p_payload->>'areaCode';end if;
 end if;
 v_replay:=private.begin_stockflow_command(v_actor,p_action,v_key,p_payload);
 if v_replay is not null then return v_replay;end if;

 if p_action='add_brand' then
  begin
   insert into private.stockflow_brands(code,name,created_by) values(v_code,v_name,v_actor);
  exception when unique_violation then raise exception 'Brand already exists' using errcode='PT409';end;
  v_result:=jsonb_build_object('ok',true,'code',v_code);
 else
  -- A per-key transaction lock also serializes the first append, where no row exists.
  perform pg_advisory_xact_lock(hashtextextended('stockflow-brand-mapping:'||p_action||':'||v_target,0));
  if p_action='set_group_brand' then
   if not exists(select 1 from private.stockflow_products where item_group=v_target) then
    raise exception 'Existing stock group required' using errcode='22023';end if;
  elsif p_action='set_item_brand' then
   perform 1 from private.stockflow_products where tally_item_key=v_target and active for share;
   if not found then raise exception 'Active item required' using errcode='22023';end if;
  elsif not exists(select 1 from private.stockflow_equipment_installations where tally_key=v_target) then
   raise exception 'Installed equipment item required' using errcode='22023';end if;
  if v_code is not null then
   if p_action='set_equipment_area' then
    perform 1 from private.stockflow_lab_areas where code=v_code and active for share;
    if not found then raise exception 'Active testing area required' using errcode='22023';end if;
   else
    perform 1 from private.stockflow_brands where code=v_code and active for share;
    if not found then raise exception 'Active brand required' using errcode='22023';end if;
   end if;
  end if;
  if p_action='set_group_brand' then
   select id into v_current from private.stockflow_brand_group_links where item_group=v_target order by recorded_at desc,id desc limit 1;
  elsif p_action='set_item_brand' then
   select id into v_current from private.stockflow_brand_item_links where tally_item_key=v_target order by recorded_at desc,id desc limit 1;
  else
   select id into v_current from private.stockflow_equipment_area_links where tally_item_key=v_target order by recorded_at desc,id desc limit 1;
  end if;
  if v_expected is distinct from v_current then raise exception 'Mapping changed; reload' using errcode='PT409';end if;
  if p_action='set_group_brand' then
   insert into private.stockflow_brand_group_links(item_group,kind,brand_code,recorded_by) values(v_target,v_kind,v_code,v_actor) returning id into v_id;
  elsif p_action='set_item_brand' then
   insert into private.stockflow_brand_item_links(tally_item_key,kind,brand_code,recorded_by) values(v_target,v_kind,v_code,v_actor) returning id into v_id;
  else
   insert into private.stockflow_equipment_area_links(tally_item_key,area_code,recorded_by) values(v_target,v_code,v_actor) returning id into v_id;
  end if;
  v_result:=jsonb_build_object('ok',true,'linkId',v_id);
 end if;
 perform private.finish_stockflow_command(v_actor,p_action,v_key,p_payload,v_id,v_result);
 return v_result;
end $$;
revoke all on function public.stockflow_brand_mapping_gateway(text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.stockflow_brand_mapping_gateway(text,text,text,jsonb) to service_role;

commit;
