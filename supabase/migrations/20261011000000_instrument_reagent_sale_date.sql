begin;

-- Sold instruments count reagent sales from the current linked Tally invoice,
-- inclusively. Physical installation dates and immutable source history remain
-- unchanged. Placements without an instrument invoice retain their start date.
-- An invalid/cancelled linked invoice leaves the start unavailable, not guessed.
create function private.stockflow_economic_sales_from(p_target uuid) returns date
language sql stable set search_path=pg_catalog,private as $$
 select case when b.target_id is null then t.effective_from else current_sale.business_date end
 from private.stockflow_economic_targets t
 left join private.stockflow_economic_instrument_billings b on b.target_id=t.id
 left join private.stockflow_economic_source_lines original on original.id=b.source_line_id
 left join lateral(
  select v.business_date
  from private.stockflow_economic_source_vouchers v
  join private.stockflow_economic_source_lines l on l.voucher_id=v.id and l.line_key=b.line_key
  where v.company_id=b.company_id and v.source_id=b.source_id and v.kind='sale' and not v.cancelled
   and not private.stockflow_economic_source_unresolved(b.company_id,b.source_id)
   and not exists(select 1 from private.stockflow_economic_source_vouchers n where n.company_id=v.company_id and n.source_id=v.source_id and n.source_revision>v.source_revision)
   and v.customer_source_id=t.customer_source_id and l.product_id=original.product_id and l.unit=original.unit
   and l.quantity=1 and l.net_sales_paise>=0 and v.business_date<=private.stockflow_economic_business_date()
   and v.business_date>=(select pv.business_date from private.stockflow_economic_acquisition_links a join private.stockflow_economic_source_lines pl on pl.id=a.purchase_line_id join private.stockflow_economic_source_vouchers pv on pv.id=pl.voucher_id where a.target_id=t.id)
 ) current_sale on true
 where t.id=p_target
$$;
revoke all on function private.stockflow_economic_sales_from(uuid) from public,anon,authenticated;

do $migration$
declare definition text; old_fragment text; new_fragment text; pair record; occurrences integer;
begin
 select pg_get_functiondef('private.stockflow_rebuild_instrument_economics(text)'::regprocedure) into definition;
 for pair in select * from (values
  ('p.effective_from<=row.business_date','private.stockflow_economic_sales_from(p.id)<=row.business_date'),
  ('t.effective_from<=row.business_date','private.stockflow_economic_sales_from(t.id)<=row.business_date')
 ) patches(old_value,new_value) loop
  occurrences:=(length(definition)-length(replace(definition,pair.old_value,'')))/length(pair.old_value);
  if occurrences<>1 then raise exception 'Expected one reagent start predicate %, found %',pair.old_value,occurrences;end if;
  definition:=replace(definition,pair.old_value,pair.new_value);
 end loop;
 execute definition;

 select pg_get_functiondef('private.stockflow_economic_workspace(text[])'::regprocedure) into definition;
 for pair in select * from (values
  ('select t.*,c.name customer_name,','select t.*,private.stockflow_economic_sales_from(t.id) sales_from,c.name customer_name,'),
  ($q$'installationId',installation_id,'effectiveFrom',effective_from,'effectiveTo',effective_to$q$,$q$'installationId',installation_id,'effectiveFrom',effective_from,'salesFrom',sales_from,'effectiveTo',effective_to$q$),
  ('least(f.effective_from,coalesce((select min(p.effective_from) from private.stockflow_economic_group_members gm join private.stockflow_economic_targets p on p.id=gm.placement_id where gm.group_id=f.id),f.effective_from))',
   'least(f.sales_from,coalesce((select min(private.stockflow_economic_sales_from(p.id)) from private.stockflow_economic_group_members gm join private.stockflow_economic_targets p on p.id=gm.placement_id where gm.group_id=f.id),f.sales_from))'),
  ('or run is null or not covered','or sales_from is null or run is null or not covered')
 ) patches(old_value,new_value) loop
  occurrences:=(length(definition)-length(replace(definition,pair.old_value,'')))/length(pair.old_value);
  if occurrences<>1 then raise exception 'Expected one workspace sale-date fragment %, found %',pair.old_value,occurrences;end if;
  definition:=replace(definition,pair.old_value,pair.new_value);
 end loop;
 execute definition;
end$migration$;

revoke all on function private.stockflow_rebuild_instrument_economics(text) from public,anon,authenticated;
revoke all on function private.stockflow_economic_workspace(text[]) from public,anon,authenticated;

-- An incompletely covered sale still consumes the available stock. Reserve that
-- stock so a later sale cannot use it again, but return NULL for the whole sale
-- cost and GP until its complete quantity is supported. Links record stock
-- reservation evidence; only a fully covered sale posts a financial GP result.
do $stock_reservation$
declare definition text; pair record; occurrences integer;
begin
 select pg_get_functiondef('private.stockflow_economic_auto_cost(uuid,uuid)'::regprocedure) into definition;
 for pair in select * from (values
  ('if available<need then return null;end if;','-- Reserve the available portion even when full cost remains unavailable.'),
  ('return total;','return case when need=0 then total else null end;')
 ) patches(old_value,new_value) loop
  occurrences:=(length(definition)-length(replace(definition,pair.old_value,'')))/length(pair.old_value);
  if occurrences<>1 then raise exception 'Expected one automatic stock reservation fragment %, found %',pair.old_value,occurrences;end if;
  definition:=replace(definition,pair.old_value,pair.new_value);
 end loop;
 execute definition;
 select pg_get_functiondef('private.stockflow_economic_workspace(text[])'::regprocedure) into definition;
 occurrences:=(length(definition)-length(replace(definition,$q$'Auto from Tally purchase '||string_agg$q$,'')))/length($q$'Auto from Tally purchase '||string_agg$q$);
 if occurrences<>1 then raise exception 'Expected one automatic cost evidence prefix, found %',occurrences;end if;
 execute replace(definition,$q$'Auto from Tally purchase '||string_agg$q$,$q$(case when r.cost_paise is null then 'Partial stock reservation (full cost unavailable) from Tally purchase ' else 'Auto from Tally purchase ' end)||string_agg$q$);
end$stock_reservation$;
revoke all on function private.stockflow_economic_auto_cost(uuid,uuid) from public,anon,authenticated;
commit;
