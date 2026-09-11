create index if not exists stockflow_orders_active_status_created_idx
  on private.stockflow_orders(status, created_at desc)
  where archived_at is null;

create index if not exists stockflow_orders_active_creator_status_created_idx
  on private.stockflow_orders(created_by_email, status, created_at desc)
  where archived_at is null;

create index if not exists stockflow_orders_active_delivery_idx
  on private.stockflow_orders(expected_delivery_date, created_at desc)
  where archived_at is null
    and expected_delivery_date is not null
    and status not in ('delivered','cancelled');

create index if not exists stockflow_events_dispatched_created_idx
  on private.stockflow_order_events(created_at desc, order_id)
  where to_status='dispatched';

create or replace function private.stockflow_operations_summary(p_actor_email text, p_role text)
returns jsonb
language sql
stable
set search_path = pg_catalog, private
as $$
  with role_scope as (
    select
      coalesce(bool_or(scope='global'),false) as can_read_global,
      coalesce(bool_or(scope='created_by'),false) as can_read_created
    from private.stockflow_role_order_scopes
    where role=p_role
  ),
  business_clock as (
    select
      (now() at time zone 'Asia/Kolkata')::date as business_date,
      ((now() at time zone 'Asia/Kolkata')::date::timestamp at time zone 'Asia/Kolkata') as business_start
  ),
  accessible as materialized (
    select o.*
    from private.stockflow_orders o
    cross join role_scope scope
    where o.archived_at is null
      and (
        scope.can_read_global
        or (scope.can_read_created and o.created_by_email=lower(btrim(p_actor_email)))
      )
  ),
  counts as (
    select
      count(*) filter (where o.created_at >= clock.business_start and o.source='phone') as phone_orders_today,
      count(*) filter (where o.status='awaiting_confirmation') as awaiting_confirmation,
      count(*) filter (where o.status='awaiting_approval') as awaiting_approval,
      count(*) filter (where o.status='partially_reserved') as awaiting_stock,
      count(*) filter (where o.status in ('fully_reserved','ready_for_picking')) as ready_for_picking,
      count(*) filter (where o.status='packed') as packed,
      count(*) filter (where o.status='awaiting_tally_billing') as awaiting_tally_billing,
      count(*) filter (where o.status in ('billed_in_tally','ready_for_dispatch')) as billed_not_dispatched,
      count(*) filter (where o.status in ('awaiting_approval','partially_reserved') and o.updated_at < now()-interval '24 hours') as urgent_exceptions,
      count(*) filter (where o.assigned_to_email is null and o.status not in ('delivered','cancelled')) as unassigned_open,
      count(*) filter (where o.status not in ('delivered','cancelled') and (
        o.expected_delivery_date <= clock.business_date
        or exists(select 1 from private.stockflow_delivery_exceptions issue where issue.order_id=o.id and issue.status='open' and issue.category in ('delayed','failed_delivery'))
      )) as delivery_attention,
      count(*) filter (where private.stockflow_order_matches_filter(o,'attention','',null)) as needs_attention,
      count(*) filter (where o.status not in ('delivered','cancelled') and (
        o.expected_delivery_date < clock.business_date
        or exists(select 1 from private.stockflow_delivery_exceptions issue where issue.order_id=o.id and issue.status='open' and issue.category in ('delayed','failed_delivery'))
      )) as delayed_failed_deliveries
    from accessible o
    cross join business_clock clock
  )
  select jsonb_build_object(
    'phoneOrdersToday', counts.phone_orders_today,
    'awaitingConfirmation', counts.awaiting_confirmation,
    'awaitingApproval', counts.awaiting_approval,
    'awaitingStock', counts.awaiting_stock,
    'readyForPicking', counts.ready_for_picking,
    'packed', counts.packed,
    'awaitingTallyBilling', counts.awaiting_tally_billing,
    'billedNotDispatched', counts.billed_not_dispatched,
    'dispatchedToday', (
      select count(*) from private.stockflow_order_events event
      join accessible o on o.id=event.order_id
      cross join business_clock clock
      where event.to_status='dispatched' and event.created_at >= clock.business_start
    ),
    'urgentExceptions', counts.urgent_exceptions,
    'unassignedOpen', counts.unassigned_open,
    'deliveryAttention', counts.delivery_attention,
    'needsAttention', counts.needs_attention,
    'delayedFailedDeliveries', counts.delayed_failed_deliveries
  )
  from counts
$$;

revoke all on function private.stockflow_operations_summary(text,text) from public, anon, authenticated;
