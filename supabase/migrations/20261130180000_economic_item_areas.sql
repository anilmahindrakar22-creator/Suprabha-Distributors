begin;

-- IG2b: item areas are metadata only. Guard the bodies from the local replay
-- through 20261130170000 before changing any schema or function.
do $guard$
declare actual text; expected record;
begin
 for expected in select * from (values
  ('public.stockflow_economics_gateway(text,text,text,jsonb)','a83dc9d38a046f7d1470246e1b200786'),
  ('private.stockflow_economic_workspace_read(text[],boolean)','5870ee7f62a1e820081387f3056abca0'),
  ('private.stockflow_economic_workspace_detail(text[])','98c12190f76ac9b96c32e0d4e2fc72e6')
 ) v(signature,body_md5) loop
  select md5(replace(p.prosrc,chr(13),'')) into actual from pg_proc p where p.oid=expected.signature::regprocedure;
  if actual is distinct from expected.body_md5 then
   raise exception 'Unexpected % body (md5 %)',expected.signature,actual;
  end if;
 end loop;
end$guard$;

create table private.stockflow_economic_item_area_links (
 id uuid primary key default extensions.gen_random_uuid(),
 company_id text not null, product_id text not null,
 area_code text references private.stockflow_lab_areas(code),
 reason text not null, recorded_by text not null,
 recorded_at timestamptz not null default now()
);
create index stockflow_economic_item_area_links_latest on private.stockflow_economic_item_area_links(company_id,product_id,recorded_at desc,id desc);
alter table private.stockflow_economic_item_area_links enable row level security;
revoke all on private.stockflow_economic_item_area_links from public,anon,authenticated,service_role;
create trigger stockflow_economic_item_area_links_no_delete before delete on private.stockflow_economic_item_area_links
 for each row execute function private.prevent_business_delete();
create trigger stockflow_economic_item_area_links_immutable before update on private.stockflow_economic_item_area_links
 for each row execute function private.prevent_immutable_pricing_update();

-- Exact-text seam helper: every seam must match exactly once or stop.
create function pg_temp.stockflow_item_area_seam(definition text,old_text text,new_text text,seam_label text) returns text
language plpgsql as $$
declare occurrences integer;
begin
 occurrences:=(length(definition)-length(replace(definition,old_text,'')))/length(old_text);
 if occurrences<>1 then raise exception 'Unexpected % seam (% matches)',seam_label,occurrences;end if;
 return replace(definition,old_text,new_text);
end$$;

do $patch$
declare definition text;
begin
 definition:=replace(pg_get_functiondef('public.stockflow_economics_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'');
 definition:=pg_temp.stockflow_item_area_seam(definition,
  $old$if coalesce(p_payload->>'commandAction','') not in ('register_historical_instrument','create_target','set_mapping','set_mappings',$old$,
  $new$if coalesce(p_payload->>'commandAction','') not in ('register_historical_instrument','create_target','set_mapping','set_mappings','set_item_areas',$new$,
  'recovery allowlist');
 definition:=pg_temp.stockflow_item_area_seam(definition,
  $old$if p_action not in ('register_historical_instrument','create_target','set_mapping','set_mappings',$old$,
  $new$if p_action not in ('register_historical_instrument','create_target','set_mapping','set_mappings','set_item_areas',$new$,
  'main allowlist');
 definition:=pg_temp.stockflow_item_area_seam(definition,
  $old$ elsif p_action='set_expectation' then$old$,
  $new$ elsif p_action='set_item_areas' then
  -- The shared gateway role check admits Administrator/Management only.
  declare area_items jsonb:=p_payload->'items';area_row jsonb;area_company text;area_code_value text;area_product text;area_current uuid;area_expected uuid;
  begin
   -- Business payload is exact; retain the standard command envelope fields.
   if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Item areas payload must be an object' using errcode='22023';end if;
   if p_payload-array['companyId','reason','areaCode','items','idempotencyKey','expectedActorEmail']<>'{}'::jsonb
    or jsonb_typeof(p_payload->'companyId') is distinct from 'string' or length(btrim(p_payload->>'companyId'))=0
    or jsonb_typeof(p_payload->'reason') is distinct from 'string' or length(btrim(p_payload->>'reason'))<3
    or not(p_payload ? 'areaCode') or jsonb_typeof(p_payload->'areaCode') not in ('string','null') then
    raise exception 'Company, reason of at least 3 characters, area code or null, and items are required' using errcode='22023';
   end if;
   if jsonb_typeof(area_items) is distinct from 'array' then raise exception 'Items must be a list' using errcode='22023';end if;
   if jsonb_array_length(area_items) not between 1 and 200 then raise exception 'Between 1 and 200 items are required' using errcode='22023';end if;
   for area_row in select value from jsonb_array_elements(area_items) loop
    if jsonb_typeof(area_row) is distinct from 'object' then raise exception 'Each item must be an object' using errcode='22023';end if;
    if area_row-array['productId','expectedLinkId']<>'{}'::jsonb
     or jsonb_typeof(area_row->'productId') is distinct from 'string' or length(btrim(area_row->>'productId'))=0
     or not(area_row ? 'expectedLinkId') or jsonb_typeof(area_row->'expectedLinkId') not in ('string','null') then
     raise exception 'Each item needs a product and expected link UUID or null' using errcode='22023';
    end if;
    begin area_expected:=(area_row->>'expectedLinkId')::uuid;
    exception when invalid_text_representation then raise exception 'Expected link must be a UUID or null' using errcode='22023';end;
   end loop;
   if (select count(distinct btrim(value->>'productId')) from jsonb_array_elements(area_items))<>jsonb_array_length(area_items) then
    raise exception 'Each item may appear only once' using errcode='22023';end if;
   area_company:=btrim(p_payload->>'companyId');area_code_value:=p_payload->>'areaCode';
   if area_code_value is not null then
    perform 1 from private.stockflow_lab_areas where code=area_code_value and active for share;
    if not found then raise exception 'Select an active lab test area' using errcode='22023';end if;
   end if;
   select * into item_catalog from private.stockflow_economic_item_catalogs c where c.company_id=area_company order by c.observed_at desc,c.id desc limit 1;
   for area_row in select value from jsonb_array_elements(area_items) order by btrim(value->>'productId') collate "C" loop
    area_product:=btrim(area_row->>'productId');area_expected:=(area_row->>'expectedLinkId')::uuid;
    if item_catalog.id is null or not private.stockflow_economic_item_catalog_current(area_company)
     or not exists(select 1 from jsonb_array_elements(item_catalog.content->'products') p where p->>'id'=area_product) then
     raise exception 'Item % is not in the current catalog',area_product using errcode='22023';end if;
    perform pg_advisory_xact_lock(hashtextextended('stockflow-item-area:'||area_company||':'||area_product,0));
    select id into area_current from private.stockflow_economic_item_area_links where company_id=area_company and product_id=area_product order by recorded_at desc,id desc limit 1;
    if area_current is distinct from area_expected then raise exception 'Item % area changed; refresh and try again',area_product using errcode='PT409';end if;
    insert into private.stockflow_economic_item_area_links(company_id,product_id,area_code,reason,recorded_by,recorded_at)
     values(area_company,area_product,area_code_value,btrim(p_payload->>'reason'),actor,clock_timestamp()) returning id into entity;
   end loop;
  end;
 elsif p_action='set_expectation' then$new$,
  'set_item_areas branch');
 definition:=pg_temp.stockflow_item_area_seam(definition,
  $old$if p_action not in ('create_case','update_case','claim_recovery') then run:=private.stockflow_rebuild_instrument_economics(actor);end if;$old$,
  $new$if p_action not in ('create_case','update_case','claim_recovery','set_item_areas') then run:=private.stockflow_rebuild_instrument_economics(actor);end if;$new$,
  'metadata never rebuilds');

 -- Leave IG1's validation and item loop unchanged when group is absent.
 definition:=pg_temp.stockflow_item_area_seam(definition,
  $old$if jsonb_array_length(batch_items) not between 1 and 200 then raise exception 'Between 1 and 200 items are required' using errcode='22023';end if;$old$,
  $new$if p_payload ? 'group' then
    if jsonb_array_length(batch_items) not between 0 and 200 then raise exception 'Between 0 and 200 items are required with a group' using errcode='22023';end if;
   else
    if jsonb_array_length(batch_items) not between 1 and 200 then raise exception 'Between 1 and 200 items are required' using errcode='22023';end if;
   end if;$new$,
  'group permits empty item batch');
 definition:=pg_temp.stockflow_item_area_seam(definition,
  $old$   for batch_row in select e.value as v from jsonb_array_elements(batch_items) e order by btrim(e.value->>'productId') collate "C" loop$old$,
  $new$   if p_payload ? 'group' then
    declare batch_group jsonb:=p_payload->'group';
    begin
     if jsonb_typeof(batch_group) is distinct from 'object' then raise exception 'Group must be an object' using errcode='22023';end if;
     if batch_group-array['groupId','expectedCatalogId','effectiveFrom','effectiveTo']<>'{}'::jsonb
      or jsonb_typeof(batch_group->'groupId') is distinct from 'string' or length(btrim(batch_group->>'groupId'))=0
      or jsonb_typeof(batch_group->'expectedCatalogId') is distinct from 'string'
      or jsonb_typeof(batch_group->'effectiveFrom') is distinct from 'string' or coalesce(batch_group->>'effectiveFrom','') !~ '^\d{4}-\d{2}-\d{2}$'
      or (batch_group ? 'effectiveTo' and jsonb_typeof(batch_group->'effectiveTo') not in ('null','string'))
      or coalesce(batch_group->>'effectiveTo','')<>'' and batch_group->>'effectiveTo' !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Group needs a group ID, expected catalog and valid dates' using errcode='22023';end if;
     begin
      batch_from:=(batch_group->>'effectiveFrom')::date;batch_to:=nullif(batch_group->>'effectiveTo','')::date;
     exception when others then raise exception 'Group has an invalid date' using errcode='22023';end;
     if batch_to is not null and batch_to<=batch_from then raise exception 'Group must end after it starts' using errcode='22023';end if;
     if batch_target is null then raise exception 'Select an instrument placement for item-group mapping' using errcode='22023';end if;
     select * into item_catalog from private.stockflow_economic_item_catalogs c where c.company_id=other.company_id order by c.observed_at desc,c.id desc limit 1;
     if item_catalog.id is null or item_catalog.id::text is distinct from batch_group->>'expectedCatalogId' or not private.stockflow_economic_item_catalog_current(other.company_id) then
      raise exception 'Tally item-group catalog changed or is unavailable; refresh before mapping' using errcode='PT409';end if;
     if not exists(select 1 from jsonb_array_elements(item_catalog.content->'groups') g where g->>'id'=batch_group->>'groupId') then
      raise exception 'Select a canonical item group from the instrument company' using errcode='22023';end if;
     if exists(select 1 from private.stockflow_economic_item_group_mappings m where m.company_id=other.company_id and m.model_id=other.model_id
      and m.group_id=batch_group->>'groupId' and coalesce(m.target_id,batch_nil)=coalesce(batch_target,batch_nil) and m.effective_from=batch_from) then
      raise exception 'Group % was already changed for this date; refresh and try again',batch_group->>'groupId' using errcode='PT409';end if;
     insert into private.stockflow_economic_item_group_mappings(company_id,model_id,group_id,target_id,catalog_id,effect,effective_from,effective_to,reason,verified_by)
      values(other.company_id,other.model_id,batch_group->>'groupId',batch_target,item_catalog.id,'include',batch_from,batch_to,btrim(p_payload->>'reason'),actor) returning id into entity;
     p_payload:=p_payload-'mappedProductIds'-'catalogSourceVersion'||jsonb_build_object('catalogSourceVersion',item_catalog.source_version,
      'mappedProductIds',coalesce((select jsonb_agg(product_id order by product_id) from private.stockflow_economic_group_products(item_catalog.content,batch_group->>'groupId')),'[]'::jsonb));
    end;
   end if;
   for batch_row in select e.value as v from jsonb_array_elements(batch_items) e order by btrim(e.value->>'productId') collate "C" loop$new$,
  'group include before item rows');
 execute definition;
end$patch$;

-- Both read bodies serve the Set up / Sales & items views. These keys are
-- deliberately outside the summary evidence suppression, including null clears.
do $reads$
declare signature text; definition text;
begin
 foreach signature in array array['private.stockflow_economic_workspace_read(text[],boolean)','private.stockflow_economic_workspace_detail(text[])'] loop
  definition:=replace(pg_get_functiondef(signature::regprocedure),chr(13),'');
  definition:=pg_temp.stockflow_item_area_seam(definition,
   $old$ return result||jsonb_build_object($old$,
   $new$ return result||jsonb_build_object(
  'labAreas',coalesce((select jsonb_agg(jsonb_build_object('code',a.code,'name',a.name) order by a.sort_order,a.code) from private.stockflow_lab_areas a where a.active),'[]'::jsonb),
  'itemAreas',coalesce((
   select jsonb_agg(jsonb_build_object('companyId',l.company_id,'productId',l.product_id,'areaCode',l.area_code,'linkId',l.id) order by l.company_id collate "C",l.product_id collate "C")
   from (select distinct on(company_id,product_id) * from private.stockflow_economic_item_area_links order by company_id,product_id,recorded_at desc,id desc) l
   join (select distinct on(company_id) * from private.stockflow_economic_item_catalogs order by company_id,observed_at desc,id desc) c on c.company_id=l.company_id
   where private.stockflow_economic_item_catalog_current(c.company_id)
    and exists(select 1 from jsonb_array_elements(c.content->'products') p where p->>'id'=l.product_id)
  ),'[]'::jsonb),$new$,
   signature||' area metadata');
  execute definition;
 end loop;
end$reads$;

revoke all on function public.stockflow_economics_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_economics_gateway(text,text,text,jsonb) to service_role;
drop function pg_temp.stockflow_item_area_seam(text,text,text,text);
commit;
