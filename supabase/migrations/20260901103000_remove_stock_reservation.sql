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
    $old$if p_action not in ('bootstrap', 'create_order', 'transition_order', 'reserve_order') then$old$,
    $new$if p_action not in ('bootstrap', 'create_order', 'transition_order') then$new$
  );

  if v_updated_sql = v_function_sql then
    raise exception 'Expected reservation action allowlist was not found';
  end if;

  v_function_sql := v_updated_sql;
  v_updated_sql := replace(
    v_function_sql,
    $old$(v_from_status = 'awaiting_approval' and v_to_status in ('confirmed', 'cancelled')) or$old$,
    $new$(v_from_status = 'awaiting_approval' and v_to_status in ('confirmed', 'cancelled')) or
    (v_from_status = 'confirmed' and v_to_status in ('packed', 'cancelled')) or$new$
  );

  if v_updated_sql = v_function_sql then
    raise exception 'Expected confirmed-order transition was not found';
  end if;

  execute v_updated_sql;
end;
$$;

update private.stockflow_reservations
set active = false,
    released_at = now(),
    released_reason = 'Stock reservation feature removed'
where active;

update private.stockflow_order_lines
set reserved_quantity = 0
where reserved_quantity <> 0;

revoke all on function public.stockflow_order_gateway(text, text, text, jsonb)
from public, anon, authenticated;
grant execute on function public.stockflow_order_gateway(text, text, text, jsonb)
to service_role;
