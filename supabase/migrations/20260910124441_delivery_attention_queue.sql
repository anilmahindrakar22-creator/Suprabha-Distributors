do $migration$
declare f text; updated text;
begin
  select pg_get_functiondef('private.stockflow_order_matches_filter(private.stockflow_orders,text,text,date)'::regprocedure) into f;
  updated := replace(f,
    $old$    when 'overdue' then p_order.status not in ('delivered','cancelled') and p_order.expected_delivery_date < current_date$old$,
    $new$    when 'delivery_attention' then p_order.status not in ('delivered','cancelled') and (
      p_order.expected_delivery_date <= current_date
      or exists(select 1 from private.stockflow_delivery_exceptions issue where issue.order_id=p_order.id and issue.status='open' and issue.category in ('delayed','failed_delivery'))
    )
    when 'overdue' then p_order.status not in ('delivered','cancelled') and p_order.expected_delivery_date < current_date$new$);
  if updated=f then raise exception 'Expected overdue filter was not found'; end if;
  execute updated;

  select pg_get_functiondef('public.stockflow_order_list_gateway(text,text,text,jsonb)'::regprocedure) into f;
  updated := replace(f,
    $old$'all','open','history','billing','picking','dispatch_ready','overdue','attention'$old$,
    $new$'all','open','history','billing','picking','dispatch_ready','delivery_attention','overdue','attention'$new$);
  if updated=f then raise exception 'Expected order status allowlist was not found'; end if;
  execute updated;
end $migration$;

create or replace function private.stockflow_operations_summary(p_actor_email text, p_role text)
returns jsonb
language sql
stable
set search_path = pg_catalog, private
as $$
  select jsonb_build_object(
    'phoneOrdersToday', (select count(*) from private.stockflow_orders o where private.stockflow_can_access_order(p_actor_email,p_role,o.id) and o.created_at >= date_trunc('day', now()) and o.source='phone'),
    'awaitingConfirmation', (select count(*) from private.stockflow_orders o where private.stockflow_can_access_order(p_actor_email,p_role,o.id) and o.status='awaiting_confirmation'),
    'awaitingApproval', (select count(*) from private.stockflow_orders o where private.stockflow_can_access_order(p_actor_email,p_role,o.id) and o.status='awaiting_approval'),
    'awaitingStock', (select count(*) from private.stockflow_orders o where private.stockflow_can_access_order(p_actor_email,p_role,o.id) and o.status='partially_reserved'),
    'readyForPicking', (select count(*) from private.stockflow_orders o where private.stockflow_can_access_order(p_actor_email,p_role,o.id) and o.status in ('fully_reserved','ready_for_picking')),
    'packed', (select count(*) from private.stockflow_orders o where private.stockflow_can_access_order(p_actor_email,p_role,o.id) and o.status='packed'),
    'awaitingTallyBilling', (select count(*) from private.stockflow_orders o where private.stockflow_can_access_order(p_actor_email,p_role,o.id) and o.status='awaiting_tally_billing'),
    'billedNotDispatched', (select count(*) from private.stockflow_orders o where private.stockflow_can_access_order(p_actor_email,p_role,o.id) and o.status in ('billed_in_tally','ready_for_dispatch')),
    'dispatchedToday', (select count(*) from private.stockflow_order_events e join private.stockflow_orders o on o.id=e.order_id where private.stockflow_can_access_order(p_actor_email,p_role,o.id) and e.to_status='dispatched' and e.created_at >= date_trunc('day',now())),
    'urgentExceptions', (select count(*) from private.stockflow_orders o where private.stockflow_can_access_order(p_actor_email,p_role,o.id) and o.status in ('awaiting_approval','partially_reserved') and o.updated_at < now()-interval '24 hours'),
    'unassignedOpen', (select count(*) from private.stockflow_orders o where o.archived_at is null and private.stockflow_can_access_order(p_actor_email,p_role,o.id) and o.assigned_to_email is null and o.status not in ('delivered','cancelled')),
    'deliveryAttention', (select count(*) from private.stockflow_orders o where o.archived_at is null and private.stockflow_can_access_order(p_actor_email,p_role,o.id) and o.status not in ('delivered','cancelled') and (o.expected_delivery_date <= current_date or exists(select 1 from private.stockflow_delivery_exceptions issue where issue.order_id=o.id and issue.status='open' and issue.category in ('delayed','failed_delivery'))))
  )
$$;

revoke all on function private.stockflow_order_matches_filter(private.stockflow_orders,text,text,date) from public, anon, authenticated;
revoke all on function private.stockflow_operations_summary(text,text) from public, anon, authenticated;
revoke all on function public.stockflow_order_list_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_order_list_gateway(text,text,text,jsonb) to service_role;
