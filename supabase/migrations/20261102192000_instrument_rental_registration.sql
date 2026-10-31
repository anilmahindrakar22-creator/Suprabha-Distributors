begin;

-- Patch the current function, including the instrument-register serial guard.
-- Every seam must occur exactly once; drift aborts the entire migration.
do $patch$
declare definition text; old_text text; new_text text; signature text;
begin
 definition:=replace(pg_get_functiondef('private.stockflow_register_historical_instrument(text,jsonb)'::regprocedure),chr(13),'');
 old_text:=$old$declare sale record;customer uuid;day date;serial text;reference text;entity uuid;$old$;
 new_text:=$new$declare sale record;customer uuid;day date;serial text;reference text;entity uuid;
 rental boolean:=coalesce(p_payload->>'basis','sold')='rental';$new$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected rental declaration anchor';end if;
 definition:=replace(definition,old_text,new_text);
 old_text:=$old$sale.kind<>'sale'$old$;
 new_text:=$new$sale.kind<>(case when rental then 'purchase' else 'sale' end)$new$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected rental kind anchor';end if;
 definition:=replace(definition,old_text,new_text);
 old_text:=$old$or sale.customer_source_id is null$old$;
 new_text:=$new$or (not rental and sale.customer_source_id is null)$new$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected rental customer anchor';end if;
 definition:=replace(definition,old_text,new_text);
 -- Keep validation before writing any identity or installation.
 old_text:=' if sale.batch_id is not null';
 new_text:=$new$ if rental then
  if not exists(select 1 from private.stockflow_economic_customer_identities where company_id=sale.company_id and customer_id=customer) then
   raise exception 'Link this lab to Tally first' using errcode='22023';end if;
  if exists(select 1 from private.stockflow_economic_acquisition_links a where a.company_id=sale.company_id and a.source_id=sale.source_id and a.line_key=sale.line_key)
   or exists(select 1 from private.stockflow_economic_cost_links c join private.stockflow_economic_source_lines l on l.id=c.purchase_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where v.company_id=sale.company_id and v.source_id=sale.source_id and l.line_key=sale.line_key) then
   raise exception 'Purchase line already assigned to capital or reagent cost' using errcode='PT409';end if;
 end if;
 if sale.batch_id is not null$new$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected rental evidence anchor';end if;
 definition:=replace(definition,old_text,new_text);
 old_text:=$old$ insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by) values(sale.company_id,sale.customer_source_id,customer,p_actor) on conflict do nothing;
 if not exists(select 1 from private.stockflow_economic_customer_identities where company_id=sale.company_id and source_id=sale.customer_source_id and customer_id=customer) then raise exception 'Canonical customer identity conflicts with existing verification' using errcode='22023';end if;$old$;
 new_text:=' if not rental then'||chr(10)||old_text||chr(10)||' end if;';
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected rental identity anchor';end if;
 definition:=replace(definition,old_text,new_text);
 execute definition;

 -- The legacy workspace delegates to these readers. Summary keeps empty arrays.
 foreach signature in array array['private.stockflow_economic_workspace_read(text[],boolean)','private.stockflow_economic_workspace_detail(text[])'] loop
  definition:=replace(pg_get_functiondef(signature::regprocedure),chr(13),'');
  old_text:=$old$'batchId',l.batch_id)) from private.stockflow_economic_source_lines l$old$;
  new_text:=$new$'batchId',l.batch_id,
   'partyName',coalesce(nullif(v.evidence->>'partyName',''),nullif(v.evidence->>'supplierName',''),nullif(v.evidence->>'customerName',''),
    (select m.name from private.stockflow_economic_ledger_masters m join private.stockflow_economic_ledger_generations g on g.company_id=m.company_id and g.catalog_version=m.source_version where g.company_id=v.company_id and m.guid=v.customer_source_id order by g.observed_at desc limit 1)),
   'usedByInstrument',exists(select 1 from private.stockflow_equipment_installations i where i.historical_sale_line_id=l.id or i.tally_key=v.company_id||':'||v.source_id||':'||l.line_key)
    or exists(select 1 from private.stockflow_economic_acquisition_links a where a.company_id=v.company_id and a.source_id=v.source_id and a.line_key=l.line_key)
    or exists(select 1 from private.stockflow_economic_instrument_billings b where b.company_id=v.company_id and b.source_id=v.source_id and b.line_key=l.line_key)
    or exists(select 1 from private.stockflow_economic_cost_links c join private.stockflow_economic_source_lines cl on cl.id=c.purchase_line_id join private.stockflow_economic_source_vouchers cv on cv.id=cl.voucher_id where cv.company_id=v.company_id and cv.source_id=v.source_id and cl.line_key=l.line_key))) from private.stockflow_economic_source_lines l$new$;
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected instrument picker line anchor: %',signature;end if;
  definition:=replace(definition,old_text,new_text);
  old_text:=$old$jsonb_build_object('id',id,'name',name) order by name) from private.stockflow_customers where active$old$;
  new_text:=$new$jsonb_build_object('id',id,'name',name,'city',city,'tallyIdentities',coalesce((select jsonb_agg(jsonb_build_object('companyId',i.company_id,'customerSourceId',i.source_id)) from private.stockflow_economic_customer_identities i where i.customer_id=stockflow_customers.id),'[]'::jsonb)) order by name) from private.stockflow_customers where active$new$;
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected instrument lab city anchor: %',signature;end if;
  definition:=replace(definition,old_text,new_text);
  if signature='private.stockflow_economic_workspace_detail(text[])' then
   old_text:=$old$and (v.kind<>'sale' or exists(select 1 from private.stockflow_economic_targets kept where kept.company_id=v.company_id and kept.customer_source_id=v.customer_source_id))$old$;
   new_text:=$new$and (v.kind<>'sale' or (l.quantity=1 and l.net_sales_paise>=5000000) or exists(select 1 from private.stockflow_economic_targets kept where kept.company_id=v.company_id and kept.customer_source_id=v.customer_source_id))$new$;
   if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected equipment sale scope anchor';end if;
   definition:=replace(definition,old_text,new_text);
  end if;
  execute definition;
 end loop;
end$patch$;
revoke all on function private.stockflow_register_historical_instrument(text,jsonb) from public,anon,authenticated,service_role;
commit;
