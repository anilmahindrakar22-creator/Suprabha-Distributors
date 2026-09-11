do $migration$
declare
  f text;
  updated text;
begin
  select pg_get_functiondef('public.stockflow_order_list_gateway(text,text,text,jsonb)'::regprocedure) into f;

  updated := replace(f,
    $$'lineCount',(select count(*) from private.stockflow_order_lines l where l.order_id=o.id),
      'totalQuantity',coalesce((select sum(l.quantity) from private.stockflow_order_lines l where l.order_id=o.id),0),
      'reservedQuantity',coalesce((select sum(l.reserved_quantity) from private.stockflow_order_lines l where l.order_id=o.id),0),
      'lines',coalesce((select jsonb_agg(jsonb_build_object('tallyKey',l.tally_item_key,'itemName',l.item_name,'itemGroup',l.item_group,'baseUnit',l.base_unit,'quantity',l.quantity,'reservedQuantity',l.reserved_quantity,'fulfilledQuantity',l.fulfilled_quantity,'batchNumber',l.batch_number,'expiryDate',l.expiry_date) order by l.item_name) from private.stockflow_order_lines l where l.order_id=o.id),'[]'::jsonb),$$,
    $$'lineCount',line_summary.line_count,
      'totalQuantity',line_summary.total_quantity,
      'reservedQuantity',line_summary.reserved_quantity,
      'lines',line_summary.lines,$$
  );
  if updated = f then raise exception 'Expected repeated order-line projections were not found'; end if;
  f := updated;

  updated := replace(f,
    $$from private.stockflow_orders o
    where o.archived_at is null and private.stockflow_role_can_read_order(v_email,v_role,o.created_by_email)
      and private.stockflow_order_matches_filter_optimized(o,v_status,v_query,null) and private.stockflow_order_in_capture_range(o,v_date,v_date_to)
    order by o.created_at desc offset (v_page-1)*v_page_size limit v_page_size$$,
    $$from (
      select candidate.*
      from private.stockflow_orders candidate
      where candidate.archived_at is null
        and private.stockflow_role_can_read_order(v_email,v_role,candidate.created_by_email)
        and private.stockflow_order_matches_filter_optimized(candidate,v_status,v_query,null)
        and private.stockflow_order_in_capture_range(candidate,v_date,v_date_to)
      order by candidate.created_at desc
      offset (v_page-1)*v_page_size limit v_page_size
    ) o
    cross join lateral (
      select
        count(*) as line_count,
        coalesce(sum(l.quantity),0) as total_quantity,
        coalesce(sum(l.reserved_quantity),0) as reserved_quantity,
        coalesce(jsonb_agg(
          jsonb_build_object(
            'tallyKey',l.tally_item_key,'itemName',l.item_name,'itemGroup',l.item_group,
            'baseUnit',l.base_unit,'quantity',l.quantity,'reservedQuantity',l.reserved_quantity,
            'fulfilledQuantity',l.fulfilled_quantity,'batchNumber',l.batch_number,'expiryDate',l.expiry_date
          ) order by l.item_name
        ),'[]'::jsonb) as lines
      from private.stockflow_order_lines l
      where l.order_id=o.id
    ) line_summary$$
  );
  if updated = f then raise exception 'Expected paginated order source was not found'; end if;

  execute updated;
end $migration$;

revoke all on function public.stockflow_order_list_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_order_list_gateway(text,text,text,jsonb) to service_role;
