alter table private.stockflow_orders
  add column delivery_address text,
  add column expected_delivery_date date,
  add column courier_name text,
  add column tracking_number text;

alter table private.stockflow_order_lines
  add column fulfilled_quantity numeric(14,3) not null default 0 check (fulfilled_quantity >= 0 and fulfilled_quantity <= quantity),
  add column batch_number text,
  add column expiry_date date;

create or replace function public.stockflow_fulfilment_gateway(
  p_gateway_key text, p_actor_email text, p_action text, p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private, extensions as $$
declare
  v_email text := lower(btrim(coalesce(p_actor_email, '')));
  v_role text; v_hash text; v_order private.stockflow_orders%rowtype; v_line jsonb; v_count integer := 0;
begin
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name = 'orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key, ''), 'sha256'), 'hex') <> v_hash then raise exception 'Unauthorized gateway' using errcode = '42501'; end if;
  select role into v_role from public.stockflow_members where email = v_email and status = 'active';
  if v_role not in ('administrator','sales','operations','warehouse','accounts','management') then raise exception 'Role cannot update fulfilment' using errcode = '42501'; end if;
  if p_action <> 'save_fulfilment' then raise exception 'Unsupported fulfilment action' using errcode = '22023'; end if;
  select * into v_order from private.stockflow_orders where id = (p_payload->>'orderId')::uuid for update;
  if not found or v_order.status in ('cancelled','delivered') then raise exception 'Order cannot be edited' using errcode = '22023'; end if;
  if v_order.version <> (p_payload->>'expectedVersion')::integer then raise exception 'Order has changed; refresh before trying again' using errcode = '40001'; end if;
  if jsonb_typeof(p_payload->'lines') <> 'array' then raise exception 'Fulfilment lines are required' using errcode = '22023'; end if;
  for v_line in select value from jsonb_array_elements(p_payload->'lines') loop
    update private.stockflow_order_lines set
      fulfilled_quantity = (v_line->>'fulfilledQuantity')::numeric,
      batch_number = nullif(btrim(coalesce(v_line->>'batchNumber','')), ''),
      expiry_date = nullif(v_line->>'expiryDate','')::date
    where order_id = v_order.id and tally_item_key = v_line->>'tallyKey';
    if not found then raise exception 'Order line was not found' using errcode = '22023'; end if;
    v_count := v_count + 1;
  end loop;
  update private.stockflow_orders set
    delivery_address = nullif(btrim(coalesce(p_payload->>'deliveryAddress','')), ''),
    expected_delivery_date = nullif(p_payload->>'expectedDeliveryDate','')::date,
    courier_name = nullif(btrim(coalesce(p_payload->>'courierName','')), ''),
    tracking_number = nullif(btrim(coalesce(p_payload->>'trackingNumber','')), ''),
    version = version + 1, updated_by_email = v_email, updated_at = now()
  where id = v_order.id;
  insert into private.stockflow_order_events(order_id,event_type,from_status,to_status,actor_email,actor_role,metadata)
  values(v_order.id,'fulfilment_updated',v_order.status,v_order.status,v_email,v_role,jsonb_build_object('linesUpdated',v_count));
  return jsonb_build_object('ok',true,'orderId',v_order.id,'version',v_order.version + 1);
end $$;

revoke all on function public.stockflow_fulfilment_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_fulfilment_gateway(text,text,text,jsonb) to service_role;

do $$ declare f text; n text; begin
  select pg_get_functiondef('public.stockflow_order_gateway(text,text,text,jsonb)'::regprocedure) into f;
  n := replace(f,
    $o$x.tally_invoice_number as "tallyInvoiceNumber",$o$,
    $n$x.tally_invoice_number as "tallyInvoiceNumber",
            x.delivery_address as "deliveryAddress", x.expected_delivery_date as "expectedDeliveryDate",
            x.courier_name as "courierName", x.tracking_number as "trackingNumber",$n$);
  n := replace(n,
    $o$'reservedQuantity', detail.reserved_quantity$o$,
    $n$'reservedQuantity', detail.reserved_quantity,
                'fulfilledQuantity', detail.fulfilled_quantity, 'batchNumber', detail.batch_number,
                'expiryDate', detail.expiry_date$n$);
  if n = f then raise exception 'Bootstrap projection could not be extended'; end if;
  execute n;
end $$;
revoke all on function public.stockflow_order_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_order_gateway(text,text,text,jsonb) to service_role;
