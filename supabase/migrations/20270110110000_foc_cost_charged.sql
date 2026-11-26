begin;

-- Charge actual purchase cost for free supply without requiring a manager reason.
do $patch$
declare signature text; definition text; old_text text;
begin
 foreach signature in array array['private.stockflow_rebuild_instrument_economics(text)','private.stockflow_rebuild_instrument_economics_full_scan(text)'] loop
  definition:=replace(pg_get_functiondef(signature::regprocedure),chr(13),'');
  old_text:=$old$case when purchase_cost is null then 'cost_unavailable' when row.net_sales_paise=0 and row.quantity>0 and coalesce(row.foc_reason,'') not in ('installation','training','quality_control','replacement','commercial_support','other') then 'foc_unclassified' else 'verified' end$old$;
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Expected one FOC status anchor in %',signature;end if;
  definition:=replace(definition,old_text,$new$case when purchase_cost is null then 'cost_unavailable' else 'verified' end$new$);
  old_text:=$old$then row.foc_reason else 'UNKNOWN' end$old$;
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Expected one FOC reason anchor in %',signature;end if;
  definition:=replace(definition,old_text,$new$then row.foc_reason else 'cost charged' end$new$);
  execute definition;
 end loop;
end$patch$;
revoke all on function private.stockflow_rebuild_instrument_economics(text) from public,anon,authenticated;
revoke all on function private.stockflow_rebuild_instrument_economics_full_scan(text) from public,anon,authenticated,service_role;

do $patch$
declare signature text; definition text; pair record;
begin
 foreach signature in array array['private.stockflow_economic_workspace_read(text[],boolean)','private.stockflow_economic_workspace_detail(text[])'] loop
  definition:=replace(pg_get_functiondef(signature::regprocedure),chr(13),'');
  for pair in select * from (values
   (1,$old$ count(*) filter(where r.cost_paise is null) missing_cost,$old$,
    $new$ count(*) filter(where r.cost_paise is null) missing_cost,
 count(*) filter(where r.reason like 'FOC:%') free_lines,
 coalesce(sum(r.cost_paise) filter(where r.reason like 'FOC:%'),0) free_cost,$new$),
   (2,$old$   coalesce(ot.missing_cost,0) missing_cost,$old$,
    $new$   coalesce(ot.missing_cost,0) missing_cost,coalesce(ot.free_lines,0) free_lines,coalesce(ot.free_cost,0) free_cost,$new$),
   (3,$old$'missingCostLines',missing_cost,$old$,
    $new$'missingCostLines',missing_cost,'freeLines',free_lines,'freeCostPaise',free_cost::text,$new$)
  ) patches(n,old_text,new_text) loop
   if (length(definition)-length(replace(definition,pair.old_text,'')))/length(pair.old_text)<>1 then raise exception 'Expected one free-line anchor (%) in %',pair.n,signature;end if;
   definition:=replace(definition,pair.old_text,pair.new_text);
  end loop;
  execute definition;
  execute format('revoke all on function %s from public, anon, authenticated, service_role',signature);
 end loop;
end$patch$;

commit;
