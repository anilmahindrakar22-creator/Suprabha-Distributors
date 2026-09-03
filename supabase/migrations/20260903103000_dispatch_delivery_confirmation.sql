alter table private.stockflow_orders
  add column dispatch_date date,
  add column vehicle_number text check (vehicle_number is null or char_length(vehicle_number) <= 40),
  add column delivered_at timestamptz,
  add column received_by text check (received_by is null or char_length(received_by) between 2 and 160),
  add column pod_reference text check (pod_reference is null or char_length(pod_reference) <= 160),
  add constraint stockflow_delivery_after_dispatch check (
    delivered_at is null or dispatch_date is null or delivered_at::date >= dispatch_date
  );

create or replace function private.enforce_stockflow_delivery_evidence()
returns trigger
language plpgsql
set search_path = pg_catalog, private
as $$
begin
  if new.status = 'dispatched' and old.status is distinct from 'dispatched' then
    if new.dispatch_date is null
       or nullif(btrim(coalesce(new.courier_name, '')), '') is null
       or nullif(btrim(coalesce(new.tracking_number, '')), '') is null then
      raise exception 'Dispatch date, transporter and tracking number are required' using errcode = '22023';
    end if;
  end if;
  if new.status = 'delivered' and old.status is distinct from 'delivered' then
    if new.delivered_at is null or nullif(btrim(coalesce(new.received_by, '')), '') is null then
      raise exception 'Delivery time and receiver are required' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

create trigger stockflow_orders_delivery_evidence
before update of status on private.stockflow_orders
for each row execute function private.enforce_stockflow_delivery_evidence();

create or replace function public.stockflow_delivery_gateway(
  p_gateway_key text, p_actor_email text, p_action text, p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_email text := lower(btrim(coalesce(p_actor_email, '')));
  v_role text;
  v_hash text;
  v_order private.stockflow_orders%rowtype;
  v_idempotency_key text;
  v_replayed_result jsonb;
  v_command_result jsonb;
  v_courier text;
  v_tracking text;
  v_vehicle text;
  v_dispatch_date date;
  v_delivered_at timestamptz;
  v_received_by text;
  v_pod_reference text;
begin
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name = 'orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key, ''), 'sha256'), 'hex') <> v_hash then
    raise exception 'Unauthorized gateway' using errcode = '42501';
  end if;
  select role into v_role from public.stockflow_members where email = v_email and status = 'active';
  if v_role not in ('administrator','operations') then
    raise exception 'Role cannot manage dispatch and delivery' using errcode = '42501';
  end if;
  if p_action not in ('save_dispatch','confirm_delivery') then
    raise exception 'Unsupported delivery action' using errcode = '22023';
  end if;

  v_idempotency_key := p_payload->>'idempotencyKey';
  perform private.assert_stockflow_order_access(v_email,v_role,(p_payload->>'orderId')::uuid);
  v_replayed_result := private.begin_stockflow_command(v_email,p_action,v_idempotency_key,p_payload);
  if v_replayed_result is not null then return v_replayed_result; end if;

  select * into v_order from private.stockflow_orders
  where id=(p_payload->>'orderId')::uuid for update;
  if not found then raise exception 'Order was not found' using errcode = '22023'; end if;
  if v_order.version <> (p_payload->>'expectedVersion')::integer then
    raise exception 'Order has changed; refresh before trying again' using errcode = '40001';
  end if;

  if p_action = 'save_dispatch' then
    if v_order.status <> 'ready_for_dispatch' then
      raise exception 'Only an order ready for dispatch can be dispatched' using errcode = '22023';
    end if;
    v_courier := nullif(btrim(coalesce(p_payload->>'courierName','')), '');
    v_tracking := nullif(btrim(coalesce(p_payload->>'trackingNumber','')), '');
    v_vehicle := nullif(upper(btrim(coalesce(p_payload->>'vehicleNumber',''))), '');
    v_dispatch_date := nullif(p_payload->>'dispatchDate','')::date;
    if char_length(coalesce(v_courier,'')) not between 2 and 160
       or char_length(coalesce(v_tracking,'')) not between 2 and 160
       or v_dispatch_date is null or v_dispatch_date > current_date then
      raise exception 'Valid dispatch date, transporter and tracking number are required' using errcode = '22023';
    end if;
    update private.stockflow_orders
    set courier_name=v_courier, tracking_number=v_tracking, dispatch_date=v_dispatch_date,
        vehicle_number=v_vehicle, status='dispatched', version=version+1,
        updated_by_email=v_email, updated_at=now()
    where id=v_order.id;
    insert into private.stockflow_order_events(order_id,event_type,from_status,to_status,actor_email,actor_role,metadata)
    values(v_order.id,'order_dispatched',v_order.status,'dispatched',v_email,v_role,
      jsonb_build_object('courierName',v_courier,'trackingNumber',v_tracking,'dispatchDate',v_dispatch_date,'vehicleNumber',v_vehicle,'requestId',v_idempotency_key));
    insert into private.stockflow_outbox(topic,aggregate_id,payload)
    values('order.dispatched',v_order.id,jsonb_build_object('trackingNumber',v_tracking,'requestId',v_idempotency_key));
  else
    if v_order.status <> 'dispatched' then
      raise exception 'Only a dispatched order can be confirmed delivered' using errcode = '22023';
    end if;
    v_delivered_at := nullif(p_payload->>'deliveredAt','')::timestamptz;
    v_received_by := nullif(btrim(coalesce(p_payload->>'receivedBy','')), '');
    v_pod_reference := nullif(btrim(coalesce(p_payload->>'podReference','')), '');
    if v_delivered_at is null or v_delivered_at > now() + interval '5 minutes'
       or char_length(coalesce(v_received_by,'')) not between 2 and 160 then
      raise exception 'Valid delivery time and receiver are required' using errcode = '22023';
    end if;
    update private.stockflow_orders
    set delivered_at=v_delivered_at, received_by=v_received_by, pod_reference=v_pod_reference,
        status='delivered', version=version+1, updated_by_email=v_email, updated_at=now()
    where id=v_order.id;
    insert into private.stockflow_order_events(order_id,event_type,from_status,to_status,actor_email,actor_role,metadata)
    values(v_order.id,'delivery_confirmed',v_order.status,'delivered',v_email,v_role,
      jsonb_build_object('deliveredAt',v_delivered_at,'receivedBy',v_received_by,'podReference',v_pod_reference,'requestId',v_idempotency_key));
    insert into private.stockflow_outbox(topic,aggregate_id,payload)
    values('order.delivered',v_order.id,jsonb_build_object('deliveredAt',v_delivered_at,'requestId',v_idempotency_key));
  end if;

  v_command_result := jsonb_build_object(
    'ok',true,'orderId',v_order.id,
    'status',case when p_action='save_dispatch' then 'dispatched' else 'delivered' end,
    'version',v_order.version+1
  );
  perform private.finish_stockflow_command(v_email,p_action,v_idempotency_key,p_payload,v_order.id,v_command_result);
  return v_command_result;
end;
$$;

revoke all on function public.stockflow_delivery_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_delivery_gateway(text,text,text,jsonb) to service_role;

do $$
declare
  f text;
  updated text;
begin
  select pg_get_functiondef('public.stockflow_order_gateway(text,text,text,jsonb)'::regprocedure) into f;
  updated := replace(f,
    $old$            x.courier_name as "courierName", x.tracking_number as "trackingNumber",$old$,
    $new$            x.courier_name as "courierName", x.tracking_number as "trackingNumber",
            x.dispatch_date as "dispatchDate", x.vehicle_number as "vehicleNumber",
            x.delivered_at as "deliveredAt", x.received_by as "receivedBy",
            x.pod_reference as "podReference",$new$);
  if updated=f then raise exception 'Expected order delivery projection was not found'; end if;
  execute updated;
end;
$$;

revoke all on function public.stockflow_order_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_order_gateway(text,text,text,jsonb) to service_role;
