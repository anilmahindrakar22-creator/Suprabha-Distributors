create or replace function private.prevent_business_delete()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'Business history cannot be hard-deleted; cancel, release, supersede, or deactivate it instead'
    using errcode = '42501';
end;
$$;

create trigger stockflow_customers_no_delete
before delete on private.stockflow_customers
for each row execute function private.prevent_business_delete();

create trigger stockflow_orders_no_delete
before delete on private.stockflow_orders
for each row execute function private.prevent_business_delete();

create trigger stockflow_order_lines_no_delete
before delete on private.stockflow_order_lines
for each row execute function private.prevent_business_delete();

create trigger stockflow_reservations_no_delete
before delete on private.stockflow_reservations
for each row execute function private.prevent_business_delete();

create trigger stockflow_delivery_exceptions_no_delete
before delete on private.stockflow_delivery_exceptions
for each row execute function private.prevent_business_delete();

create trigger stockflow_equipment_installations_no_delete
before delete on private.stockflow_equipment_installations
for each row execute function private.prevent_business_delete();

create or replace function public.stockflow_edit_gateway(
  p_gateway_key text, p_actor_email text, p_action text, p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private, extensions as $$
declare
  v_email text := lower(btrim(coalesce(p_actor_email, ''))); v_role text; v_hash text;
  v_order private.stockflow_orders%rowtype; v_line jsonb; v_reason text;
  v_before jsonb; v_after jsonb;
begin
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name = 'orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key, ''), 'sha256'), 'hex') <> v_hash then raise exception 'Unauthorized gateway' using errcode = '42501'; end if;
  select role into v_role from public.stockflow_members where email = v_email and status = 'active';
  if v_role not in ('administrator','sales','operations','management') then raise exception 'Role cannot edit orders' using errcode = '42501'; end if;
  if p_action <> 'edit_order' then raise exception 'Unsupported edit action' using errcode = '22023'; end if;
  select * into v_order from private.stockflow_orders where id = (p_payload->>'orderId')::uuid for update;
  if not found then raise exception 'Order was not found' using errcode = '22023'; end if;
  if v_order.status not in ('phone_order_received','awaiting_confirmation','awaiting_approval','confirmed','partially_reserved','fully_reserved','ready_for_picking','picked','packed') then raise exception 'Orders cannot be edited after billing begins' using errcode = '22023'; end if;
  if v_order.version <> (p_payload->>'expectedVersion')::integer then raise exception 'Order has changed; refresh before trying again' using errcode = '40001'; end if;
  v_reason := nullif(btrim(coalesce(p_payload->>'reason','')), '');
  if v_order.status not in ('phone_order_received','awaiting_confirmation','awaiting_approval') and v_reason is null then raise exception 'A change reason is required after confirmation' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_payload->>'customerName',''))) not between 2 and 160 then raise exception 'Customer name is required' using errcode = '22023'; end if;
  if jsonb_typeof(p_payload->'lines') <> 'array' or jsonb_array_length(p_payload->'lines') < 1 then raise exception 'At least one order line is required' using errcode = '22023'; end if;

  select jsonb_build_object(
    'customerName', v_order.customer_name,
    'customerPhone', v_order.customer_phone,
    'notes', v_order.notes,
    'lines', coalesce(jsonb_agg(jsonb_build_object('tallyKey', l.tally_item_key, 'quantity', l.quantity) order by l.tally_item_key), '[]'::jsonb)
  ) into v_before
  from private.stockflow_order_lines l where l.order_id = v_order.id;

  for v_line in select value from jsonb_array_elements(p_payload->'lines') loop
    update private.stockflow_order_lines set quantity = (v_line->>'quantity')::numeric
    where order_id = v_order.id and tally_item_key = v_line->>'tallyKey'
      and (v_line->>'quantity')::numeric > 0 and (v_line->>'quantity')::numeric >= fulfilled_quantity;
    if not found then raise exception 'Invalid order quantity or product' using errcode = '22023'; end if;
  end loop;
  update private.stockflow_orders set customer_name=btrim(p_payload->>'customerName'), customer_phone=nullif(btrim(coalesce(p_payload->>'customerPhone','')),''), notes=nullif(btrim(coalesce(p_payload->>'notes','')),''), version=version+1, updated_by_email=v_email, updated_at=now() where id=v_order.id;

  select jsonb_build_object(
    'customerName', o.customer_name,
    'customerPhone', o.customer_phone,
    'notes', o.notes,
    'lines', coalesce(jsonb_agg(jsonb_build_object('tallyKey', l.tally_item_key, 'quantity', l.quantity) order by l.tally_item_key), '[]'::jsonb)
  ) into v_after
  from private.stockflow_orders o
  left join private.stockflow_order_lines l on l.order_id = o.id
  where o.id = v_order.id
  group by o.id;

  insert into private.stockflow_order_events(order_id,event_type,from_status,to_status,reason,actor_email,actor_role,metadata)
  values(v_order.id,'order_edited',v_order.status,v_order.status,v_reason,v_email,v_role,jsonb_build_object('before',v_before,'after',v_after));
  return jsonb_build_object('ok',true,'orderId',v_order.id,'version',v_order.version+1);
end $$;

revoke all on function public.stockflow_edit_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_edit_gateway(text,text,text,jsonb) to service_role;
