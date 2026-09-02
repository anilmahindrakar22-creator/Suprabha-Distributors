alter table private.stockflow_role_permissions
drop constraint stockflow_role_permissions_permission_check;
alter table private.stockflow_role_permissions
add constraint stockflow_role_permissions_permission_check check (permission in (
  'orders.create','orders.transition','inventory.view','inventory.receive','inventory.adjust','inventory.allocate'
));
insert into private.stockflow_role_permissions(role,permission) values
  ('administrator','inventory.allocate'),('operations','inventory.allocate'),('warehouse','inventory.allocate')
on conflict do nothing;

insert into private.stockflow_order_transition_rules(from_status,to_status,allowed_roles) values
  ('confirmed','partially_reserved',array['administrator','operations','warehouse']),
  ('confirmed','fully_reserved',array['administrator','operations','warehouse']),
  ('partially_reserved','fully_reserved',array['administrator','operations','warehouse']),
  ('partially_reserved','confirmed',array['administrator','operations','warehouse']),
  ('fully_reserved','confirmed',array['administrator','operations','warehouse'])
on conflict do nothing;

create or replace function private.stockflow_inventory_order_snapshot(p_order_id uuid)
returns jsonb
language sql
stable
set search_path=pg_catalog,private
as $$
  select jsonb_build_object(
    'status',o.status,'version',o.version,
    'lines',coalesce((select jsonb_agg(jsonb_build_object(
      'tallyKey',l.tally_item_key,'quantity',l.quantity,'reservedQuantity',l.reserved_quantity
    ) order by l.tally_item_key) from private.stockflow_order_lines l where l.order_id=o.id),'[]'::jsonb)
  ) from private.stockflow_orders o where o.id=p_order_id
$$;

create or replace function private.stockflow_release_order_inventory(
  p_order_id uuid,p_actor_email text,p_actor_role text,p_request_id text
) returns jsonb
language plpgsql
set search_path=pg_catalog,private
as $$
declare
  allocation record; v_released numeric(14,3):=0;
begin
  for allocation in
    select m.product_id,m.batch_id,m.location_id,m.order_line_id,sum(m.reserved_delta)::numeric(14,3) quantity
    from private.stockflow_inventory_movements m
    where m.order_id=p_order_id
    group by m.product_id,m.batch_id,m.location_id,m.order_line_id
    having sum(m.reserved_delta)>0
    order by m.product_id,m.batch_id,m.location_id
  loop
    perform pg_advisory_xact_lock(hashtextextended(allocation.product_id::text,0));
    insert into private.stockflow_inventory_movements(
      product_id,batch_id,location_id,order_id,order_line_id,movement_type,reserved_delta,
      reason,actor_email,actor_role,request_id,metadata
    ) values(
      allocation.product_id,allocation.batch_id,allocation.location_id,p_order_id,allocation.order_line_id,
      'reservation_release',-allocation.quantity,'Order allocation released',lower(btrim(p_actor_email)),
      coalesce(p_actor_role,'system'),p_request_id,jsonb_build_object('released',allocation.quantity)
    );
    v_released:=v_released+allocation.quantity;
  end loop;
  update private.stockflow_order_lines set reserved_quantity=0 where order_id=p_order_id and reserved_quantity<>0;
  return jsonb_build_object('releasedQuantity',v_released);
end;
$$;

revoke all on function private.stockflow_inventory_order_snapshot(uuid) from public,anon,authenticated;
revoke all on function private.stockflow_release_order_inventory(uuid,text,text,text) from public,anon,authenticated;

create or replace function public.stockflow_allocation_gateway(
  p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public,private,extensions
as $$
declare
  v_email text:=lower(btrim(coalesce(p_actor_email,''))); v_role text; v_hash text;
  v_request_id text; v_replayed jsonb; v_result jsonb; v_before jsonb; v_after jsonb;
  v_order private.stockflow_orders%rowtype; v_line private.stockflow_order_lines%rowtype;
  v_balance record; v_remaining numeric(14,3); v_allocate numeric(14,3); v_allocated numeric(14,3):=0;
  v_total_lines integer; v_full_lines integer; v_target_status text; v_reason text;
begin
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_hash then
    raise exception 'Unauthorized gateway' using errcode='42501';
  end if;
  select role into v_role from public.stockflow_members where email=v_email and status='active';
  perform private.assert_stockflow_permission(v_role,'inventory.allocate');
  if p_action not in ('allocate_order','release_order') then raise exception 'Unsupported allocation action' using errcode='22023'; end if;
  v_request_id:=p_payload->>'idempotencyKey';
  v_replayed:=private.begin_stockflow_command(v_email,p_action,v_request_id,p_payload);
  if v_replayed is not null then return v_replayed; end if;

  select * into v_order from private.stockflow_orders where id=(p_payload->>'orderId')::uuid for update;
  if not found then raise exception 'Order was not found' using errcode='22023'; end if;
  perform private.assert_stockflow_order_access(v_email,v_role,v_order.id);
  if v_order.version<>(p_payload->>'expectedVersion')::integer then
    raise exception 'Order has changed; refresh before trying again' using errcode='40001';
  end if;
  v_before:=private.stockflow_inventory_order_snapshot(v_order.id);

  if p_action='release_order' then
    if v_order.status not in ('confirmed','partially_reserved','fully_reserved') then
      raise exception 'Only allocated or confirmed orders can release stock' using errcode='22023';
    end if;
    v_reason:=nullif(btrim(coalesce(p_payload->>'reason','')),'');
    if v_reason is null then raise exception 'Release reason is required' using errcode='22023'; end if;
    perform private.stockflow_release_order_inventory(v_order.id,v_email,v_role,v_request_id);
    if v_order.status<>'confirmed' then
      update private.stockflow_orders set status='confirmed',version=version+1,updated_by_email=v_email,updated_at=now() where id=v_order.id;
    else
      update private.stockflow_orders set version=version+1,updated_by_email=v_email,updated_at=now() where id=v_order.id;
    end if;
    v_target_status:='confirmed';
  else
    if v_order.status not in ('confirmed','partially_reserved') then
      raise exception 'Only confirmed or partially allocated orders can allocate stock' using errcode='22023';
    end if;
    for v_line in select * from private.stockflow_order_lines where order_id=v_order.id order by tally_item_key loop
      v_remaining:=v_line.quantity-v_line.reserved_quantity;
      if v_remaining<=0 then continue; end if;
      perform pg_advisory_xact_lock(hashtextextended(v_line.tally_item_key,0));
      for v_balance in
        select ib.* from private.stockflow_inventory_balances ib
        where ib.tally_item_key=v_line.tally_item_key and ib.available>0
          and (ib.expiry_date is null or ib.expiry_date>=current_date)
        order by ib.expiry_date asc nulls last, ib.lot_number, ib.location_id
      loop
        exit when v_remaining<=0;
        v_allocate:=least(v_remaining,v_balance.available);
        insert into private.stockflow_inventory_movements(
          product_id,batch_id,location_id,order_id,order_line_id,movement_type,reserved_delta,
          actor_email,actor_role,request_id,metadata
        ) values(
          v_balance.product_id,v_balance.batch_id,v_balance.location_id,v_order.id,v_line.id,
          'reservation',v_allocate,v_email,v_role,v_request_id,
          jsonb_build_object('orderNumber',v_order.order_number,'quantity',v_allocate,'expiryDate',v_balance.expiry_date)
        );
        v_remaining:=v_remaining-v_allocate; v_allocated:=v_allocated+v_allocate;
      end loop;
      update private.stockflow_order_lines set reserved_quantity=quantity-v_remaining where id=v_line.id;
    end loop;
    select count(*),count(*) filter(where reserved_quantity>=quantity)
      into v_total_lines,v_full_lines from private.stockflow_order_lines where order_id=v_order.id;
    v_target_status:=case when v_full_lines=v_total_lines then 'fully_reserved' else 'partially_reserved' end;
    update private.stockflow_orders set status=v_target_status,version=version+1,updated_by_email=v_email,updated_at=now() where id=v_order.id;
  end if;

  v_after:=private.stockflow_inventory_order_snapshot(v_order.id);
  insert into private.stockflow_order_events(order_id,event_type,from_status,to_status,reason,actor_email,actor_role,metadata)
  values(v_order.id,case when p_action='allocate_order' then 'inventory_allocated' else 'inventory_released' end,
    v_order.status,v_target_status,v_reason,v_email,v_role,
    jsonb_build_object('before',v_before,'after',v_after,'requestId',v_request_id,'allocatedQuantity',v_allocated));
  v_result:=jsonb_build_object('ok',true,'orderId',v_order.id,'status',v_target_status,
    'version',v_order.version+1,'allocatedQuantity',v_allocated,'requestId',v_request_id);
  perform private.finish_stockflow_command(v_email,p_action,v_request_id,p_payload,v_order.id,v_result);
  return v_result;
end;
$$;

revoke all on function public.stockflow_allocation_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_allocation_gateway(text,text,text,jsonb) to service_role;

create or replace function private.stockflow_release_inventory_on_cancel()
returns trigger
language plpgsql
set search_path=pg_catalog,private,public
as $$
declare v_role text; v_request_id text;
begin
  if new.status='cancelled' and old.status is distinct from new.status then
    select role into v_role from public.stockflow_members where email=new.updated_by_email and status='active';
    v_request_id:='cancel-release:'||new.id::text||':'||new.version::text;
    perform private.stockflow_release_order_inventory(new.id,new.updated_by_email,coalesce(v_role,'system'),v_request_id);
  end if;
  return new;
end;
$$;

revoke all on function private.stockflow_release_inventory_on_cancel() from public,anon,authenticated;
create trigger stockflow_release_inventory_on_cancel
after update of status on private.stockflow_orders
for each row execute function private.stockflow_release_inventory_on_cancel();
