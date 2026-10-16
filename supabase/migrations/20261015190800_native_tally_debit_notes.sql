begin;

-- Accept native Tally Debit Notes by their recorded trade side. Supplier
-- returns consume purchase stock; they are not customer sales or reagent GP.
alter table private.stockflow_economic_source_vouchers drop constraint stockflow_economic_source_vouchers_kind_check;
alter table private.stockflow_economic_source_vouchers add constraint stockflow_economic_source_vouchers_kind_check
 check(kind in ('sale','return','credit','purchase','purchase_return','non_economic'));

create function private.stockflow_economic_purchase_return_blocked(p_run uuid,p_company text,p_product text,p_unit text,p_date date)
returns boolean language sql stable set search_path=pg_catalog,private as $$
 select exists(select 1 from private.stockflow_economic_results r
 join private.stockflow_economic_source_lines l on l.id=r.source_line_id
 join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id
 where r.run_id=p_run and r.reason='purchase_return_stock_unavailable' and v.company_id=p_company
  and l.product_id=p_product and l.unit=p_unit and v.business_date<=p_date)
$$;
revoke all on function private.stockflow_economic_purchase_return_blocked(uuid,text,text,text,date) from public,anon,authenticated;

do $migration$
declare definition text; old_value text; new_value text; pair record; occurrences integer;
begin
 select pg_get_functiondef('private.stockflow_import_economic_vouchers()'::regprocedure) into definition;
 for pair in select * from (values
  ('   insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,site_id,kind,cancelled,evidence)',
   $q$   if entry->>'kind'='purchase_return' and (entry->>'voucherType' is distinct from 'Debit Note' or entry->>'classificationPolicy' is distinct from 'native_debit_note_v1'
    or not coalesce(entry->>'nativeTradeSide'='purchase' or (coalesce((entry->>'cancelled')::boolean,false) and entry->>'nativeTradeSide'='cancelled'),false)) then
    raise exception 'Supplier return needs recorded native Debit Note trade evidence';end if;
   insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,site_id,kind,cancelled,evidence)$q$),
  ($q$    if entry->>'kind'='credit' and$q$,
   $q$    if entry->>'kind'='purchase_return' and ((line->>'quantity')::numeric>=0 or (line->>'netSalesPaise')::bigint>0) then raise exception 'Supplier returns require signed outward stock and nonpositive purchase value';end if;
    if entry->>'voucherType'='Debit Note' and entry->>'kind'='sale' and (line->>'quantity')::numeric=0 then raise exception 'Native value-only sales Debit Note requires original-sale linkage';end if;
    if entry->>'kind'='credit' and$q$)
 ) patches(old_value,new_value) loop
  occurrences:=(length(definition)-length(replace(definition,pair.old_value,'')))/length(pair.old_value);
  if occurrences<>1 then raise exception 'Expected one native Debit Note import seam, found %',occurrences;end if;
  definition:=replace(definition,pair.old_value,pair.new_value);
 end loop;
 execute definition;

 select pg_get_functiondef('private.stockflow_economic_auto_cost(uuid,uuid)'::regprocedure) into definition;
 for pair in select * from (values
  ('l.quantity,l.batch_id,v.company_id,v.business_date','case when v.kind=''purchase_return'' then -l.quantity else l.quantity end quantity,l.batch_id,v.company_id,v.business_date'),
  ($q$where l.id=p_sale and v.kind='sale' and not v.cancelled;$q$,$q$where l.id=p_sale and v.kind in ('sale','purchase_return') and not v.cancelled;$q$)
 ) patches(old_value,new_value) loop
  occurrences:=(length(definition)-length(replace(definition,pair.old_value,'')))/length(pair.old_value);
  if occurrences<>1 then raise exception 'Expected one supplier stock allocation seam, found %',occurrences;end if;
  definition:=replace(definition,pair.old_value,pair.new_value);
 end loop;
 execute definition;

 select pg_get_functiondef('private.stockflow_economic_auto_cost_candidates(uuid,text,text,text,text,date)'::regprocedure) into definition;
 old_value:=$q$where pv.kind='purchase' and not pv.cancelled$q$;
 new_value:=$q$where not private.stockflow_economic_purchase_return_blocked(p_run,p_company,p_product,p_unit,p_date)
  and pv.kind='purchase' and not pv.cancelled$q$;
 occurrences:=(length(definition)-length(replace(definition,old_value,'')))/length(old_value);
 if occurrences<>1 then raise exception 'Expected one stock deficit candidate seam, found %',occurrences;end if;
 execute replace(definition,old_value,new_value);

 select pg_get_functiondef('private.stockflow_rebuild_instrument_economics(text)'::regprocedure) into definition;
 for pair in select * from (values
  ($q$order by v.business_date,case when v.kind='sale' then 0 else 1 end,l.id$q$,
   $q$order by v.business_date,case when v.kind='purchase_return' then 0 when v.kind='sale' then 1 else 2 end,l.id$q$),
  ($q$  recovery_origin:=row.business_date;shares:=null;$q$,
   $q$  if row.kind='purchase_return' then
   cost:=private.stockflow_economic_auto_cost(run,row.id);
   insert into private.stockflow_economic_results(run_id,source_line_id,status,reason,share_bps,quantity,revenue_paise)
   values(run,row.id,case when cost is null then 'cost_unavailable' else 'excluded' end,
    case when cost is null then 'purchase_return_stock_unavailable' else 'recorded_purchase_return' end,10000,row.quantity,0);
   continue;
  end if;
  recovery_origin:=row.business_date;shares:=null;$q$),
  ($q$  if row.kind='sale' and cost is null and row.quantity>0$q$,
   $q$  if row.kind='sale' and private.stockflow_economic_purchase_return_blocked(run,row.company_id,row.product_id,row.unit,row.business_date) then cost:=null;end if;
  if row.kind='sale' and cost is null and row.quantity>0$q$)
 ) patches(old_value,new_value) loop
  occurrences:=(length(definition)-length(replace(definition,pair.old_value,'')))/length(pair.old_value);
  if occurrences<>1 then raise exception 'Expected one supplier return rebuild seam, found %',occurrences;end if;
  definition:=replace(definition,pair.old_value,pair.new_value);
 end loop;
 execute definition;
end$migration$;

revoke all on function private.stockflow_import_economic_vouchers() from public,anon,authenticated;
revoke all on function private.stockflow_economic_auto_cost(uuid,uuid) from public,anon,authenticated;
revoke all on function private.stockflow_economic_auto_cost_candidates(uuid,text,text,text,text,date) from public,anon,authenticated;
revoke all on function private.stockflow_rebuild_instrument_economics(text) from public,anon,authenticated;
commit;
