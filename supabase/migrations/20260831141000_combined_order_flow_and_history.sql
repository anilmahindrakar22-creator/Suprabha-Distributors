do $$
declare
  v_function_sql text;
  v_updated_sql text;
begin
  select pg_get_functiondef(
    'public.stockflow_order_gateway(text,text,text,jsonb)'::regprocedure
  ) into v_function_sql;

  v_updated_sql := replace(
    v_function_sql,
    $old$select x.id, x.order_number as "orderNumber",
            x.customer_name as "customerName", x.customer_phone as "customerPhone",
            x.status, x.source, x.notes, x.version,
            x.created_at as "createdAt", x.updated_at as "updatedAt",
            count(l.id)::integer as "lineCount",
            coalesce(sum(l.quantity), 0) as "totalQuantity",
            coalesce(sum(l.reserved_quantity), 0) as "reservedQuantity"
          from private.stockflow_orders x
          left join private.stockflow_order_lines l on l.order_id = x.id
          group by x.id order by x.created_at desc limit 100$old$,
    $new$select x.id, x.order_number as "orderNumber",
            x.customer_name as "customerName", x.customer_phone as "customerPhone",
            x.status, x.source, x.notes, x.version,
            x.tally_invoice_number as "tallyInvoiceNumber",
            x.created_at as "createdAt", x.updated_at as "updatedAt",
            count(l.id)::integer as "lineCount",
            coalesce(sum(l.quantity), 0) as "totalQuantity",
            coalesce(sum(l.reserved_quantity), 0) as "reservedQuantity",
            coalesce((
              select jsonb_agg(jsonb_build_object(
                'tallyKey', detail.tally_item_key,
                'itemName', detail.item_name,
                'itemGroup', detail.item_group,
                'baseUnit', detail.base_unit,
                'quantity', detail.quantity,
                'reservedQuantity', detail.reserved_quantity
              ) order by detail.item_name)
              from private.stockflow_order_lines detail
              where detail.order_id = x.id
            ), '[]'::jsonb) as lines
          from private.stockflow_orders x
          left join private.stockflow_order_lines l on l.order_id = x.id
          group by x.id order by x.created_at desc limit 500$new$
  );

  if v_updated_sql = v_function_sql then
    raise exception 'Expected order history query was not found';
  end if;

  v_function_sql := v_updated_sql;
  v_updated_sql := replace(
    v_function_sql,
    $old$(v_from_status in ('fully_reserved', 'partially_reserved') and v_to_status in ('ready_for_picking', 'cancelled')) or$old$,
    $new$(v_from_status = 'fully_reserved' and v_to_status in ('ready_for_picking', 'packed', 'cancelled')) or
    (v_from_status = 'partially_reserved' and v_to_status in ('ready_for_picking', 'cancelled')) or$new$
  );

  if v_updated_sql = v_function_sql then
    raise exception 'Expected stock allocation transition was not found';
  end if;

  v_function_sql := v_updated_sql;
  v_updated_sql := replace(
    v_function_sql,
    $old$(v_from_status = 'ready_for_picking' and v_to_status in ('picked', 'cancelled')) or$old$,
    $new$(v_from_status = 'ready_for_picking' and v_to_status in ('picked', 'packed', 'cancelled')) or$new$
  );

  if v_updated_sql = v_function_sql then
    raise exception 'Expected picking transition was not found';
  end if;

  execute v_updated_sql;
end;
$$;

revoke all on function public.stockflow_order_gateway(text, text, text, jsonb)
from public, anon, authenticated;
grant execute on function public.stockflow_order_gateway(text, text, text, jsonb)
to service_role;
