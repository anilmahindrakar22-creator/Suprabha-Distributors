create or replace function private.stockflow_order_matches_filter_with_notes(
  p_order private.stockflow_orders, p_status text, p_query text, p_capture_date date
) returns boolean
language sql
stable
set search_path = pg_catalog, private
as $$
  select private.stockflow_order_matches_filter(p_order,p_status,p_query,p_capture_date)
    or (
      btrim(coalesce(p_query,'')) <> ''
      and lower(btrim(p_query)) not like 'assignee:%'
      and lower(btrim(p_query)) not like 'customer:%'
      and private.stockflow_order_matches_filter(p_order,p_status,'',p_capture_date)
      and (
        strpos(
          lower(concat_ws(' ',
            replace(p_order.source,'_',' '), p_order.priority, p_order.notes,
            p_order.delivery_address, p_order.courier_name, p_order.tracking_number,
            p_order.vehicle_number, p_order.received_by, p_order.pod_reference
          )),
          lower(btrim(p_query))
        ) > 0
        or exists(
          select 1 from private.stockflow_order_events event
          where event.order_id=p_order.id
            and strpos(lower(coalesce(event.reason,'')),lower(btrim(p_query))) > 0
        )
      )
    )
$$;

revoke all on function private.stockflow_order_matches_filter_with_notes(private.stockflow_orders,text,text,date) from public, anon, authenticated;
