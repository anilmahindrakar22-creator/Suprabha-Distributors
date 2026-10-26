-- Read both sealed snapshot producer shapes without changing historical payloads.
-- Governed rates must still match the exact approved decision for this order and line.
create function private.stockflow_snapshot_approved_rates(p_order_id uuid, p_snapshot jsonb)
returns table(order_line_id uuid, approved_rate numeric)
language sql
stable
set search_path to 'pg_catalog', 'private'
as $function$
  select (e->>'order_line_id')::uuid, (e->>'approved_rate')::numeric
  from jsonb_array_elements(p_snapshot) e
  where e ? 'order_line_id'
    and e->>'state' = 'approved'
    and e->>'approved_rate' is not null
  union all
  select (e->>'lineId')::uuid, (e->>'enteredRate')::numeric
  from jsonb_array_elements(p_snapshot) e
  where not (e ? 'order_line_id') and e ? 'lineId'
    and (e->>'requiresApproval')::boolean is false
    and e->>'enteredRate' is not null
    and (e->>'enteredRate')::numeric > 0
    and exists (
      select 1 from private.stockflow_order_pricing_decisions d
      where d.id = (e->>'decisionId')::uuid
        and d.order_line_id = (e->>'lineId')::uuid
        and d.order_id = p_order_id
        and d.state = 'approved'
        and d.approved_rate = (e->>'enteredRate')::numeric
    )
$function$;
revoke all on function private.stockflow_snapshot_approved_rates(uuid,jsonb) from public, anon, authenticated, service_role;

create or replace function private.stockflow_order_billing_sheet(p_order_id uuid)
returns jsonb
language plpgsql
stable
set search_path to 'pg_catalog', 'private'
as $function$
declare
  o private.stockflow_orders%rowtype;
  snap jsonb;
  lines jsonb := '[]'::jsonb;
  total numeric := 0;
  l record;
  rate numeric;
  bill_quantity numeric;
  base jsonb;
  use_ordered boolean;
begin
  select * into o from private.stockflow_orders where id = p_order_id and archived_at is null;
  if not found then raise exception 'Order was not found' using errcode = '22023'; end if;
  base := jsonb_build_object('view', 'billing', 'orderId', o.id, 'orderNumber', o.order_number,
    'customerName', o.customer_name, 'status', o.status);
  if o.pricing_state <> 'approved' or o.pricing_snapshot_id is null then
    return base || jsonb_build_object('ready', false, 'reason', 'Price approval is not complete');
  end if;
  select pricing_payload into snap from private.stockflow_billing_snapshots
  where id = o.pricing_snapshot_id and order_id = o.id and invalidated_at is null;
  if snap is null or jsonb_typeof(snap) <> 'array' then
    return base || jsonb_build_object('ready', false, 'reason', 'Approved price snapshot is not current');
  end if;
  select not exists(select 1 from private.stockflow_order_lines where order_id = o.id and fulfilled_quantity > 0) into use_ordered;
  for l in select id, item_name, base_unit, quantity, fulfilled_quantity from private.stockflow_order_lines
    where order_id = o.id order by created_at, id loop
    select r.approved_rate into rate from private.stockflow_snapshot_approved_rates(o.id, snap) r
    where r.order_line_id = l.id;
    if rate is null then
      return base || jsonb_build_object('ready', false, 'reason', 'An item has no approved price');
    end if;
    bill_quantity := case when use_ordered then l.quantity else l.fulfilled_quantity end;
    lines := lines || jsonb_build_array(jsonb_build_object(
      'lineId', l.id, 'itemName', l.item_name, 'unit', l.base_unit,
      'orderedQuantity', l.quantity, 'packedQuantity', l.fulfilled_quantity, 'billQuantity', bill_quantity,
      'approvedRate', rate, 'amount', round(rate * bill_quantity, 2)));
    total := total + round(rate * bill_quantity, 2);
  end loop;
  return base || jsonb_build_object('ready', true, 'quantitySource', case when use_ordered then 'ordered' else 'packed' end, 'lines', lines, 'total', total);
end $function$;
revoke all on function private.stockflow_order_billing_sheet(uuid) from public, anon, authenticated;

create or replace function private.stockflow_order_rate_check(p_order_id uuid)
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
    select r.approved_rate into rate from private.stockflow_snapshot_approved_rates(o.id, snap) r
    where r.order_line_id = l.id;
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

notify pgrst, 'reload schema';
