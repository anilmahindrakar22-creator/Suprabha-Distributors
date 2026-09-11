create or replace function private.stockflow_order_matches_filter(
  p_order private.stockflow_orders, p_status text, p_query text, p_capture_date date
) returns boolean
language plpgsql
stable
set search_path = pg_catalog, private
as $$
declare
  q text := lower(btrim(coalesce(p_query, '')));
  assignee text := case when q like 'assignee:%' then nullif(btrim(substr(q,10)),'') else null end;
  business_date date := (now() at time zone 'Asia/Kolkata')::date;
  status_match boolean;
begin
  status_match := case p_status
    when 'all' then true
    when 'open' then p_order.status not in ('delivered','cancelled')
    when 'history' then p_order.status in ('delivered','cancelled')
    when 'billing' then p_order.status = 'awaiting_tally_billing'
    when 'picking' then p_order.status in ('confirmed','partially_reserved','fully_reserved','ready_for_picking','picked')
    when 'dispatch_ready' then p_order.status in ('billed_in_tally','ready_for_dispatch')
    when 'delivery_due_today' then p_order.status not in ('delivered','cancelled') and p_order.expected_delivery_date = business_date
    when 'delivery_due_soon' then p_order.status not in ('delivered','cancelled') and p_order.expected_delivery_date between business_date and business_date + 6
    when 'delivery_attention' then p_order.status not in ('delivered','cancelled') and (
      p_order.expected_delivery_date <= business_date
      or exists(select 1 from private.stockflow_delivery_exceptions issue where issue.order_id=p_order.id and issue.status='open' and issue.category in ('delayed','failed_delivery'))
    )
    when 'back_ordered' then p_order.status not in ('delivered','cancelled') and exists(
      select 1 from private.stockflow_order_lines line
      where line.order_id=p_order.id and line.fulfilled_quantity < line.quantity
        and (line.fulfilled_quantity > 0 or p_order.status in ('packed','awaiting_tally_billing','billed_in_tally','ready_for_dispatch','dispatched'))
    )
    when 'delivery_exception' then exists(
      select 1 from private.stockflow_delivery_exceptions issue where issue.order_id=p_order.id and issue.status='open'
    )
    when 'priority_urgent' then p_order.status not in ('delivered','cancelled') and p_order.priority='urgent'
    when 'priority_high' then p_order.status not in ('delivered','cancelled') and p_order.priority in ('high','urgent')
    when 'overdue' then p_order.status not in ('delivered','cancelled') and p_order.expected_delivery_date < business_date
    when 'attention' then
      p_order.status not in ('delivered','cancelled') and (
        p_order.updated_at < now() - case when p_order.status in ('phone_order_received','awaiting_confirmation','awaiting_approval') then interval '4 hours' when p_order.status in ('confirmed','packed') then interval '24 hours' else interval '48 hours' end
        or (p_order.expected_delivery_date is not null and p_order.expected_delivery_date < business_date)
        or exists(select 1 from private.stockflow_delivery_exceptions issue where issue.order_id=p_order.id and issue.status='open')
        or exists(select 1 from private.stockflow_equipment_installations install where install.order_id=p_order.id and install.status='scheduled' and install.scheduled_date < business_date)
        or exists(select 1 from private.stockflow_order_lines line where line.order_id=p_order.id and line.fulfilled_quantity < line.quantity and (line.fulfilled_quantity > 0 or p_order.status in ('packed','awaiting_tally_billing','billed_in_tally','ready_for_dispatch','dispatched')))
        or (p_order.status='ready_for_dispatch' and (p_order.courier_name is null or p_order.tracking_number is null or p_order.dispatch_date is null))
        or (p_order.status='dispatched' and (p_order.received_by is null or p_order.delivered_at is null))
      )
    else p_order.status = p_status
  end;
  return status_match
    and (p_capture_date is null or (p_order.created_at at time zone 'Asia/Kolkata')::date = p_capture_date)
    and (assignee is null or (assignee='unassigned' and p_order.assigned_to_email is null) or p_order.assigned_to_email=assignee)
    and (q = '' or assignee is not null or strpos(lower(concat_ws(' ',p_order.order_number,p_order.customer_name,p_order.customer_phone,p_order.tally_invoice_number,p_order.assigned_to_email)),q) > 0
      or exists(select 1 from private.stockflow_order_lines line where line.order_id=p_order.id and strpos(lower(line.item_name),q) > 0));
end;
$$;

revoke all on function private.stockflow_order_matches_filter(private.stockflow_orders,text,text,date) from public, anon, authenticated;

do $migration$
declare f text; updated text;
begin
  select pg_get_functiondef('public.stockflow_order_list_gateway(text,text,text,jsonb)'::regprocedure) into f;
  updated := replace(f,
    $old$'all', 'open', 'history', 'billing', 'picking', 'dispatch_ready', 'delivery_attention', 'overdue', 'attention'$old$,
    $new$'all', 'open', 'history', 'billing', 'picking', 'dispatch_ready', 'delivery_attention', 'delivery_due_today', 'delivery_due_soon', 'back_ordered', 'delivery_exception', 'priority_high', 'priority_urgent', 'overdue', 'attention'$new$);
  if updated=f then
    updated := replace(f,
      $old$'all','open','history','billing','picking','dispatch_ready','delivery_attention','overdue','attention'$old$,
      $new$'all','open','history','billing','picking','dispatch_ready','delivery_attention','delivery_due_today','delivery_due_soon','back_ordered','delivery_exception','priority_high','priority_urgent','overdue','attention'$new$);
  end if;
  if updated=f then raise exception 'Expected order status allowlist was not found'; end if;
  f := updated;
  updated := replace(f,
    $$private.stockflow_operations_summary(v_email,v_role) || jsonb_build_object('delayedFailedDeliveries',(select count(*) from private.stockflow_orders o where o.archived_at is null and private.stockflow_can_access_order(v_email,v_role,o.id) and o.status not in ('delivered','cancelled') and (o.expected_delivery_date < current_date or exists(select 1 from private.stockflow_delivery_exceptions i where i.order_id=o.id and i.status='open' and i.category in ('delayed','failed_delivery')))))$$,
    $$private.stockflow_operations_summary(v_email,v_role)$$);
  if updated=f then raise exception 'Expected duplicate delayed-delivery summary was not found'; end if;
  execute updated;
end $migration$;

revoke all on function public.stockflow_order_list_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_order_list_gateway(text,text,text,jsonb) to service_role;
