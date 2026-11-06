begin;

-- The API session's safeupdate rejects DELETE without WHERE; where true keeps the full replacement.
do $patch$
declare definition text; old_text text; new_text text;
begin
 definition:=replace(pg_get_functiondef('private.stockflow_import_tally_pricing_evidence()'::regprocedure),chr(13),'');
 old_text:=$old$delete from private.stockflow_supplier_prices;$old$;
 new_text:=$new$delete from private.stockflow_supplier_prices where true;$new$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then
  raise exception 'Unexpected supplier prices delete anchor: %',old_text;
 end if;
 definition:=replace(definition,old_text,new_text);
 if position(old_text in definition)>0 then raise exception 'Legacy supplier prices delete anchor remains';end if;
 execute definition;
end $patch$;

-- Bounded headroom under the Edge function's 25 s abort.
alter function public.stockflow_sync_snapshot(jsonb) set statement_timeout = '24s';

commit;
