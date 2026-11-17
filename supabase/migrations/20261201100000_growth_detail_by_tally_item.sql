begin;

do $patch$
declare f text; anchor text; replacement text;
begin
 select replace(pg_get_functiondef('private.stockflow_growth_margin_detail(date,jsonb)'::regprocedure),chr(13),'') into f;
 anchor:=$old$ if p_payload-array['itemKey','labKey','page']<>'{}'::jsonb
  or (p_payload ? 'itemKey')=(p_payload ? 'labKey')
  or jsonb_typeof(p_payload->case when is_item then 'itemKey' else 'labKey' end) is distinct from 'string'
  or jsonb_typeof(p_payload->'page') is distinct from 'number'
  or (p_payload->>'page') !~ '^[1-9][0-9]*$' or length(p_payload->>'page')>10 then
  raise exception 'Invalid margin detail options' using errcode='22023';end if;$old$;
 replacement:=$new$ if p_payload-array['itemKey','labKey','tallyItemKey','page']<>'{}'::jsonb
  or (p_payload ? 'itemKey')::integer+(p_payload ? 'labKey')::integer+(p_payload ? 'tallyItemKey')::integer<>1
  or jsonb_typeof(p_payload->case when p_payload ? 'tallyItemKey' then 'tallyItemKey' when is_item then 'itemKey' else 'labKey' end) is distinct from 'string'
  or btrim(coalesce(p_payload->>'tallyItemKey',item_key,lab_key))=''
  or length(coalesce(p_payload->>'tallyItemKey',item_key,lab_key))>240
  or jsonb_typeof(p_payload->'page') is distinct from 'number'
  or (p_payload->>'page') !~ '^[1-9][0-9]*$' or length(p_payload->>'page')>10 then
  raise exception 'Invalid margin detail options' using errcode='22023';end if;$new$;
 if (length(f)-length(replace(f,anchor,'')))/length(anchor)<>1 then
  raise exception 'Unexpected growth tally item seam';
 end if;
 f:=replace(f,anchor,replacement);
 anchor:=$old$ model:=private.stockflow_growth_margin_model(p_today);$old$;
 replacement:=$new$ model:=private.stockflow_growth_margin_model(p_today);
 if p_payload ? 'tallyItemKey' then
  select r->>'itemKey' into item_key from jsonb_array_elements(model->'items') r
  where r->>'tallyItemKey'=p_payload->>'tallyItemKey'
   and exists (select 1 from private.stockflow_products p
    where p.tally_item_key=p_payload->>'tallyItemKey' and p.base_unit<>''
     and lower(btrim(regexp_replace(r->>'itemKey','^.*\|','')))=lower(btrim(p.base_unit)))
  order by (r->>'labs')::numeric desc,(r->>'salesPaise')::numeric desc limit 1;
  is_item:=true;
  if item_key is null then raise exception 'Unknown margin key' using errcode='22023';end if;
 end if;$new$;
 if (length(f)-length(replace(f,anchor,'')))/length(anchor)<>1 then
  raise exception 'Unexpected growth tally item seam';
 end if;
 f:=replace(f,anchor,replacement);
 execute f;
 revoke all on function private.stockflow_growth_margin_detail(date,jsonb) from public,anon,authenticated,service_role;
end$patch$;

commit;
