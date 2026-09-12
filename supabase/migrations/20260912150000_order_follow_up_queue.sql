alter table private.stockflow_orders
  add column follow_up_date date,
  add column follow_up_note text,
  add constraint stockflow_follow_up_complete check (
    (follow_up_date is null and follow_up_note is null)
    or (follow_up_date is not null and char_length(btrim(follow_up_note)) between 3 and 500)
  );

create index stockflow_orders_active_follow_up_idx
  on private.stockflow_orders(follow_up_date, created_at desc)
  where archived_at is null and follow_up_date is not null and status not in ('delivered','cancelled');

create or replace function public.stockflow_follow_up_gateway(
  p_gateway_key text, p_actor_email text, p_action text, p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private, extensions as $$
declare
  v_email text := lower(btrim(coalesce(p_actor_email,''))); v_role text; v_hash text;
  v_order private.stockflow_orders%rowtype; v_date date; v_note text; v_key text; v_replay jsonb; v_result jsonb;
begin
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex') <> v_hash then raise exception 'Unauthorized gateway' using errcode='42501'; end if;
  select role into v_role from public.stockflow_members where email=v_email and status='active';
  if v_role not in ('administrator','sales','operations','accounts','management') then raise exception 'Role cannot manage order follow-ups' using errcode='42501'; end if;
  if p_action not in ('set_order_follow_up','complete_order_follow_up') then raise exception 'Unsupported follow-up action' using errcode='22023'; end if;
  v_key := p_payload->>'idempotencyKey';
  v_replay := private.begin_stockflow_command(v_email,p_action,v_key,p_payload);
  if v_replay is not null then return v_replay; end if;
  select * into v_order from private.stockflow_orders where id=(p_payload->>'orderId')::uuid and archived_at is null for update;
  if not found then raise exception 'Order was not found' using errcode='22023'; end if;
  perform private.assert_stockflow_order_access(v_email,v_role,v_order.id);
  if v_order.version <> (p_payload->>'expectedVersion')::integer then raise exception 'Order has changed; refresh before trying again' using errcode='40001'; end if;
  if v_order.status in ('delivered','cancelled') then raise exception 'Closed orders cannot have active follow-ups' using errcode='22023'; end if;

  if p_action='set_order_follow_up' then
    begin v_date := (p_payload->>'followUpDate')::date; exception when others then raise exception 'Valid follow-up date is required' using errcode='22023'; end;
    v_note := btrim(coalesce(p_payload->>'followUpNote',''));
    if v_date < (now() at time zone 'Asia/Kolkata')::date or char_length(v_note) not between 3 and 500 then raise exception 'Future follow-up date and purpose are required' using errcode='22023'; end if;
  else
    if v_order.follow_up_date is null then raise exception 'Order has no active follow-up' using errcode='22023'; end if;
    v_date := null; v_note := null;
  end if;

  update private.stockflow_orders set follow_up_date=v_date,follow_up_note=v_note,version=version+1,updated_at=now(),updated_by_email=v_email where id=v_order.id;
  insert into private.stockflow_order_events(order_id,event_type,from_status,to_status,reason,actor_email,actor_role,metadata)
  values(v_order.id,case when p_action='set_order_follow_up' then 'order_follow_up_set' else 'order_follow_up_completed' end,v_order.status,v_order.status,
    case when p_action='set_order_follow_up' then v_note else v_order.follow_up_note end,v_email,v_role,
    jsonb_build_object('beforeDate',v_order.follow_up_date,'afterDate',v_date,'requestId',v_key));
  v_result := jsonb_build_object('ok',true,'orderId',v_order.id,'status',v_order.status,'followUpDate',v_date,'followUpNote',v_note,'version',v_order.version+1);
  perform private.finish_stockflow_command(v_email,p_action,v_key,p_payload,v_order.id,v_result);
  return v_result;
end $$;

revoke all on function public.stockflow_follow_up_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_follow_up_gateway(text,text,text,jsonb) to service_role;

do $migration$
declare f text; updated text;
begin
  select pg_get_functiondef('private.stockflow_order_matches_filter(private.stockflow_orders,text,text,date)'::regprocedure) into f;
  updated := replace(f, $old$when 'delivery_due_today' then$old$,
    $new$when 'follow_up_due' then p_order.status not in ('delivered','cancelled') and p_order.follow_up_date <= (now() at time zone 'Asia/Kolkata')::date
    when 'follow_up_upcoming' then p_order.status not in ('delivered','cancelled') and p_order.follow_up_date > (now() at time zone 'Asia/Kolkata')::date
    when 'delivery_due_today' then$new$);
  if updated=f then raise exception 'Expected delivery filter seam was not found'; end if;
  execute updated;

  select pg_get_functiondef('public.stockflow_order_list_gateway(text,text,text,jsonb)'::regprocedure) into f;
  updated := replace(f, $old$'billing_candidates', 'delivery_attention'$old$, $new$'billing_candidates', 'follow_up_due', 'follow_up_upcoming', 'delivery_attention'$new$);
  if updated=f then updated := replace(f, $old$'billing_candidates','delivery_attention'$old$, $new$'billing_candidates','follow_up_due','follow_up_upcoming','delivery_attention'$new$); end if;
  if updated=f then raise exception 'Expected list status allowlist was not found'; end if;
  f := updated;
  updated := replace(f, $old$'assignedToEmail', o.assigned_to_email, 'source'$old$, $new$'assignedToEmail', o.assigned_to_email, 'followUpDate', o.follow_up_date, 'followUpNote', o.follow_up_note, 'source'$new$);
  if updated=f then updated := replace(f, $old$'assignedToEmail',o.assigned_to_email,'source'$old$, $new$'assignedToEmail',o.assigned_to_email,'followUpDate',o.follow_up_date,'followUpNote',o.follow_up_note,'source'$new$); end if;
  if updated=f then raise exception 'Expected order list projection was not found'; end if;
  execute updated;

  select pg_get_functiondef('public.stockflow_order_gateway(text,text,text,jsonb)'::regprocedure) into f;
  updated := replace(f, 'x.assigned_to_email as "assignedToEmail", x.source,', 'x.assigned_to_email as "assignedToEmail", x.follow_up_date as "followUpDate", x.follow_up_note as "followUpNote", x.source,');
  if updated=f then raise exception 'Expected bootstrap order projection was not found'; end if;
  execute updated;

  select pg_get_functiondef('private.stockflow_operations_summary(text,text)'::regprocedure) into f;
  updated := replace(f, $old$'needsAttention', counts.needs_attention,
    'delayedFailedDeliveries'$old$, $new$'needsAttention', counts.needs_attention,
    'followUpsDue', (select count(*) from accessible due where due.status not in ('delivered','cancelled') and due.follow_up_date <= (now() at time zone 'Asia/Kolkata')::date),
    'delayedFailedDeliveries'$new$);
  if updated=f then raise exception 'Expected operations summary projection was not found'; end if;
  execute updated;
end $migration$;

revoke all on function private.stockflow_order_matches_filter(private.stockflow_orders,text,text,date) from public, anon, authenticated;
revoke all on function public.stockflow_order_list_gateway(text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.stockflow_order_gateway(text,text,text,jsonb) from public, anon, authenticated;
revoke all on function private.stockflow_operations_summary(text,text) from public, anon, authenticated;
grant execute on function public.stockflow_order_list_gateway(text,text,text,jsonb) to service_role;
grant execute on function public.stockflow_order_gateway(text,text,text,jsonb) to service_role;
