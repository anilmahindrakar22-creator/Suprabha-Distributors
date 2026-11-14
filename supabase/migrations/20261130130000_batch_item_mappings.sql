begin;

-- set_mappings saves many item ticks for one instrument in a single command:
-- one transaction, one global advisory lock hold and one economics rebuild
-- (the gateway's existing rebuild line runs once after the branch). Any invalid
-- item raises and rolls the whole batch back.

-- Exact-text seam helper: every seam must match exactly once or the migration stops.
create function pg_temp.stockflow_batch_seam(definition text,old_text text,new_text text,seam_label text) returns text
language plpgsql as $$
declare occurrences integer;
begin
  occurrences:=(length(definition)-length(replace(definition,old_text,'')))/length(old_text);
  if occurrences<>1 then raise exception 'Unexpected % seam (% matches)',seam_label,occurrences; end if;
  return replace(definition,old_text,new_text);
end$$;

do $batch$
declare definition text;
begin
  definition:=replace(pg_get_functiondef('public.stockflow_economics_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'');
  definition:=pg_temp.stockflow_batch_seam(definition,
    $old$if coalesce(p_payload->>'commandAction','') not in ('register_historical_instrument','create_target','set_mapping',$old$,
    $new$if coalesce(p_payload->>'commandAction','') not in ('register_historical_instrument','create_target','set_mapping','set_mappings',$new$,
    'recovery allowlist');
  definition:=pg_temp.stockflow_batch_seam(definition,
    $old$if p_action not in ('register_historical_instrument','create_target','set_mapping',$old$,
    $new$if p_action not in ('register_historical_instrument','create_target','set_mapping','set_mappings',$new$,
    'main allowlist');
  definition:=pg_temp.stockflow_batch_seam(definition,
    $old$ elsif p_action='set_expectation' then$old$,
    $new$ elsif p_action='set_mappings' then
  -- payload: companyId, modelId, targetId (optional placement), reason, items:[{productId,effect,effectiveFrom,effectiveTo?}]
  declare batch_items jsonb:=p_payload->'items';batch_row record;batch_target uuid;batch_from date;batch_to date;batch_nil uuid:='00000000-0000-0000-0000-000000000000';
  begin
   if length(btrim(coalesce(p_payload->>'companyId','')))=0 or length(btrim(coalesce(p_payload->>'modelId','')))=0 then raise exception 'Company and model are required' using errcode='22023';end if;
   if length(btrim(coalesce(p_payload->>'reason','')))<3 then raise exception 'A reason of at least 3 characters is required' using errcode='22023';end if;
   if jsonb_typeof(batch_items) is distinct from 'array' then raise exception 'Items must be a list' using errcode='22023';end if;
   if jsonb_array_length(batch_items) not between 1 and 200 then raise exception 'Between 1 and 200 items are required' using errcode='22023';end if;
   for batch_row in select e.value as v from jsonb_array_elements(batch_items) e loop
    if jsonb_typeof(batch_row.v) is distinct from 'object'
     or jsonb_typeof(batch_row.v->'productId') is distinct from 'string' or length(btrim(batch_row.v->>'productId'))=0
     or coalesce(batch_row.v->>'effect','') not in ('include','exclude')
     or jsonb_typeof(batch_row.v->'effectiveFrom') is distinct from 'string' or coalesce(batch_row.v->>'effectiveFrom','') !~ '^\d{4}-\d{2}-\d{2}$'
     or (batch_row.v ? 'effectiveTo' and jsonb_typeof(batch_row.v->'effectiveTo') not in ('null','string'))
     or coalesce(batch_row.v->>'effectiveTo','')<>'' and batch_row.v->>'effectiveTo' !~ '^\d{4}-\d{2}-\d{2}$' then
     raise exception 'Each item needs a product, include or exclude, a valid start date and an optional valid end date' using errcode='22023';
    end if;
    begin
     batch_from:=(batch_row.v->>'effectiveFrom')::date;
     batch_to:=nullif(batch_row.v->>'effectiveTo','')::date;
    exception when others then
     raise exception 'Item % has an invalid date',btrim(batch_row.v->>'productId') using errcode='22023';
    end;
    if batch_to is not null and batch_to<=batch_from then raise exception 'Item % must end after it starts',btrim(batch_row.v->>'productId') using errcode='22023';end if;
   end loop;
   if (select count(distinct btrim(e.value->>'productId')) from jsonb_array_elements(batch_items) e)<>jsonb_array_length(batch_items) then raise exception 'Each item may appear only once' using errcode='22023';end if;
   begin
    batch_target:=nullif(p_payload->>'targetId','')::uuid;
   exception when others then
    raise exception 'Override requires matching placement company/model' using errcode='22023';
   end;
   if batch_target is not null then
    select * into other from private.stockflow_economic_targets where id=batch_target;
    if not found or other.kind<>'placement' or other.company_id<>p_payload->>'companyId' or other.model_id<>p_payload->>'modelId' then raise exception 'Override requires matching placement company/model' using errcode='22023';end if;
   end if;
   for batch_row in select e.value as v from jsonb_array_elements(batch_items) e order by btrim(e.value->>'productId') collate "C" loop
    if exists(select 1 from private.stockflow_economic_mappings m
     where m.company_id=btrim(p_payload->>'companyId') and m.model_id=btrim(p_payload->>'modelId') and m.product_id=btrim(batch_row.v->>'productId')
      and coalesce(m.target_id,batch_nil)=coalesce(batch_target,batch_nil) and m.effective_from=(batch_row.v->>'effectiveFrom')::date) then
     raise exception 'Item % was already changed for this date; refresh and try again',btrim(batch_row.v->>'productId') using errcode='PT409';
    end if;
    insert into private.stockflow_economic_mappings(company_id,model_id,product_id,target_id,effect,effective_from,effective_to,reason,verified_by)
    values(btrim(p_payload->>'companyId'),btrim(p_payload->>'modelId'),btrim(batch_row.v->>'productId'),batch_target,batch_row.v->>'effect',(batch_row.v->>'effectiveFrom')::date,nullif(batch_row.v->>'effectiveTo','')::date,btrim(p_payload->>'reason'),actor) returning id into entity;
   end loop;
  end;
 elsif p_action='set_expectation' then$new$,
    'set_mappings branch');
  execute definition;
end $batch$;
revoke all on function public.stockflow_economics_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_economics_gateway(text,text,text,jsonb) to service_role;

drop function pg_temp.stockflow_batch_seam(text,text,text,text);
commit;
