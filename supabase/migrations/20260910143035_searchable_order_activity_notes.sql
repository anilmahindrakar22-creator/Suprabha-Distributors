create or replace function private.stockflow_order_matches_filter_with_notes(
  p_order private.stockflow_orders, p_status text, p_query text, p_capture_date date
) returns boolean
language sql
stable
set search_path = pg_catalog, private
as $$
  select private.stockflow_order_matches_filter(p_order,p_status,p_query,p_capture_date)
    or (
      btrim(coalesce(p_query,'')) <> ''
      and lower(btrim(p_query)) not like 'assignee:%'
      and lower(btrim(p_query)) not like 'customer:%'
      and private.stockflow_order_matches_filter(p_order,p_status,'',p_capture_date)
      and exists(
        select 1 from private.stockflow_order_events event
        where event.order_id=p_order.id
          and strpos(lower(coalesce(event.reason,'')),lower(btrim(p_query))) > 0
      )
    )
$$;

revoke all on function private.stockflow_order_matches_filter_with_notes(private.stockflow_orders,text,text,date) from public, anon, authenticated;

do $migration$
declare f text; updated text;
begin
  select pg_get_functiondef('public.stockflow_order_list_gateway(text,text,text,jsonb)'::regprocedure) into f;
  updated := replace(f, 'private.stockflow_order_matches_filter(o,v_status,v_query,v_date)', 'private.stockflow_order_matches_filter_with_notes(o,v_status,v_query,v_date)');
  if updated=f then raise exception 'Expected order list filter calls were not found'; end if;
  execute updated;
end $migration$;

revoke all on function public.stockflow_order_list_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_order_list_gateway(text,text,text,jsonb) to service_role;
