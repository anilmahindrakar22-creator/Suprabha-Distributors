do $migration$
declare f text; updated text;
begin
  select pg_get_functiondef('public.stockflow_order_gateway(text,text,text,jsonb)'::regprocedure) into f;
  updated := replace(f,
    'customer_id, customer_name, customer_phone, source, notes, priority, expected_delivery_date,',
    'customer_id, customer_name, customer_phone, source, notes, priority, delivery_address, expected_delivery_date,');
  if updated=f then raise exception 'Expected order insert columns were not found'; end if;
  f := updated;
  updated := replace(f,
    $old$coalesce(nullif(p_payload->>'priority',''),'normal'),
      nullif(p_payload->>'expectedDeliveryDate','')::date,$old$,
    $new$coalesce(nullif(p_payload->>'priority',''),'normal'),
      nullif(btrim(coalesce(p_payload->>'deliveryAddress','')), ''),
      nullif(p_payload->>'expectedDeliveryDate','')::date,$new$);
  if updated=f then raise exception 'Expected order insert values were not found'; end if;
  execute updated;
end $migration$;

revoke all on function public.stockflow_order_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_order_gateway(text,text,text,jsonb) to service_role;
