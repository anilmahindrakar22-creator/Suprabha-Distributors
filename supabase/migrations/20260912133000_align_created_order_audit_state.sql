do $$
declare
  f text;
  updated text;
begin
  select pg_get_functiondef('public.stockflow_order_gateway(text,text,text,jsonb)'::regprocedure) into f;

  updated := replace(
    f,
    $old$      v_order_id, 'order_created', 'phone_order_received', v_actor_email, v_role,$old$,
    $new$      v_order_id, 'order_created', v_to_status, v_actor_email, v_role,$new$
  );
  if updated = f then
    raise exception 'Expected hard-coded created-order audit state was not found';
  end if;

  execute updated;
end $$;
