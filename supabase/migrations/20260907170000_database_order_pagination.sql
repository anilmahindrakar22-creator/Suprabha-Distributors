create or replace function private.stockflow_order_matches_filter(
  p_order private.stockflow_orders, p_status text, p_query text, p_capture_date date
) returns boolean
language plpgsql
stable
set search_path = pg_catalog, private
as $$
declare
  q text := lower(btrim(coalesce(p_query, '')));
  status_match boolean;
begin
  status_match := case p_status
    when 'all' then true
    when 'open' then p_order.status not in ('delivered','cancelled')
    when 'history' then p_order.status in ('delivered','cancelled')
    when 'billing' then p_order.status = 'awaiting_tally_billing'
    when 'picking' then p_order.status in ('confirmed','partially_reserved','fully_reserved','ready_for_picking','picked')
    when 'dispatch_ready' then p_order.status in ('billed_in_tally','ready_for_dispatch')
    when 'overdue' then p_order.status not in ('delivered','cancelled') and p_order.expected_delivery_date < current_date
    when 'attention' then
      p_order.status not in ('delivered','cancelled') and (
        p_order.updated_at < now() - case when p_order.status in ('phone_order_received','awaiting_confirmation','awaiting_approval') then interval '4 hours' when p_order.status in ('confirmed','packed') then interval '24 hours' else interval '48 hours' end
        or (p_order.expected_delivery_date is not null and p_order.expected_delivery_date < current_date)
        or exists(select 1 from private.stockflow_delivery_exceptions issue where issue.order_id=p_order.id and issue.status='open')
        or exists(select 1 from private.stockflow_equipment_installations install where install.order_id=p_order.id and install.status='scheduled' and install.scheduled_date < current_date)
        or exists(select 1 from private.stockflow_order_lines line where line.order_id=p_order.id and line.fulfilled_quantity < line.quantity and (line.fulfilled_quantity > 0 or p_order.status in ('packed','awaiting_tally_billing','billed_in_tally','ready_for_dispatch','dispatched')))
        or (p_order.status='ready_for_dispatch' and (p_order.courier_name is null or p_order.tracking_number is null or p_order.dispatch_date is null))
        or (p_order.status='dispatched' and (p_order.received_by is null or p_order.delivered_at is null))
      )
    else p_order.status = p_status
  end;
  return status_match
    and (p_capture_date is null or (p_order.created_at at time zone 'Asia/Kolkata')::date = p_capture_date)
    and (q = '' or strpos(lower(concat_ws(' ',p_order.order_number,p_order.customer_name,p_order.customer_phone,p_order.tally_invoice_number)),q) > 0
      or exists(select 1 from private.stockflow_order_lines line where line.order_id=p_order.id and strpos(lower(line.item_name),q) > 0));
end;
$$;

revoke all on function private.stockflow_order_matches_filter(private.stockflow_orders,text,text,date) from public, anon, authenticated;

create or replace function public.stockflow_order_list_gateway(
  p_gateway_key text, p_actor_email text, p_action text, p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_actor_email,'')));
  v_role text;
  v_hash text;
  v_status text := coalesce(nullif(p_payload->>'status',''),'open');
  v_query text := btrim(coalesce(p_payload->>'query',''));
  v_date date;
  v_page integer := coalesce(nullif(p_payload->>'page','')::integer,1);
  v_page_size integer := coalesce(nullif(p_payload->>'pageSize','')::integer,20);
  v_total bigint;
  v_page_count integer;
  v_snapshot jsonb;
  v_orders jsonb;
begin
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex') <> v_hash then raise exception 'Unauthorized gateway' using errcode='42501'; end if;
  if p_action <> 'list_orders' then raise exception 'Unsupported order list action' using errcode='22023'; end if;
  select role into v_role from public.stockflow_members where email=v_email and status='active';
  if v_role is null then raise exception 'Account is not approved' using errcode='42501'; end if;
  if v_page < 1 or v_page > 10000 or v_page_size < 1 or v_page_size > 200 or char_length(v_query) > 120 then raise exception 'Invalid order list filters' using errcode='22023'; end if;
  if v_status not in ('all','open','history','billing','picking','dispatch_ready','overdue','attention','phone_order_received','awaiting_confirmation','awaiting_approval','confirmed','packed','awaiting_tally_billing','billed_in_tally','ready_for_dispatch','dispatched','delivered','cancelled') then raise exception 'Invalid order list status' using errcode='22023'; end if;
  begin v_date := nullif(p_payload->>'date','')::date; exception when invalid_datetime_format then raise exception 'Invalid order date' using errcode='22023'; end;

  select count(*) into v_total from private.stockflow_orders o
  where o.archived_at is null and private.stockflow_can_access_order(v_email,v_role,o.id)
    and private.stockflow_order_matches_filter(o,v_status,v_query,v_date);
  v_page_count := greatest(1,ceil(v_total::numeric/v_page_size)::integer);
  v_page := least(v_page,v_page_count);

  select coalesce(jsonb_agg(order_json order by created_at desc),'[]'::jsonb) into v_orders from (
    select o.created_at, jsonb_build_object(
      'id',o.id,'orderNumber',o.order_number,'customerName',o.customer_name,'customerPhone',o.customer_phone,
      'status',o.status,'source',o.source,'notes',o.notes,'version',o.version,'tallyInvoiceNumber',o.tally_invoice_number,
      'createdAt',o.created_at,'updatedAt',o.updated_at,'deliveryAddress',o.delivery_address,'expectedDeliveryDate',o.expected_delivery_date,
      'courierName',o.courier_name,'trackingNumber',o.tracking_number,'dispatchDate',o.dispatch_date,'vehicleNumber',o.vehicle_number,
      'deliveredAt',o.delivered_at,'receivedBy',o.received_by,'podReference',o.pod_reference,
      'lineCount',(select count(*) from private.stockflow_order_lines l where l.order_id=o.id),
      'totalQuantity',coalesce((select sum(l.quantity) from private.stockflow_order_lines l where l.order_id=o.id),0),
      'reservedQuantity',coalesce((select sum(l.reserved_quantity) from private.stockflow_order_lines l where l.order_id=o.id),0),
      'lines',coalesce((select jsonb_agg(jsonb_build_object('tallyKey',l.tally_item_key,'itemName',l.item_name,'itemGroup',l.item_group,'baseUnit',l.base_unit,'quantity',l.quantity,'reservedQuantity',l.reserved_quantity,'fulfilledQuantity',l.fulfilled_quantity,'batchNumber',l.batch_number,'expiryDate',l.expiry_date) order by l.item_name) from private.stockflow_order_lines l where l.order_id=o.id),'[]'::jsonb),
      'events','[]'::jsonb,
      'exceptions',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'category',i.category,'status',i.status,'summary',i.summary,'ownerEmail',i.owner_email,'resolution',i.resolution,'createdBy',i.created_by_email,'resolvedBy',i.resolved_by_email,'createdAt',i.created_at,'resolvedAt',i.resolved_at) order by i.created_at,i.id) from private.stockflow_delivery_exceptions i where i.order_id=o.id),'[]'::jsonb),
      'installations',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'tallyKey',i.tally_key,'itemName',i.item_name,'status',i.status,'scheduledDate',i.scheduled_date,'engineerEmail',i.engineer_email,'siteContact',i.site_contact,'serialNumber',i.serial_number,'commissioningNotes',i.commissioning_notes,'createdBy',i.created_by_email,'createdAt',i.created_at,'completedBy',i.completed_by_email,'completedAt',i.completed_at) order by i.scheduled_date,i.id) from private.stockflow_equipment_installations i where i.order_id=o.id),'[]'::jsonb)
    ) order_json
    from private.stockflow_orders o
    where o.archived_at is null and private.stockflow_can_access_order(v_email,v_role,o.id)
      and private.stockflow_order_matches_filter(o,v_status,v_query,v_date)
    order by o.created_at desc offset (v_page-1)*v_page_size limit v_page_size
  ) page;

  select payload into v_snapshot from public.stockflow_snapshots where id='suprabha';
  return jsonb_build_object(
    'actor',jsonb_build_object('email',v_email,'role',v_role),
    'snapshot',jsonb_build_object(
      'company',coalesce(v_snapshot->>'company',''),'fetchedAt',coalesce(v_snapshot->>'fetchedAt',''),
      'catalogVersion',coalesce(v_snapshot->>'fetchedAt',''),'catalog','[]'::jsonb,
      'tallyInvoices',coalesce((select jsonb_agg(invoice) from jsonb_array_elements(coalesce(v_snapshot->'tallyInvoices','[]'::jsonb)) invoice
        where exists(select 1 from jsonb_array_elements(v_orders) listed
          where nullif(listed->>'tallyInvoiceNumber','') is not null
            and lower(regexp_replace(btrim(invoice->>'party'),'\s+',' ','g'))=lower(regexp_replace(btrim(listed->>'customerName'),'\s+',' ','g')))), '[]'::jsonb)
    ),
    'customerVersion',coalesce((select max(updated_at)::text||':'||count(*)::text from private.stockflow_customers where active),'0'),
    'customers','[]'::jsonb,'orders',v_orders,
    'operations',private.stockflow_operations_summary(v_email,v_role) || jsonb_build_object('delayedFailedDeliveries',(select count(*) from private.stockflow_orders o where o.archived_at is null and private.stockflow_can_access_order(v_email,v_role,o.id) and o.status not in ('delivered','cancelled') and (o.expected_delivery_date < current_date or exists(select 1 from private.stockflow_delivery_exceptions i where i.order_id=o.id and i.status='open' and i.category in ('delayed','failed_delivery'))))),
    'pagination',jsonb_build_object('page',v_page,'pageCount',v_page_count,'pageSize',v_page_size,'total',v_total)
  );
end;
$$;

revoke all on function public.stockflow_order_list_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_order_list_gateway(text,text,text,jsonb) to service_role;
