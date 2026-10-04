-- Test-only combined assignment; singleton activation gate is restored by rollback.
begin;
alter table public.stockflow_members drop constraint stockflow_members_roles_pending_union;
insert into public.stockflow_members(email,role,status) values('combined-orders@test.local','sales','active');
insert into public.stockflow_members(email,role,status) values('combined-capture@test.local','warehouse','active');
update public.stockflow_members set roles=array['sales','warehouse'] where email='combined-orders@test.local';
update public.stockflow_members set roles=array['sales','warehouse'] where email='combined-capture@test.local';
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('combined-order-test-key','sha256'),'hex') where name='orders';
insert into public.stockflow_snapshots(id,company,fetched_at,payload)
values('suprabha','COMBINED TEST',now()::text,
  '{"catalog":[{"tallyKey":"COMBINED-CAPTURE","item":"Combined reagent","group":"Test","baseUnit":"Nos","closing":10}]}'::jsonb)
on conflict(id) do update set payload=excluded.payload;
insert into private.stockflow_orders(id,customer_name,status,idempotency_key,created_by_email,updated_by_email)
values('40000000-0000-4000-8000-000000000001','Combined test','confirmed','combined-test-seed','other@test.local','test');
do $$
declare result jsonb; replay jsonb; payload jsonb; before_events integer;
begin
  payload:=jsonb_build_object('customerName','Combined capture test','source','phone',
    'idempotencyKey','combined-capture-command',
    'lines',jsonb_build_array(jsonb_build_object('tallyKey','COMBINED-CAPTURE','quantity',1)));
  result:=public.stockflow_order_gateway('combined-order-test-key','combined-capture@test.local','create_order',payload);
  replay:=public.stockflow_order_gateway('combined-order-test-key','combined-capture@test.local','create_order',payload);
  if result->>'orderId' is null or replay->>'orderId'<>result->>'orderId' or replay->>'duplicate'<>'true' then
    raise exception 'Combined creation/replay failed';
  end if;
  if (select count(*) from private.stockflow_order_events where order_id=(result->>'orderId')::uuid)<>1
    or not exists(select 1 from private.stockflow_order_events where order_id=(result->>'orderId')::uuid
      and actor_role='warehouse' and metadata->'assignedRoles'='["sales","warehouse"]'::jsonb) then
    raise exception 'Creation role-set audit/replay failed';
  end if;
  payload:=jsonb_build_object('orderId','40000000-0000-4000-8000-000000000001',
    'expectedVersion',1,'toStatus','packed','idempotencyKey','combined-order-pack-command');
  -- Payload cannot impersonate administrator despite a valid operational account.
  begin
    perform public.stockflow_order_gateway('combined-order-test-key','combined-orders@test.local','transition_order',
      payload||jsonb_build_object('toStatus','cancelled','reason','test','role','administrator',
        'roles',jsonb_build_array('administrator'),'idempotencyKey','combined-order-cancel-command'));
    raise exception 'Payload escalated roles';
  exception when insufficient_privilege then null; end;
  if (select status from private.stockflow_orders where id='40000000-0000-4000-8000-000000000001')<>'confirmed' then
    raise exception 'Denied command mutated order';
  end if;
  result:=public.stockflow_order_gateway('combined-order-test-key','combined-orders@test.local','transition_order',payload);
  if result->>'status'<>'packed' then raise exception 'Warehouse permission was not combined'; end if;
  if not exists(select 1 from private.stockflow_order_events
    where order_id='40000000-0000-4000-8000-000000000001' and event_type='status_changed'
      and actor_email='combined-orders@test.local' and actor_role='sales'
      and metadata->'assignedRoles'='["sales","warehouse"]'::jsonb) then
    raise exception 'Actual assigned roles missing from immutable audit';
  end if;
  select count(*) into before_events from private.stockflow_order_events where order_id='40000000-0000-4000-8000-000000000001';
  replay:=public.stockflow_order_gateway('combined-order-test-key','combined-orders@test.local','transition_order',payload);
  if replay is distinct from result or before_events<>(select count(*) from private.stockflow_order_events where order_id='40000000-0000-4000-8000-000000000001') then
    raise exception 'Replay changed result or duplicated audit';
  end if;
  begin
    perform public.stockflow_order_gateway('combined-order-test-key','combined-orders@test.local','transition_order',
      payload||jsonb_build_object('toStatus','awaiting_tally_billing','idempotencyKey','combined-order-stale-command'));
    raise exception 'Stale version accepted';
  exception when sqlstate 'PT409' then null; end;
  update public.stockflow_members set status='suspended' where email='combined-orders@test.local';
  begin
    perform public.stockflow_order_gateway('combined-order-test-key','combined-orders@test.local','transition_order',payload);
    raise exception 'Suspension bypassed on replay';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
