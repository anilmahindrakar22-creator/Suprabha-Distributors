begin;

-- -> returns JSON null, not SQL null, and the connector sends the key as null on every normal upload.
do $patch$
declare definition text; old_text text; new_text text;
begin
 definition:=replace(pg_get_functiondef('private.stockflow_import_sales_control_totals()'::regprocedure),chr(13),'');
 old_text:=$old$if doc is null then return new;end if;$old$;
 new_text:=$new$if doc is null or jsonb_typeof(doc)='null' then return new;end if;$new$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then
  raise exception 'Unexpected sales control null anchor: %',old_text;
 end if;
 definition:=replace(definition,old_text,new_text);
 execute definition;
end $patch$;

do $patch$
declare definition text; old_text text; new_text text;
begin
 definition:=replace(pg_get_functiondef('public.stockflow_order_summary_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'');
 old_text:=$old$'orderRevision', private.stockflow_order_revision(v_email,v_roles)$old$;
 new_text:=$new$'orderRevision', private.stockflow_order_revision(v_email,v_roles),
    'sourceUpdatedAt',(select s.updated_at from public.stockflow_snapshots s order by s.updated_at desc limit 1)$new$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then
  raise exception 'Unexpected order summary source time anchor: %',old_text;
 end if;
 definition:=replace(definition,old_text,new_text);
 execute definition;
end $patch$;

commit;
