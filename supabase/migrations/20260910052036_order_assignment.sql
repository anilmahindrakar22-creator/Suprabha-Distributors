alter table private.stockflow_orders
  add column assigned_to_email text
  check (assigned_to_email is null or (
    assigned_to_email = lower(btrim(assigned_to_email))
    and char_length(assigned_to_email) between 3 and 254
  ));

create index stockflow_orders_active_assignee_idx
  on private.stockflow_orders(assigned_to_email, updated_at desc)
  where archived_at is null and status not in ('delivered','cancelled');

create or replace function public.stockflow_assignment_gateway(
  p_gateway_key text, p_actor_email text, p_action text, p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private, extensions as $$
declare
  v_email text := lower(btrim(coalesce(p_actor_email,''))); v_role text; v_hash text;
  v_order private.stockflow_orders%rowtype; v_assignee text; v_key text; v_replay jsonb; v_result jsonb;
begin
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex') <> v_hash then raise exception 'Unauthorized gateway' using errcode='42501'; end if;
  select role into v_role from public.stockflow_members where email=v_email and status='active';
  if v_role not in ('administrator','operations','management') then raise exception 'Role cannot assign orders' using errcode='42501'; end if;
  if p_action <> 'set_order_assignee' then raise exception 'Unsupported assignment action' using errcode='22023'; end if;
  v_assignee := nullif(lower(btrim(coalesce(p_payload->>'assignedToEmail',''))),'');
  if v_assignee is not null and not exists(select 1 from public.stockflow_members where email=v_assignee and status='active') then raise exception 'Assignee must be an active StockFlow user' using errcode='22023'; end if;
  v_key := p_payload->>'idempotencyKey';
  v_replay := private.begin_stockflow_command(v_email,p_action,v_key,p_payload);
  if v_replay is not null then return v_replay; end if;
  select * into v_order from private.stockflow_orders where id=(p_payload->>'orderId')::uuid and archived_at is null for update;
  if not found then raise exception 'Order was not found' using errcode='22023'; end if;
  perform private.assert_stockflow_order_access(v_email,v_role,v_order.id);
  if v_order.version <> (p_payload->>'expectedVersion')::integer then raise exception 'Order has changed; refresh before trying again' using errcode='40001'; end if;
  if v_order.status in ('delivered','cancelled') then raise exception 'Closed orders cannot be reassigned' using errcode='22023'; end if;
  update private.stockflow_orders set assigned_to_email=v_assignee,version=version+1,updated_at=now(),updated_by_email=v_email where id=v_order.id;
  insert into private.stockflow_order_events(order_id,event_type,from_status,to_status,reason,actor_email,actor_role,metadata)
  values(v_order.id,'order_assignment_changed',v_order.status,v_order.status,null,v_email,v_role,jsonb_build_object('before',v_order.assigned_to_email,'after',v_assignee,'requestId',v_key));
  v_result := jsonb_build_object('ok',true,'orderId',v_order.id,'status',v_order.status,'assignedToEmail',v_assignee,'version',v_order.version+1);
  perform private.finish_stockflow_command(v_email,p_action,v_key,p_payload,v_order.id,v_result);
  return v_result;
end $$;

revoke all on function public.stockflow_assignment_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_assignment_gateway(text,text,text,jsonb) to service_role;

do $migration$
declare f text; updated text;
begin
  select pg_get_functiondef('private.stockflow_order_matches_filter(private.stockflow_orders,text,text,date)'::regprocedure) into f;
  updated := replace(f,
    $old$declare
  q text := lower(btrim(coalesce(p_query, '')));
  status_match boolean;$old$,
    $new$declare
  q text := lower(btrim(coalesce(p_query, '')));
  assignee text := case when q like 'assignee:%' then nullif(btrim(substr(q,10)),'') else null end;
  status_match boolean;$new$);
  if updated=f then raise exception 'Expected order filter declaration was not found'; end if;
  f := updated;
  updated := replace(f,
    $old$and (q = '' or strpos(lower(concat_ws(' ',p_order.order_number,p_order.customer_name,p_order.customer_phone,p_order.tally_invoice_number)),q) > 0$old$,
    $new$and (assignee is null or p_order.assigned_to_email=assignee)
    and (q = '' or assignee is not null or strpos(lower(concat_ws(' ',p_order.order_number,p_order.customer_name,p_order.customer_phone,p_order.tally_invoice_number,p_order.assigned_to_email)),q) > 0$new$);
  if updated=f then raise exception 'Expected order filter search was not found'; end if;
  execute updated;

  select pg_get_functiondef('public.stockflow_order_gateway(text,text,text,jsonb)'::regprocedure) into f;
  updated := replace(f, 'x.status, x.priority, x.source,', 'x.status, x.priority, x.assigned_to_email as "assignedToEmail", x.source,');
  if updated=f then raise exception 'Expected bootstrap assignment projection was not found'; end if;
  execute updated;

  select pg_get_functiondef('public.stockflow_order_list_gateway(text,text,text,jsonb)'::regprocedure) into f;
  updated := replace(f, $old$'status',o.status,'priority',o.priority,'source',o.source$old$, $new$'status',o.status,'priority',o.priority,'assignedToEmail',o.assigned_to_email,'source',o.source$new$);
  if updated=f then raise exception 'Expected list assignment projection was not found'; end if;
  f := updated;
  updated := replace(f, 'char_length(v_query) > 120', 'char_length(v_query) > 264');
  if updated=f then raise exception 'Expected order query bound was not found'; end if;
  execute updated;
end $migration$;

revoke all on function public.stockflow_order_gateway(text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.stockflow_order_list_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_order_gateway(text,text,text,jsonb) to service_role;
grant execute on function public.stockflow_order_list_gateway(text,text,text,jsonb) to service_role;
