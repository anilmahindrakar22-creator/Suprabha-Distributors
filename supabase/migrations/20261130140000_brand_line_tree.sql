begin;

-- BL2: brand -> line -> item from the Tally group tree.
-- A brand linked to a top group (principal) applies to its lines and their
-- items; a line link overrides it. Database only; no existing link is changed.

-- Guards: stop unless both functions still have the reviewed production bodies.
do $guard$
declare actual text;
begin
 select md5(replace(p.prosrc,chr(13),'')) into actual from pg_proc p
 where p.oid='private.stockflow_item_brand_map()'::regprocedure;
 if actual is distinct from '6e4f79cb6a071dc36924b1c4e773861b' then
  raise exception 'Unexpected stockflow_item_brand_map body (md5 %)',actual;end if;
 select md5(replace(p.prosrc,chr(13),'')) into actual from pg_proc p
 where p.oid='public.stockflow_brand_mapping_gateway(text,text,text,jsonb)'::regprocedure;
 if actual is distinct from '3e1b4eeddd218c318c9d3d49dee48bde' then
  raise exception 'Unexpected stockflow_brand_mapping_gateway body (md5 %)',actual;end if;
end$guard$;

-- The Tally stock group tree, keyed by group NAME like the brand group links.
-- Source: the latest catalog row overall. There is one company today; a second
-- company needs a company key here and in every caller.
-- A group whose parent is missing from the catalog is a top group. Groups that
-- are caught in a parent cycle (or lie deeper than 64 levels) are never reached
-- from a top group; they are returned as their own top with depth 0.
create function private.stockflow_brand_group_tree()
returns table(group_name text,parent_name text,top_group text,depth int,observed_at timestamptz)
language sql stable security definer set search_path=pg_catalog,private,extensions as $$
 with recursive catalog as (
  select c.content,c.observed_at from private.stockflow_economic_item_catalogs c
  order by c.observed_at desc,c.id desc limit 1
 ), entries as materialized (
  select distinct on(g.entry->>'id') g.entry->>'id' id,g.entry->>'name' name,
   nullif(g.entry->>'parentId','') parent_id,c.observed_at
  from catalog c cross join lateral jsonb_array_elements(
   case when jsonb_typeof(c.content->'groups')='array' then c.content->'groups' else '[]'::jsonb end) g(entry)
  where g.entry->>'id' is not null and g.entry->>'name' is not null
  order by g.entry->>'id',g.entry->>'name'
 ), nodes as materialized (
  select n.id,n.name,p.id parent_id,p.name parent_name,n.observed_at
  from entries n left join entries p on p.id=n.parent_id
 ), walk as (
  select n.id,n.name top_name,0 depth,array[n.id] path from nodes n where n.parent_id is null
  union all
  select n.id,w.top_name,w.depth+1,w.path||n.id from nodes n join walk w on n.parent_id=w.id
  where not n.id=any(w.path) and w.depth<64
 )
 select distinct on(n.name) n.name,n.parent_name,coalesce(w.top_name,n.name),coalesce(w.depth,0),n.observed_at
 from nodes n left join walk w on w.id=n.id
 order by n.name,coalesce(w.depth,0),n.id
$$;
revoke all on function private.stockflow_brand_group_tree() from public,anon,authenticated,service_role;

-- Resolution per product: item link, else the link on its own group, else the
-- nearest ancestor group's link, else unmapped. An explicit none link is
-- mapped: it stops inheritance with a null brand. Groups outside the tree
-- (Primary, or missing from the catalog) have no ancestors and behave as before.
create or replace function private.stockflow_item_brand_map()
returns table(tally_item_key text,brand_code text,source text)
language sql stable security definer set search_path=pg_catalog,private,extensions as $$
 with recursive tree as materialized (
  select t.group_name,t.parent_name,t.depth from private.stockflow_brand_group_tree() t
 ), ancestors as (
  -- Depth falls by one per step, so the walk ends at the top group.
  select t.group_name,t.parent_name ancestor,1 distance from tree t where t.depth>0 and t.parent_name is not null
  union all
  select a.group_name,t.parent_name,a.distance+1 from ancestors a join tree t on t.group_name=a.ancestor
  where t.depth>0 and t.parent_name is not null and a.distance<64
 ), group_links as materialized (
  select distinct on(l.item_group) l.item_group,l.id,l.brand_code from private.stockflow_brand_group_links l
  order by l.item_group,l.recorded_at desc,l.id desc
 ), inherited as materialized (
  select distinct on(a.group_name) a.group_name,l.id,l.brand_code
  from ancestors a join group_links l on l.item_group=a.ancestor
  order by a.group_name,a.distance
 )
 select p.tally_item_key,
  case when i.kind in ('brand','none') then i.brand_code when g.id is not null then g.brand_code else h.brand_code end,
  case when i.kind in ('brand','none') then 'item' when g.id is not null then 'group'
   when h.id is not null then 'inherited' else 'unmapped' end
 from private.stockflow_products p
 left join lateral (select l.id,l.kind,l.brand_code from private.stockflow_brand_item_links l
  where l.tally_item_key=p.tally_item_key order by l.recorded_at desc,l.id desc limit 1) i on true
 left join group_links g on g.item_group=p.item_group
 left join inherited h on h.group_name=p.item_group
$$;
revoke all on function private.stockflow_item_brand_map() from public,anon,authenticated,service_role;

-- Line test area, append-only like the brand links. A null area clears it.
create table private.stockflow_group_area_links (
 id uuid primary key default extensions.gen_random_uuid(), item_group text not null,
 area_code text references private.stockflow_lab_areas(code),
 recorded_by text, recorded_at timestamptz not null default clock_timestamp()
);
create index stockflow_group_area_links_latest on private.stockflow_group_area_links(item_group,recorded_at desc,id desc);
alter table private.stockflow_group_area_links enable row level security;
revoke all on private.stockflow_group_area_links from public,anon,authenticated,service_role;
create trigger stockflow_group_area_links_no_delete before delete on private.stockflow_group_area_links
 for each row execute function private.prevent_business_delete();
create trigger stockflow_group_area_links_immutable before update on private.stockflow_group_area_links
 for each row execute function private.prevent_immutable_pricing_update();

-- Exact-text seam helper: every seam must match exactly once or the migration stops.
create function pg_temp.stockflow_brand_line_seam(definition text,old_text text,new_text text,seam_label text) returns text
language plpgsql as $$
declare occurrences integer; old_clean text:=replace(old_text,chr(13),'');
begin
 occurrences:=(length(definition)-length(replace(definition,old_clean,'')))/length(old_clean);
 if occurrences<>1 then raise exception 'Unexpected brand line gateway seam % (% matches)',seam_label,occurrences;end if;
 return replace(definition,old_clean,replace(new_text,chr(13),''));
end$$;

do $patch$
declare f text;
begin
 f:=replace(pg_get_functiondef('public.stockflow_brand_mapping_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'');

 -- a. supported actions
 f:=pg_temp.stockflow_brand_line_seam(f,
  $old$'set_equipment_area','add_brand','set_item_kind')$old$,
  $new$'set_equipment_area','add_brand','set_item_kind','set_group_area')$new$,
  'a action list');

 -- b. exact payload shape {group, expectedLinkId, areaCode, idempotencyKey}
 f:=pg_temp.stockflow_brand_line_seam(f,
  $old$   v_target:=p_payload->>'group';
  else
$old$,
  $new$   v_target:=p_payload->>'group';
  elsif p_action='set_group_area' then
   if p_payload-array['group','expectedLinkId','areaCode','idempotencyKey']<>'{}'::jsonb
    or jsonb_typeof(p_payload->'group') is distinct from 'string' or btrim(p_payload->>'group')=''
    or not (p_payload ? 'areaCode') or jsonb_typeof(p_payload->'areaCode') not in ('string','null') then
    raise exception 'Invalid group area mapping' using errcode='22023';end if;
   v_target:=p_payload->>'group';
  else
$new$,
  'b payload shape');
 f:=pg_temp.stockflow_brand_line_seam(f,
  $old$  elsif p_action='set_equipment_area' then v_code:=p_payload->>'areaCode';end if;$old$,
  $new$  elsif p_action in ('set_equipment_area','set_group_area') then v_code:=p_payload->>'areaCode';end if;$new$,
  'b area code');

 -- c. target: a group in the Tally tree or on a product; a non-null area must be active
 f:=pg_temp.stockflow_brand_line_seam(f,
  $old$  elsif p_action='set_item_brand' then
   perform 1 from private.stockflow_products where tally_item_key=v_target and active for share;$old$,
  $new$  elsif p_action='set_group_area' then
   if not exists(select 1 from private.stockflow_brand_group_tree() t where t.group_name=v_target)
    and not exists(select 1 from private.stockflow_products where item_group=v_target) then
    raise exception 'Existing stock group required' using errcode='22023';end if;
  elsif p_action='set_item_brand' then
   perform 1 from private.stockflow_products where tally_item_key=v_target and active for share;$new$,
  'c target');
 f:=pg_temp.stockflow_brand_line_seam(f,
  $old$   if p_action='set_equipment_area' then
    perform 1 from private.stockflow_lab_areas where code=v_code and active for share;$old$,
  $new$   if p_action in ('set_equipment_area','set_group_area') then
    perform 1 from private.stockflow_lab_areas where code=v_code and active for share;$new$,
  'c active area');

 -- d. expected link against the latest group area row, then append.
 -- The advisory lock key is already 'stockflow-brand-mapping:'||p_action||':'||v_target.
 f:=pg_temp.stockflow_brand_line_seam(f,
  $old$  else
   select id into v_current from private.stockflow_equipment_area_links where tally_item_key=v_target order by recorded_at desc,id desc limit 1;$old$,
  $new$  elsif p_action='set_group_area' then
   select id into v_current from private.stockflow_group_area_links where item_group=v_target order by recorded_at desc,id desc limit 1;
  else
   select id into v_current from private.stockflow_equipment_area_links where tally_item_key=v_target order by recorded_at desc,id desc limit 1;$new$,
  'd current link');
 f:=pg_temp.stockflow_brand_line_seam(f,
  $old$  else
   insert into private.stockflow_equipment_area_links(tally_item_key,area_code,recorded_by) values(v_target,v_code,v_actor) returning id into v_id;$old$,
  $new$  elsif p_action='set_group_area' then
   insert into private.stockflow_group_area_links(item_group,area_code,recorded_by) values(v_target,v_code,v_actor) returning id into v_id;
  else
   insert into private.stockflow_equipment_area_links(tally_item_key,area_code,recorded_by) values(v_target,v_code,v_actor) returning id into v_id;$new$,
  'd insert');

 -- e. get_brand_mapping: the group tree with own and inherited brand, and line areas
 f:=pg_temp.stockflow_brand_line_seam(f,
  $old$  with sales as materialized ($old$,
  $new$  with recursive sales as materialized ($new$,
  'e recursive');
 f:=pg_temp.stockflow_brand_line_seam(f,
  $old$  ), mapped_sales as ($old$,
  $new$  ), tree as materialized (select * from private.stockflow_brand_group_tree()),
  tree_ancestors as (
   select t.group_name,t.parent_name ancestor,1 distance from tree t where t.depth>0 and t.parent_name is not null
   union all
   select a.group_name,t.parent_name,a.distance+1 from tree_ancestors a join tree t on t.group_name=a.ancestor
   where t.depth>0 and t.parent_name is not null and a.distance<64
  ), tree_inherited as (
   select distinct on(a.group_name) a.group_name,l.brand_code
   from tree_ancestors a join group_links l on l.item_group=a.ancestor order by a.group_name,a.distance
  ), group_area_links as (
   select distinct on(item_group) * from private.stockflow_group_area_links order by item_group,recorded_at desc,id desc
  ), tree_rows as (
   select t.group_name,t.parent_name,t.top_group,t.depth,coalesce(g.items,0) items,coalesce(g.sales_paise,0) sales_paise
   from tree t left join groups g on g.item_group=t.group_name
  ), tree_top_sales as (
   -- A top group is ordered by the sales of its whole subtree.
   select r.top_group,sum(r.sales_paise) sales_paise from tree_rows r group by r.top_group
  ), mapped_sales as ($new$,
  'e tree read');
 f:=pg_temp.stockflow_brand_line_seam(f,
  $old$   'totalSalesPaise',(select coalesce(sum(sales_paise),0) from sales)) into v_result;$old$,
  $new$   'totalSalesPaise',(select coalesce(sum(sales_paise),0) from sales),
   'catalogObservedAt',(select max(t.observed_at) from tree t),
   'tree',coalesce((select jsonb_agg(jsonb_build_object('group',r.group_name,'parent',r.parent_name,'top',r.top_group,'depth',r.depth,
    'items',r.items,'salesPaise',r.sales_paise,'linkId',l.id,'kind',l.kind,'brandCode',l.brand_code,
    'inheritedBrandCode',case when l.id is null then h.brand_code end,'areaLinkId',a.id,'areaCode',a.area_code)
    order by ts.sales_paise desc,r.top_group collate "C",r.depth,r.group_name collate "C")
    from tree_rows r join tree_top_sales ts on ts.top_group=r.top_group
    left join group_links l on l.item_group=r.group_name
    left join tree_inherited h on h.group_name=r.group_name
    left join group_area_links a on a.item_group=r.group_name),'[]'::jsonb)) into v_result;$new$,
  'e tree output');
 execute f;
end$patch$;

-- f. access is unchanged: the service role only.
revoke all on function public.stockflow_brand_mapping_gateway(text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.stockflow_brand_mapping_gateway(text,text,text,jsonb) to service_role;

commit;
notify pgrst,'reload schema';
