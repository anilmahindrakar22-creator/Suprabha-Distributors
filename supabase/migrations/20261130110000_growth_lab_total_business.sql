-- Lab margin rows are consumables only. Add each lab's total business (all sales, including
-- instruments and bulk invoices) and the instrument-and-bulk part, so the lab list shows
-- total business beside consumables margin. Consumables sales, GP, margin and coverage are unchanged.
begin;

do $patch$
declare f text; old_text text; new_text text;
begin
 select replace(pg_get_functiondef('private.stockflow_growth_margin_model(date)'::regprocedure),chr(13),'') into f;
 old_text:=$old$), labs as materialized ($old$;
 new_text:=$new$), lab_all as (
 select company_id,customer_source_id,sum(net) total_sales,coalesce(sum(net) filter(where instrument),0) instrument_sales
 from costed where customer_source_id is not null group by company_id,customer_source_id
 ), labs as materialized ($new$;
 if (length(f)-length(replace(f,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected growth lab total seam';end if;
 f:=replace(f,old_text,new_text);
 old_text:=$old$from lab_totals l left join private.stockflow_economic_customer_identities i$old$;
 new_text:=$new$from lab_totals l left join lab_all a using(company_id,customer_source_id) left join private.stockflow_economic_customer_identities i$new$;
 if (length(f)-length(replace(f,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected growth lab total seam';end if;
 f:=replace(f,old_text,new_text);
 old_text:=$old$c.city town,known-cost gp,$old$;
 new_text:=$new$c.city town,a.total_sales,a.instrument_sales,known-cost gp,$new$;
 if (length(f)-length(replace(f,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected growth lab total seam';end if;
 f:=replace(f,old_text,new_text);
 old_text:=$old$'coveragePct',coverage,$old$;
 new_text:=$new$'coveragePct',coverage,'totalSalesPaise',total_sales,'instrumentSalesPaise',instrument_sales,$new$;
 if (length(f)-length(replace(f,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected growth lab total seam';end if;
 f:=replace(f,old_text,new_text);
 execute f;
end$patch$;

revoke all on function private.stockflow_growth_margin_model(date) from public,anon,authenticated,service_role;
commit;
