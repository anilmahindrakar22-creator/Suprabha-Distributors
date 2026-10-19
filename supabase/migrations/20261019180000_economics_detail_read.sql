-- Economics detail tabs (To do, Accounts review, Breakdown, Exceptions, Reagent leakage) read a
-- "detail" view: the full read with sourceLines limited to non-sale lines (purchases, returns)
-- and sales of customers that have a registered instrument. On 19 Oct 2026 sourceLines were
-- ~3.7 MB of a 4.3 MB full read, almost all sales to customers without an instrument.
-- Forms that search every invoice (Set up, All actions) and the evidence list still load the
-- unchanged "full" view. The detail view is built from the full read's own definition, so
-- every other section and figure is identical by construction.

do $migration$
declare
  f text;
  header_old constant text := 'private.stockflow_economic_workspace_read(p_roles text[], p_summary boolean)';
  declare_old constant text := 'declare result jsonb;';
  view_old constant text := $a$'readView',case when p_summary then 'summary' else 'full' end,$a$;
  lines_old constant text := $a$n.source_revision>v.source_revision)),'[]'::jsonb) end,
  'sourceDocumentExclusionCount'$a$;
  lines_new constant text := $a$n.source_revision>v.source_revision) and (v.kind<>'sale' or exists(select 1 from private.stockflow_economic_targets kept where kept.company_id=v.company_id and kept.customer_source_id=v.customer_source_id))),'[]'::jsonb) end,
  'sourceDocumentExclusionCount'$a$;
  gateway text;
  check_old constant text := $a$if coalesce(p_payload->>'view','full') not in ('summary','full') then$a$;
  return_old constant text := $a$  return private.stockflow_economic_workspace_read(roles,coalesce(p_payload->>'view','full')='summary');$a$;
  piece text;
begin
  select pg_get_functiondef('private.stockflow_economic_workspace_read(text[],boolean)'::regprocedure) into f;
  foreach piece in array array[header_old, declare_old, view_old, lines_old] loop
    if (length(f) - length(replace(f, piece, ''))) / length(piece) <> 1 then
      raise exception 'Unexpected economics workspace text; stop detail migration: %', left(piece, 60);
    end if;
  end loop;
  f := replace(f, header_old, 'private.stockflow_economic_workspace_detail(p_roles text[])');
  f := replace(f, declare_old, 'declare p_summary constant boolean := false; result jsonb;');
  f := replace(f, view_old, $a$'readView','detail',$a$);
  f := replace(f, lines_old, lines_new);
  execute f;

  gateway := pg_get_functiondef('public.stockflow_economics_gateway(text,text,text,jsonb)'::regprocedure);
  foreach piece in array array[check_old, return_old] loop
    if (length(gateway) - length(replace(gateway, piece, ''))) / length(piece) <> 1 then
      raise exception 'Unexpected economics read branch; stop detail migration: %', left(piece, 60);
    end if;
  end loop;
  gateway := replace(gateway, check_old, $a$if coalesce(p_payload->>'view','full') not in ('summary','detail','full') then$a$);
  gateway := replace(gateway, return_old, $a$  if p_payload->>'view'='detail' then return private.stockflow_economic_workspace_detail(roles); end if;
$a$ || return_old);
  execute gateway;
end $migration$;

revoke all on function private.stockflow_economic_workspace_detail(text[]) from public, anon, authenticated;
