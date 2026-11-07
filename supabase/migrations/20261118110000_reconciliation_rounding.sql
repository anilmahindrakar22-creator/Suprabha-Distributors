begin;

-- Tally books round-off outside Sales Accounts. net_sales_paise keeps it,
-- and stored amounts don't change. Remove it only from monthly reconciliation.
do $patch$
declare definition text; old_text text; new_text text;
begin
 definition:=replace(pg_get_functiondef('private.stockflow_sales_reconciliation(text,date)'::regprocedure),chr(13),'');
 old_text:=$old$declare app numeric; tally numeric; version text; difference numeric;$old$;
 new_text:=$new$declare app numeric; tally numeric; version text; difference numeric; rounding numeric;$new$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then
  raise exception 'Unexpected sales reconciliation declaration anchor: %',old_text;
 end if;
 definition:=replace(definition,old_text,new_text);

 old_text:=$old$select coalesce(sum(l.net_sales_paise),0) into app from latest v join private.stockflow_economic_source_lines l on l.voucher_id=v.id$old$;
 new_text:=$new$select coalesce(sum(l.net_sales_paise - coalesce((l.evidence->>'roundingPaise')::numeric,0)),0),
  coalesce(sum(coalesce((l.evidence->>'roundingPaise')::numeric,0)),0)
 into app,rounding from latest v join private.stockflow_economic_source_lines l on l.voucher_id=v.id$new$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then
  raise exception 'Unexpected sales reconciliation aggregate anchor: %',old_text;
 end if;
 definition:=replace(definition,old_text,new_text);

 old_text:=$old$'appNetPaise',app,'tallyNetPaise',tally,$old$;
 new_text:=$new$'appNetPaise',app,'tallyNetPaise',tally,'roundOffPaise',rounding,$new$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then
  raise exception 'Unexpected sales reconciliation result anchor: %',old_text;
 end if;
 definition:=replace(definition,old_text,new_text);
 execute definition;
end $patch$;

commit;
