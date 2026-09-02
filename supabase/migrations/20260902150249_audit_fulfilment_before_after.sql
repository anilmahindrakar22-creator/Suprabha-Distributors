create or replace function private.stockflow_fulfilment_snapshot(p_order_id uuid)
returns jsonb
language sql
stable
set search_path = pg_catalog, private
as $$
  select jsonb_build_object(
    'deliveryAddress', o.delivery_address,
    'expectedDeliveryDate', o.expected_delivery_date,
    'courierName', o.courier_name,
    'trackingNumber', o.tracking_number,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'tallyKey', l.tally_item_key,
        'fulfilledQuantity', l.fulfilled_quantity,
        'batchNumber', l.batch_number,
        'expiryDate', l.expiry_date
      ) order by l.tally_item_key)
      from private.stockflow_order_lines l where l.order_id=o.id
    ), '[]'::jsonb)
  )
  from private.stockflow_orders o where o.id=p_order_id
$$;

revoke all on function private.stockflow_fulfilment_snapshot(uuid) from public, anon, authenticated;

do $$
declare
  f text;
begin
  select pg_get_functiondef('public.stockflow_fulfilment_gateway(text,text,text,jsonb)'::regprocedure) into f;
  if position('v_idempotency_key text; v_replayed_result jsonb; v_command_result jsonb;' in f)=0
     or position($old$  if jsonb_typeof(p_payload->'lines')$old$ in f)=0
     or position('  insert into private.stockflow_order_events' in f)=0
     or position($old$jsonb_build_object('linesUpdated',v_count,'requestId',v_idempotency_key)$old$ in f)=0 then
    raise exception 'Expected fulfilment audit blocks were not found';
  end if;

  f := replace(f,
    'v_idempotency_key text; v_replayed_result jsonb; v_command_result jsonb;',
    $new$v_idempotency_key text; v_replayed_result jsonb; v_command_result jsonb;
  v_before jsonb; v_after jsonb;$new$);
  f := replace(f,
    $old$  if jsonb_typeof(p_payload->'lines')$old$,
    $new$  v_before := private.stockflow_fulfilment_snapshot(v_order.id);
  if jsonb_typeof(p_payload->'lines')$new$);
  f := replace(f,
    '  insert into private.stockflow_order_events',
    $new$  v_after := private.stockflow_fulfilment_snapshot(v_order.id);
  insert into private.stockflow_order_events$new$);
  f := replace(f,
    $old$jsonb_build_object('linesUpdated',v_count,'requestId',v_idempotency_key)$old$,
    $new$jsonb_build_object(
    'before',v_before,'after',v_after,'linesUpdated',v_count,'requestId',v_idempotency_key
  )$new$);
  execute f;
end;
$$;

revoke all on function public.stockflow_fulfilment_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_fulfilment_gateway(text,text,text,jsonb) to service_role;
