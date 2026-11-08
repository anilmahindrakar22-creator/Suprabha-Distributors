begin;

-- Patch the effective gateway after classes, power alerts and visit reasons.
do $patch$
declare definition text; old_text text; new_text text;
begin
  definition:=replace(pg_get_functiondef('public.stockflow_accounts_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'');
  old_text:=$old$  v_search text; v_scope text; v_owner text; v_territory uuid; v_page integer:=1;$old$;
  new_text:=old_text||$new$
  v_unassigned boolean:=false;$new$;
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected accounts territory declaration anchor';end if;
  definition:=replace(definition,old_text,new_text);

  old_text:=$old$    if p_payload ? 'territoryId' then$old$;
  new_text:=$new$    if p_payload ? 'unassignedTerritory' then
      if jsonb_typeof(p_payload->'unassignedTerritory') is distinct from 'boolean'
        or p_payload->'unassignedTerritory' is distinct from 'true'::jsonb
        or p_payload ? 'territoryId' then
        raise exception 'Invalid territory' using errcode='22023'; end if;
      v_unassigned:=true;
    end if;
$new$||old_text;
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected accounts territory validation anchor';end if;
  definition:=replace(definition,old_text,new_text);

  old_text:=$old$and (v_territory is null or a.territory_id=v_territory)$old$;
  new_text:=old_text||$new$
        and (not v_unassigned or a.territory_id is null)$new$;
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected accounts territory predicate anchor';end if;
  definition:=replace(definition,old_text,new_text);
  execute definition;
end $patch$;
revoke all on function public.stockflow_accounts_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_accounts_gateway(text,text,text,jsonb) to service_role;
commit;
notify pgrst,'reload schema';
