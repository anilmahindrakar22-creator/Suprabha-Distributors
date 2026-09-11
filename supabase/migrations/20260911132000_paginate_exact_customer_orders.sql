create or replace function private.stockflow_order_matches_filter_optimized(
  p_order private.stockflow_orders, p_status text, p_query text, p_capture_date date
) returns boolean
language sql
stable
set search_path = pg_catalog, private
as $$
  select case
    when lower(btrim(coalesce(p_query,''))) like 'customer:%' then
      nullif(btrim(substr(p_query,10)),'') is not null
      and private.stockflow_order_matches_filter(p_order,p_status,'',p_capture_date)
      and lower(btrim(p_order.customer_name))=lower(btrim(substr(p_query,10)))
    else private.stockflow_order_matches_filter_with_notes(p_order,p_status,p_query,p_capture_date)
  end
$$;

revoke all on function private.stockflow_order_matches_filter_optimized(private.stockflow_orders,text,text,date) from public, anon, authenticated;

do $migration$
declare f text; updated text;
begin
  select pg_get_functiondef('public.stockflow_order_list_gateway(text,text,text,jsonb)'::regprocedure) into f;
  updated := replace(f,
    'private.stockflow_order_matches_filter_with_notes(o,v_status,v_query,v_date)',
    'private.stockflow_order_matches_filter_optimized(o,v_status,v_query,v_date)'
  );
  if updated=f then raise exception 'Expected order list filter calls were not found'; end if;
  execute updated;
end $migration$;

revoke all on function public.stockflow_order_list_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_order_list_gateway(text,text,text,jsonb) to service_role;
