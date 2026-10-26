alter table private.stockflow_tally_sales_prices
  add column invoice_unit text check (invoice_unit is null or char_length(btrim(invoice_unit)) between 1 and 40);

do $patch$
declare
  definition text := pg_get_functiondef('private.stockflow_import_tally_pricing_evidence()'::regprocedure);
  anchor text := $anchor$insert into private.stockflow_tally_sales_prices(customer_id,tally_item_key,invoice_rate,invoice_date,invoice_reference,source_id,source_version,exceptional,exception_type)
        values(customer.id,btrim(entry->>'tallyItemKey'),(entry->>'rate')::numeric,(entry->>'invoiceDate')::date,btrim(entry->>'invoiceReference'),btrim(entry->>'sourceId'),btrim(entry->>'sourceVersion'),coalesce((entry->>'exceptional')::boolean,false),nullif(entry->>'exceptionType',''))
        on conflict(source_id,source_version) do nothing;$anchor$;
  replacement text := $replacement$insert into private.stockflow_tally_sales_prices(customer_id,tally_item_key,invoice_rate,invoice_date,invoice_reference,source_id,source_version,exceptional,exception_type,invoice_unit)
        values(customer.id,btrim(entry->>'tallyItemKey'),(entry->>'rate')::numeric,(entry->>'invoiceDate')::date,btrim(entry->>'invoiceReference'),btrim(entry->>'sourceId'),btrim(entry->>'sourceVersion'),coalesce((entry->>'exceptional')::boolean,false),nullif(entry->>'exceptionType',''),nullif(btrim(entry->>'unit'),''))
        on conflict(source_id,source_version) do nothing;$replacement$;
begin
  definition := replace(definition, chr(13), '');
  if (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'Expected exactly one pricing sales import anchor';
  end if;
  execute replace(definition, anchor, replacement);
end $patch$;

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
  invoice_units jsonb;
  units jsonb;
  unit_mismatch boolean;
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
    'limitations', jsonb_build_array('Items removed from a Tally invoice, or deleted vouchers, keep their last synced rates'));
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
    select distinct on (s.source_id) s.source_id, s.tally_item_key, s.invoice_rate, s.invoice_unit
    from private.stockflow_tally_sales_prices s
    where s.customer_id = o.customer_id and lower(btrim(s.invoice_reference)) in (
      select lower(btrim(voucher_reference)) from private.stockflow_order_tally_invoices where order_id = o.id)
    order by s.source_id, s.imported_at desc, s.id desc
  ), grouped as (
    select tally_item_key, jsonb_agg(distinct invoice_rate order by invoice_rate) as rates,
      coalesce(jsonb_agg(distinct invoice_unit order by invoice_unit) filter (where invoice_unit is not null), '[]'::jsonb) as units
    from latest group by tally_item_key
  )
  select coalesce(jsonb_object_agg(grouped.tally_item_key, grouped.rates), '{}'::jsonb)  , coalesce(jsonb_object_agg(grouped.tally_item_key, grouped.units), '{}'::jsonb)
    into invoice_rates, invoice_units from grouped;
  if invoice_rates = '{}'::jsonb then
    return base || jsonb_build_object('state', 'waiting_for_tally', 'lines', '[]'::jsonb);
  end if;

  for l in select id, tally_item_key, item_name, base_unit from private.stockflow_order_lines
    where order_id = o.id order by created_at, id loop
    select r.approved_rate into rate from private.stockflow_snapshot_approved_rates(o.id, snap) r
    where r.order_line_id = l.id;
    rates := coalesce(invoice_rates->l.tally_item_key, '[]'::jsonb);
    units := coalesce(invoice_units->l.tally_item_key, '[]'::jsonb);
    unit_mismatch := exists(select 1 from jsonb_array_elements_text(units) u
      where lower(btrim(u)) is distinct from lower(btrim(l.base_unit)));
    select r::numeric - rate into delta from jsonb_array_elements_text(rates) r
    order by abs(r::numeric - rate) desc, r::numeric desc limit 1;
    if unit_mismatch then delta := null; end if;
    line_state := case
      when unit_mismatch then 'unit_differs'
      when jsonb_array_length(rates) = 0 then 'missing_on_invoice'
      when rate is null then 'no_approved_rate'
      when abs(delta) > 1.00 then 'different'
      else 'matches' end;
    if line_state <> 'matches' then different_count := different_count + 1; end if;
    lines := lines || jsonb_build_array(jsonb_build_object('lineId', l.id, 'tallyKey', l.tally_item_key,
      'itemName', l.item_name, 'approvedRate', rate, 'invoiceRates', rates,
      'invoiceUnits', units, 'orderUnit', l.base_unit,
      'difference', round(delta, 2), 'state', line_state));
  end loop;
  for l in select i.key, i.value, coalesce(p.name, i.key) as item_name
    from jsonb_each(invoice_rates) i
    left join private.stockflow_products p on p.tally_item_key = i.key
    where not exists(select 1 from private.stockflow_order_lines ol where ol.order_id = o.id and ol.tally_item_key = i.key)
    order by i.key loop
    lines := lines || jsonb_build_array(jsonb_build_object('lineId', null, 'tallyKey', l.key,
      'itemName', l.item_name, 'approvedRate', null, 'invoiceRates', l.value,
      'invoiceUnits', coalesce(invoice_units->l.key, '[]'::jsonb), 'orderUnit', null,
      'difference', null, 'state', 'not_on_order'));
    different_count := different_count + 1;
  end loop;
  return base || jsonb_build_object('state', case when different_count > 0 then 'different' else 'matches' end,
    'differentCount', different_count, 'lines', lines);
end $function$;
revoke all on function private.stockflow_order_rate_check(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
