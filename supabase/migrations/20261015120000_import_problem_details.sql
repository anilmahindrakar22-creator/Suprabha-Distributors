begin;

-- Read-only projection of the connector's existing per-voucher evidence.
-- The summary migration moved the effective definition into workspace_read.
do $migration$
declare
 definition text;
 occurrences integer;
 old_fragment constant text := $q$'status','import_rejected','reason',reason) from private.stockflow_economic_import_exceptions e where private.stockflow_economic_import_exception_open(e.id)$q$;
 new_fragment constant text := $q$'status','import_rejected','reason',reason,'voucherNumber',evidence->>'sourceReference','voucherType',evidence->>'voucherType','voucherDate',evidence->>'date','detail',evidence->>'error','kind',evidence->>'kind') from private.stockflow_economic_import_exceptions e where private.stockflow_economic_import_exception_open(e.id)$q$;
begin
 definition:=replace(pg_get_functiondef('private.stockflow_economic_workspace_read(text[],boolean)'::regprocedure),chr(13),'');
 occurrences:=(length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment);
 if occurrences<>1 then raise exception 'Expected one active import exception projection, found %',occurrences;end if;
 execute replace(definition,old_fragment,new_fragment);
end
$migration$;

revoke all on function private.stockflow_economic_workspace_read(text[],boolean) from public,anon,authenticated;

commit;
