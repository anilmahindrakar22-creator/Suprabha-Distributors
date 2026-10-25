-- Compare synced Tally line rates with the current approved snapshot. Tolerance: Rs 1 per unit.
create function private.stockflow_order_rate_check(p_order_id uuid)
returns jsonb
language plpgsql
stable
set search_path to 'pg_catalog', 'private'
as $function$
declare
  o private.stockflow_orders%rowtype;
  snap jsonb;
  base jsonb;
  invoice_rates jsonb;
  rates jsonb;
  lines jsonb := '[]'::jsonb;
  l record;
  rate numeric;
  delta numeric;
  line_state text;
  different_count integer := 0;
begin
  select * into o from private.stockflow_orders where id = p_order_id and archived_at is null;
  if not found then raise exception 'Order was not found' using errcode = '22023'; end if;
  base := jsonb_build_object('view', 'rate_check', 'orderId', o.id, 'orderNumber', o.order_number,
    'customerName', o.customer_name, 'status', o.status, 'tolerance', 1.00,
    'limitations', jsonb_build_array('Units are not compared',
      'Items removed from a Tally invoice, or deleted vouchers, keep their last synced rates'));
  if o.tally_invoice_number is null then
    return base || jsonb_build_object('state', 'not_billed', 'lines', '[]'::jsonb);
  end if;
  if o.pricing_state <> 'approved' or o.pricing_snapshot_id is null then
    return base || jsonb_build_object('state', 'no_approved_price', 'lines', '[]'::jsonb);
  end if;
  select pricing_payload into snap from private.stockflow_billing_snapshots
  where id = o.pricing_snapshot_id and order_id = o.id and invalidated_at is null;
  if snap is null or jsonb_typeof(snap) <> 'array' then
    return base || jsonb_build_object('state', 'no_approved_price', 'lines', '[]'::jsonb);
  end if;

  with latest as (
    select distinct on (s.source_id) s.source_id, s.tally_item_key, s.invoice_rate
    from private.stockflow_tally_sales_prices s
    where s.customer_id = o.customer_id and lower(btrim(s.invoice_reference)) in (
      select lower(btrim(voucher_reference)) from private.stockflow_order_tally_invoices where order_id = o.id)
    order by s.source_id, s.imported_at desc, s.id desc
  ), grouped as (
    select tally_item_key, jsonb_agg(distinct invoice_rate order by invoice_rate) as rates
    from latest group by tally_item_key
  )
  select coalesce(jsonb_object_agg(grouped.tally_item_key, grouped.rates), '{}'::jsonb) into invoice_rates from grouped;
  if invoice_rates = '{}'::jsonb then
    return base || jsonb_build_object('state', 'waiting_for_tally', 'lines', '[]'::jsonb);
  end if;

  for l in select id, tally_item_key, item_name from private.stockflow_order_lines
    where order_id = o.id order by created_at, id loop
    select (e->>'approved_rate')::numeric into rate from jsonb_array_elements(snap) e
    where e->>'order_line_id' = l.id::text and e->>'state' = 'approved' and e->>'approved_rate' is not null
    limit 1;
    rates := coalesce(invoice_rates->l.tally_item_key, '[]'::jsonb);
    select r::numeric - rate into delta from jsonb_array_elements_text(rates) r
    order by abs(r::numeric - rate) desc, r::numeric desc limit 1;
    line_state := case
      when jsonb_array_length(rates) = 0 then 'missing_on_invoice'
      when rate is null then 'no_approved_rate'
      when abs(delta) > 1.00 then 'different'
      else 'matches' end;
    if line_state <> 'matches' then different_count := different_count + 1; end if;
    lines := lines || jsonb_build_array(jsonb_build_object('lineId', l.id, 'tallyKey', l.tally_item_key,
      'itemName', l.item_name, 'approvedRate', rate, 'invoiceRates', rates,
      'difference', round(delta, 2), 'state', line_state));
  end loop;
  for l in select i.key, i.value, coalesce(p.name, i.key) as item_name
    from jsonb_each(invoice_rates) i
    left join private.stockflow_products p on p.tally_item_key = i.key
    where not exists(select 1 from private.stockflow_order_lines ol where ol.order_id = o.id and ol.tally_item_key = i.key)
    order by i.key loop
    lines := lines || jsonb_build_array(jsonb_build_object('lineId', null, 'tallyKey', l.key,
      'itemName', l.item_name, 'approvedRate', null, 'invoiceRates', l.value,
      'difference', null, 'state', 'not_on_order'));
    different_count := different_count + 1;
  end loop;
  return base || jsonb_build_object('state', case when different_count > 0 then 'different' else 'matches' end,
    'differentCount', different_count, 'lines', lines);
end $function$;
revoke all on function private.stockflow_order_rate_check(uuid) from public, anon, authenticated;

alter function public.stockflow_pricing_gateway(text,text,text,jsonb) rename to stockflow_pricing_gateway_before_rate_check;
revoke all on function public.stockflow_pricing_gateway_before_rate_check(text,text,text,jsonb) from public, anon, authenticated;

create function public.stockflow_pricing_gateway(p_gateway_key text, p_actor_email text, p_action text, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'private', 'extensions'
as $function$
declare
  actor_email text := lower(btrim(coalesce(p_actor_email, '')));
  assigned_roles text[];
  secret text;
  order_id uuid;
  o record;
  result jsonb;
  orders jsonb := '[]'::jsonb;
  checked_count integer := 0;
  worst_difference numeric;
begin
  if not (p_action = 'get_order_pricing' and coalesce(p_payload->>'view', '') in ('rate_check', 'rate_exceptions')) then
    return public.stockflow_pricing_gateway_before_rate_check(p_gateway_key, p_actor_email, p_action, p_payload);
  end if;
  select secret_sha256 into secret from private.stockflow_gateway_config where name = 'orders';
  if secret is null or encode(extensions.digest(coalesce(p_gateway_key, ''), 'sha256'), 'hex') <> secret then
    raise exception 'Unauthorized gateway' using errcode = '42501';
  end if;
  select m.roles into assigned_roles from public.stockflow_members m where m.email = actor_email and m.status = 'active';
  if not private.stockflow_valid_roles(assigned_roles)
     or not (assigned_roles && array['administrator','management','accounts']::text[]) then
    raise exception 'Rate checks are restricted' using errcode = '42501';
  end if;
  if p_payload->>'view' = 'rate_check' then
    begin order_id := (p_payload->>'orderId')::uuid;
    exception when invalid_text_representation then raise exception 'Valid order is required' using errcode = '22023'; end;
    if order_id is null then raise exception 'Valid order is required' using errcode = '22023'; end if;
    perform private.assert_stockflow_order_access(actor_email, assigned_roles, order_id);
    return private.stockflow_order_rate_check(order_id);
  end if;
  if not (assigned_roles && array['administrator','management']::text[]) then
    raise exception 'Rate checks are restricted' using errcode = '42501';
  end if;
  for o in select id from private.stockflow_orders
    where tally_invoice_number is not null and archived_at is null
      and status in ('billed_in_tally','ready_for_dispatch','dispatched','delivered')
    order by updated_at desc, id limit 50 loop
    checked_count := checked_count + 1;
    result := private.stockflow_order_rate_check(o.id);
    if result->>'state' = 'different' then
      select (e->>'difference')::numeric into worst_difference from jsonb_array_elements(result->'lines') e
      where e->>'difference' is not null
      order by abs((e->>'difference')::numeric) desc, (e->>'difference')::numeric desc limit 1;
      orders := orders || jsonb_build_array(jsonb_build_object('orderId', result->'orderId',
        'orderNumber', result->'orderNumber', 'customerName', result->'customerName', 'status', result->'status',
        'differentCount', result->'differentCount', 'worstDifference', worst_difference));
    end if;
  end loop;
  return jsonb_build_object('view', 'rate_exceptions', 'tolerance', 1.00, 'checkedCount', checked_count, 'orders', orders);
end $function$;
revoke all on function public.stockflow_pricing_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_pricing_gateway(text,text,text,jsonb) to service_role;

notify pgrst, 'reload schema';
