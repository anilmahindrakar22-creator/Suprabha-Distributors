do $$
declare
  v_function_sql text;
  v_updated_sql text;
begin
  select pg_get_functiondef(
    'public.stockflow_order_gateway(text,text,text,jsonb)'::regprocedure
  ) into v_function_sql;

  v_updated_sql := replace(
    v_function_sql,
    'from private.stockflow_customers where active order by name limit 200',
    'from private.stockflow_customers where active order by name limit 1000'
  );

  if v_updated_sql = v_function_sql then
    raise exception 'Expected customer directory limit was not found';
  end if;

  execute v_updated_sql;
end;
$$;

revoke all on function public.stockflow_order_gateway(text, text, text, jsonb)
from public, anon, authenticated;
grant execute on function public.stockflow_order_gateway(text, text, text, jsonb)
to service_role;
