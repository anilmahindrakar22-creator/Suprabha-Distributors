create or replace function private.stockflow_order_in_capture_range(
  p_order private.stockflow_orders, p_from date, p_to date
) returns boolean
language sql
stable
set search_path = pg_catalog, private
as $$
  select p_from is null or (
    (p_order.created_at at time zone 'Asia/Kolkata')::date >= p_from
    and (p_to is null or (p_order.created_at at time zone 'Asia/Kolkata')::date <= p_to)
  )
$$;

revoke all on function private.stockflow_order_in_capture_range(private.stockflow_orders,date,date) from public, anon, authenticated;

do $migration$
declare f text; updated text;
begin
  select pg_get_functiondef('public.stockflow_order_list_gateway(text,text,text,jsonb)'::regprocedure) into f;

  updated := replace(f, 'v_date date;', 'v_date date; v_date_to date;');
  if updated=f then raise exception 'Expected order date declaration was not found'; end if;
  f := updated;

  updated := replace(f,
    $$begin v_date := nullif(p_payload->>'date','')::date; exception when invalid_datetime_format then raise exception 'Invalid order date' using errcode='22023'; end;$$,
    $$begin
    v_date := nullif(p_payload->>'date','')::date;
    v_date_to := nullif(p_payload->>'dateTo','')::date;
  exception when invalid_datetime_format then
    raise exception 'Invalid order date' using errcode='22023';
  end;
  if v_date_to is not null and (v_date is null or v_date_to < v_date) then
    raise exception 'Invalid order date range' using errcode='22023';
  end if;$$);
  if updated=f then raise exception 'Expected order date parser was not found'; end if;
  f := updated;

  updated := replace(f,
    'private.stockflow_order_matches_filter(o,v_status,v_query,v_date)',
    'private.stockflow_order_matches_filter(o,v_status,v_query,null) and private.stockflow_order_in_capture_range(o,v_date,v_date_to)');
  if updated=f then raise exception 'Expected order list filter calls were not found'; end if;
  execute updated;
end $migration$;

revoke all on function public.stockflow_order_list_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_order_list_gateway(text,text,text,jsonb) to service_role;
