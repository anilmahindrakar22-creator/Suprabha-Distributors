begin;
alter table public.stockflow_members drop constraint stockflow_members_roles_pending_union;
insert into public.stockflow_members(email,role,status) values('combined-ops@test.local','viewer','active'),('combined-warehouse@test.local','warehouse','active');
update public.stockflow_members set roles=array['operations','viewer'] where email='combined-ops@test.local';
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('combined-ops-key','sha256'),'hex') where name='orders';
insert into private.stockflow_orders(id,customer_name,status,idempotency_key,created_by_email,updated_by_email)
values('60000000-0000-4000-8000-000000000001','Combined ops','awaiting_confirmation','combined-ops-seed','other@test.local','test');
do $$
declare result jsonb; payload jsonb; before_count integer;
begin
  payload:=jsonb_build_object('orderId','60000000-0000-4000-8000-000000000001','expectedVersion',1,
    'idempotencyKey','combined-priority-command','priority','urgent');
  result:=public.stockflow_priority_gateway('combined-ops-key','combined-ops@test.local','set_order_priority',payload);
  if result->>'version'<>'2' then raise exception 'Secondary priority permission failed'; end if;
  if public.stockflow_priority_gateway('combined-ops-key','combined-ops@test.local','set_order_priority',payload) is distinct from result then raise exception 'Priority replay failed'; end if;
  result:=public.stockflow_assignment_gateway('combined-ops-key','combined-ops@test.local','set_order_assignee',
    payload||jsonb_build_object('expectedVersion',2,'idempotencyKey','combined-assignment-command','assignedToEmail','combined-warehouse@test.local'));
  if result->>'version'<>'3' then raise exception 'Secondary assignment permission failed'; end if;
  result:=public.stockflow_order_note_gateway('combined-ops-key','combined-ops@test.local','add_order_note',
    payload||jsonb_build_object('expectedVersion',3,'idempotencyKey','combined-note-command','note','Combined operations test'));
  if result->>'version'<>'4' then raise exception 'Secondary note permission failed'; end if;
  result:=public.stockflow_follow_up_gateway('combined-ops-key','combined-ops@test.local','set_order_follow_up',
    payload||jsonb_build_object('expectedVersion',4,'idempotencyKey','combined-followup-command',
      'followUpDate',current_date+1,'followUpNote','Combined followup test'));
  if result->>'version'<>'5' then raise exception 'Secondary follow-up permission failed'; end if;
  select count(*) into before_count from private.stockflow_order_events
    where order_id='60000000-0000-4000-8000-000000000001' and metadata->'assignedRoles'='["operations","viewer"]'::jsonb;
  if before_count<>4 then raise exception 'Operational role-set audits missing'; end if;
  begin
    perform public.stockflow_assignment_gateway('combined-ops-key','combined-warehouse@test.local','set_order_assignee',
      payload||jsonb_build_object('expectedVersion',5,'idempotencyKey','combined-forged-assignment','roles',jsonb_build_array('administrator')));
    raise exception 'Warehouse assigned an order by forging roles';
  exception when insufficient_privilege then null; end;
  begin
    perform public.stockflow_priority_gateway('combined-ops-key','combined-ops@test.local','set_order_priority',
      payload||jsonb_build_object('idempotencyKey','combined-stale-priority'));
    raise exception 'Stale priority accepted';
  exception when serialization_failure or sqlstate 'PT409' then null; end;
  update public.stockflow_members set status='suspended' where email='combined-ops@test.local';
  begin
    perform public.stockflow_priority_gateway('combined-ops-key','combined-ops@test.local','set_order_priority',payload);
    raise exception 'Suspended priority replay accepted';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
