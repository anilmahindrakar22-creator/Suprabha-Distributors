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
    $old$  if v_role <> 'administrator' then$old$,
    $new$  if v_to_status = 'cancelled' and v_role <> 'administrator' then
    raise exception 'Only an administrator can cancel an order';
  end if;

  if v_role <> 'administrator' then$new$
  );

  if v_updated_sql = v_function_sql then
    raise exception 'Expected transition authorization block was not found';
  end if;

  execute v_updated_sql;
end;
$$;

revoke all on function public.stockflow_order_gateway(text, text, text, jsonb)
from public, anon, authenticated;
grant execute on function public.stockflow_order_gateway(text, text, text, jsonb)
to service_role;
