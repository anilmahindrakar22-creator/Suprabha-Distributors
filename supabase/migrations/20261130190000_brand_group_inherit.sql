begin;

-- BG: clear an own group link while retaining append-only history.
do $guard$
declare actual text;
begin
 select md5(replace(p.prosrc,chr(13),'')) into actual from pg_proc p
 where p.oid='private.stockflow_item_brand_map()'::regprocedure;
 if actual is distinct from 'cb13904f786d0492324e27def7eef2f0' then
  raise exception 'Unexpected stockflow_item_brand_map body (md5 %)',actual;end if;
 select md5(replace(p.prosrc,chr(13),'')) into actual from pg_proc p
 where p.oid='public.stockflow_brand_mapping_gateway(text,text,text,jsonb)'::regprocedure;
 if actual is distinct from 'e419f68984533e8ba95dcc37630fc3f5' then
  raise exception 'Unexpected stockflow_brand_mapping_gateway body (md5 %)',actual;end if;
end$guard$;

alter table private.stockflow_brand_group_links
 drop constraint stockflow_brand_group_links_kind_rule,
 add constraint stockflow_brand_group_links_kind_rule check (
  (kind='brand' and brand_code is not null) or (kind in ('none','inherit') and brand_code is null));

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
  select * from (
   select distinct on(l.item_group) l.item_group,l.id,l.kind,l.brand_code from private.stockflow_brand_group_links l
   order by l.item_group,l.recorded_at desc,l.id desc
  ) latest where latest.kind<>'inherit'
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

-- Require every reviewed gateway seam to occur exactly once.
create function pg_temp.stockflow_group_inherit_seam(definition text,old_text text,new_text text,seam_label text) returns text
language plpgsql as $$
declare occurrences integer;
begin
 occurrences:=(length(definition)-length(replace(definition,old_text,'')))/length(old_text);
 if occurrences<>1 then raise exception 'Unexpected group inherit seam % (% matches)',seam_label,occurrences;end if;
 return replace(definition,old_text,new_text);
end$$;

do $patch$
declare f text;
begin
 f:=replace(pg_get_functiondef('public.stockflow_brand_mapping_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'');
 f:=pg_temp.stockflow_group_inherit_seam(f,
  $old$   if p_payload-array['group','expectedLinkId','brandCode','idempotencyKey']<>'{}'::jsonb or jsonb_typeof(p_payload->'group') is distinct from 'string' then
    raise exception 'Invalid group mapping' using errcode='22023';end if;$old$,
  $new$   if jsonb_typeof(p_payload->'group') is distinct from 'string' then
    raise exception 'Invalid group mapping' using errcode='22023';end if;
   if p_payload ? 'clear' then
    if p_payload-array['group','expectedLinkId','clear','idempotencyKey']<>'{}'::jsonb or p_payload->'clear' is distinct from 'true'::jsonb then
     raise exception 'Invalid group clear request' using errcode='22023';end if;
    v_kind:='inherit';v_code:=null;
   elsif p_payload-array['group','expectedLinkId','brandCode','idempotencyKey']<>'{}'::jsonb then
    raise exception 'Invalid group mapping' using errcode='22023';end if;$new$,
  'clear payload');
 f:=pg_temp.stockflow_group_inherit_seam(f,
  $old$   from tree_ancestors a join group_links l on l.item_group=a.ancestor order by a.group_name,a.distance$old$,
  $new$   from tree_ancestors a join group_links l on l.item_group=a.ancestor and l.kind<>'inherit' order by a.group_name,a.distance$new$,
  'skip cleared ancestors after latest');
 f:=pg_temp.stockflow_group_inherit_seam(f,
  $old$   select distinct on(a.group_name) a.group_name,l.brand_code$old$,
  $new$   select distinct on(a.group_name) a.group_name,l.id,l.kind,l.brand_code$new$,
  'inherited effective link');
 f:=pg_temp.stockflow_group_inherit_seam(f,
  $old$'inheritedBrandCode',case when l.id is null then h.brand_code end$old$,
  $new$'inheritedBrandCode',case when l.id is null or l.kind='inherit' then h.brand_code end$new$,
  'tree inheritance');
 f:=pg_temp.stockflow_group_inherit_seam(f,
  $old$    'linkId',l.id,'kind',l.kind,'brandCode',l.brand_code) order by g.sales_paise desc,g.label,g.item_group)
    from groups g left join group_links l on l.item_group=g.item_group$old$,
  $new$    'linkId',l.id,'kind',l.kind,'brandCode',l.brand_code) order by g.sales_paise desc,g.label,g.item_group)
    from groups g left join group_links l on l.item_group=g.item_group$new$,
  'BL1 effective cleared groups');
 f:=pg_temp.stockflow_group_inherit_seam(f,
  $old$   from private.stockflow_products p left join group_links g on g.item_group=p.item_group
   left join sales s$old$,
  $new$   from private.stockflow_products p left join group_links g on g.item_group=p.item_group
   left join tree_inherited h on h.group_name=p.item_group
   left join sales s$new$,
  'candidate inheritance');
 f:=pg_temp.stockflow_group_inherit_seam(f,
  $old$(g.id is null or p.item_group=E'\u0004 Primary')$old$,
  $new$(g.id is null or (g.kind='inherit' and h.id is null) or p.item_group=E'\u0004 Primary')$new$,
  'cleared candidate mapping');
 execute f;
end$patch$;

-- CREATE OR REPLACE preserves the existing grants. No access changes.
commit;
