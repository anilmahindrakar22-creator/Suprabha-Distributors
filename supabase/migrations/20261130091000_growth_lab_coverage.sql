begin;

-- Lab coverage measures positive sales only; net totals and GP stay unchanged.
do $patch$
declare f text; old_text text; new_text text;
begin
 select replace(pg_get_functiondef('private.stockflow_growth_margin_model(date)'::regprocedure),chr(13),'') into f;
 old_text:=$old$sum(net) sales,coalesce(sum(net) filter(where cost is not null),0) known,$old$;
 new_text:=$new$sum(net) sales,coalesce(sum(net) filter(where cost is not null),0) known,coalesce(sum(net) filter(where net>0),0) pos_sales,coalesce(sum(net) filter(where net>0 and cost is not null),0) pos_known,$new$;
 if (length(f)-length(replace(f,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected growth lab coverage seam';end if;
 f:=replace(f,old_text,new_text);
 old_text:=$old$select company_id,customer_source_id,lab_key,sum(sales) sales,sum(known) known,sum(cost) cost$old$;
 new_text:=$new$select company_id,customer_source_id,lab_key,sum(sales) sales,sum(known) known,sum(cost) cost,sum(pos_sales) pos_sales,sum(pos_known) pos_known$new$;
 if (length(f)-length(replace(f,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected growth lab coverage seam';end if;
 f:=replace(f,old_text,new_text);
 old_text:=$old$case when sales<>0 then round(100*known/sales,1) end coverage$old$;
 new_text:=$new$case when pos_sales>0 then round(100*pos_known/pos_sales,1) end coverage$new$;
 if (length(f)-length(replace(f,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected growth lab coverage seam';end if;
 f:=replace(f,old_text,new_text);
 execute f;
end$patch$;

revoke all on function private.stockflow_growth_margin_model(date) from public,anon,authenticated,service_role;
commit;
