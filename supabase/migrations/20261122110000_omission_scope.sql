begin;

-- Regular uploads answer for economic vouchers; sales coverage also answers for non-economic documents.
do $patch$
declare definition text; old_text text; new_text text;
begin
 definition:=replace(pg_get_functiondef('private.stockflow_import_economic_vouchers()'::regprocedure),chr(13),'');
 old_text:=$old$v.kind<>'purchase' and v.business_date>=from_date$old$;
 new_text:=$new$v.kind<>'purchase' and (v.kind<>'non_economic' or doc->>'purpose'='sales_coverage') and v.business_date>=from_date$new$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>2 then
  raise exception 'Expected two complete-window omission scope anchors';
 end if;
 definition:=replace(definition,old_text,new_text);
 execute definition;
end $patch$;
revoke all on function private.stockflow_import_economic_vouchers() from public,anon,authenticated;
revoke all on function private.stockflow_economic_item_catalog_current(text) from public,anon,authenticated;

commit;
