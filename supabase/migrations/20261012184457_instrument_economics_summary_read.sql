begin;
-- Keep one calculator. CASE prevents evidence/catalogue queries on a summary read.
create function private.stockflow_economic_lifetime(p_target uuid,p_run uuid)
returns jsonb language sql stable set search_path=pg_catalog,private as $$
 select jsonb_build_object('salesPaise',coalesce(sum(revenue_paise),0)::text,
  'knownGpPaise',coalesce(sum(gp_paise),0)::text,'lines',count(*),
  'missingCostLines',count(*) filter(where gp_paise is null))
 from private.stockflow_economic_results where run_id=p_run and target_id=p_target and status<>'instrument_billing'
$$;
revoke all on function private.stockflow_economic_lifetime(uuid,uuid) from public,anon,authenticated;

do $migration$
declare definition text; key text; marker text; position integer; tail text;
 finish integer; expression text; comma text; original text; gateway text;
begin
 definition:=pg_get_functiondef('private.stockflow_economic_workspace(text[])'::regprocedure);
 original:='private.stockflow_economic_workspace(p_roles text[])';
 if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
  raise exception 'Unexpected workspace signature; stop summary migration';
 end if;
 definition:=replace(definition,original,'private.stockflow_economic_workspace_read(p_roles text[], p_summary boolean)');
 foreach key in array array['itemBreakdown','instrumentBillings','acquisitionLinks','acquisitionReviews',
  'acquisitionReviewItems','itemGroupCatalogs','itemGroupMappings','groupMemberships','allocations',
  'observations','attributionLines','sourceLines','sourceDocumentExclusions','ledger','expectationHistory',
  'customers','installations','mappings','exceptions','leakage','caseHistory','cases'] loop
  marker:=E'\n  '||quote_literal(key)||',';
  if (length(definition)-length(replace(definition,marker,'')))/length(marker)<>1 then
   raise exception 'Expected one workspace field %, stop summary migration',key;
  end if;
  position:=strpos(definition,marker)+length(marker);
  tail:=substring(definition from position);
  finish:=strpos(tail,E'\n  ''');
  if key='cases' then finish:=strpos(tail,E'\n );');end if;
  if finish=0 then raise exception 'Missing end of workspace field %',key;end if;
  expression:=rtrim(substring(tail from 1 for finish-1));
  comma:=case when right(expression,1)=',' then ',' else '' end;
  if comma<>'' then expression:=left(expression,length(expression)-1);end if;
  definition:=overlay(definition placing
   ('case when p_summary then ''[]''::jsonb else '||expression||' end'||comma)
   from position for finish-1);
 end loop;
 marker:=$q$'installationId',installation_id$q$;
 if (length(definition)-length(replace(definition,marker,'')))/length(marker)<>1 then
  raise exception 'Unexpected target identity fragment; stop summary migration';
 end if;
 definition:=replace(definition,marker,
  $q$'reagentLifetime',private.stockflow_economic_lifetime(id,run),'installationId',installation_id$q$);
 marker:='return result||jsonb_build_object(';
 if (length(definition)-length(replace(definition,marker,'')))/length(marker)<>1 then
  raise exception 'Unexpected return fragment; stop summary migration';
 end if;
 definition:=replace(definition,marker,marker||$q$
  'readView',case when p_summary then 'summary' else 'full' end,
  'todoCount',(select count(distinct l.id) from private.stockflow_economic_source_lines l
   join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id
   where v.kind='sale' and l.quantity>0 and not v.cancelled
   and not exists(select 1 from private.stockflow_economic_source_vouchers n
    where n.company_id=v.company_id and n.source_id=v.source_id and n.source_revision>v.source_revision)
   and exists(select 1 from private.stockflow_economic_results r where r.run_id=run and r.source_line_id=l.id
    and r.target_id is not null and r.status='cost_unavailable' and r.cost_paise is null))
   +(select count(*) from private.stockflow_economic_import_exceptions e where private.stockflow_economic_import_exception_open(e.id)),
$q$);
 execute definition;
 gateway:=pg_get_functiondef('public.stockflow_economics_gateway(text,text,text,jsonb)'::regprocedure);
 marker:='if p_action=''get_instrument_economics'' then return private.stockflow_economic_workspace(roles);end if;';
 if (length(gateway)-length(replace(gateway,marker,'')))/length(marker)<>1 then
  raise exception 'Unexpected economics read branch; stop summary migration';
 end if;
 gateway:=replace(gateway,marker,$q$if p_action='get_instrument_economics' then
  if coalesce(p_payload->>'view','full') not in ('summary','full') then
   raise exception 'Invalid economics read view' using errcode='22023';
  end if;
  return private.stockflow_economic_workspace_read(roles,coalesce(p_payload->>'view','full')='summary');
 end if;$q$);
 execute gateway;
end$migration$;

-- Retain the original stable entry point for existing callers.
create or replace function private.stockflow_economic_workspace(p_roles text[])
returns jsonb language sql stable set search_path=pg_catalog,private as $$
 select private.stockflow_economic_workspace_read(p_roles,false)
$$;
revoke all on function private.stockflow_economic_workspace_read(text[],boolean) from public,anon,authenticated;
revoke all on function private.stockflow_economic_workspace(text[]) from public,anon,authenticated;
commit;
