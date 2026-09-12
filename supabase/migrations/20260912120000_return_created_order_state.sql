do $$
declare
  f text;
  updated text;
begin
  select pg_get_functiondef('public.stockflow_order_gateway(text,text,text,jsonb)'::regprocedure) into f;

  updated := replace(
    f,
    '    ) returning id, order_seq into v_order_id, v_order_seq;',
    '    ) returning id, order_seq, status, version into v_order_id, v_order_seq, v_to_status, v_expected_version;'
  );
  if updated = f then
    raise exception 'Expected create-order insert return values were not found';
  end if;
  f := updated;

  updated := replace(
    f,
    $old$      'orderNumber', v_order_number, 'status', 'phone_order_received'
    );$old$,
    $new$      'orderNumber', v_order_number, 'status', v_to_status, 'version', v_expected_version
    );$new$
  );
  if updated = f then
    raise exception 'Expected hard-coded create-order response was not found';
  end if;

  execute updated;
end $$;
