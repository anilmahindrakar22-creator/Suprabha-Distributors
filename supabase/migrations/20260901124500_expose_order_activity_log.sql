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
    $old$), '[]'::jsonb) as lines
          from private.stockflow_orders x$old$,
    $new$), '[]'::jsonb) as lines,
            coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', event.id,
                'eventType', event.event_type,
                'fromStatus', event.from_status,
                'toStatus', event.to_status,
                'reason', event.reason,
                'actorEmail', event.actor_email,
                'actorRole', event.actor_role,
                'metadata', event.metadata,
                'createdAt', event.created_at
              ) order by event.created_at, event.id)
              from private.stockflow_order_events event
              where event.order_id = x.id
            ), '[]'::jsonb) as events
          from private.stockflow_orders x$new$
  );

  if v_updated_sql = v_function_sql then
    raise exception 'Expected order-lines projection was not found';
  end if;

  execute v_updated_sql;
end;
$$;

revoke all on function public.stockflow_order_gateway(text, text, text, jsonb)
from public, anon, authenticated;
grant execute on function public.stockflow_order_gateway(text, text, text, jsonb)
to service_role;
