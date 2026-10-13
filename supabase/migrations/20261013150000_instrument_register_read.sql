begin;

-- Patch only the installation identity in the effective full read.
do $upgrade$
declare v_definition text; v_anchor text;
begin
 v_definition:=replace(pg_get_functiondef('private.stockflow_economic_workspace_read(text[],boolean)'::regprocedure),chr(13),'');
 v_anchor:=$seam$'customerName',coalesce(o.customer_name,historical_customer.name)$seam$;
 if (length(v_definition)-length(replace(v_definition,v_anchor,'')))/length(v_anchor)<>1 then
  raise exception 'Unexpected instrument register read seam';
 end if;
 v_definition:=replace(v_definition,v_anchor,v_anchor||$seam$,
  'instrumentId',i.instrument_id,
  'modelId',(select m.model_id from private.stockflow_instruments m where m.id=i.instrument_id),
  'movedFrom',(select coalesce(previous_order.customer_name,previous_customer.name)
   from private.stockflow_equipment_installations previous
   left join private.stockflow_orders previous_order on previous_order.id=previous.order_id
   left join private.stockflow_customers previous_customer on previous_customer.id=previous.customer_id
   where previous.instrument_id=i.instrument_id and previous.id<>i.id and previous.status='completed'
    and (coalesce(previous.installed_on,previous.completed_at::date),previous.completed_at)
      < (coalesce(i.installed_on,i.completed_at::date),i.completed_at)
   order by coalesce(previous.installed_on,previous.completed_at::date) desc,previous.completed_at desc
   limit 1)$seam$);
 execute v_definition;
end$upgrade$;
revoke all on function private.stockflow_economic_workspace_read(text[],boolean) from public,anon,authenticated;
commit;
