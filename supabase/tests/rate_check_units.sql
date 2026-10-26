begin;
alter table public.stockflow_members drop constraint if exists stockflow_members_roles_pending_union;
update private.stockflow_gateway_config
set secret_sha256=encode(extensions.digest('rate-check-units-key','sha256'),'hex') where name='orders';
update private.stockflow_pricing_policies set active=false where active;
insert into private.stockflow_pricing_policies(policy_version,minimum_margin_percent,target_margin_percent,
  override_approval_percent,rounding_increment,rounding_rule_version,effective_from,created_by_email)
values('rate-check-units',25,30,5,1,'rate-units-rounding',(now() at time zone 'Asia/Kolkata')::date-90,'test');
insert into public.stockflow_members(email,role,status) values
  ('admin@rateunits.test.local','administrator','active'),
  ('billing@rateunits.test.local','billing','active');
update public.stockflow_members set roles=array[role] where email like '%@rateunits.test.local';

do $scenarios$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  customer uuid; o uuid; line_id uuid;
  scenario text; item text; invoice text; unit text; status text;
  expected_state text; expected_delta numeric; invoice_rate numeric;
  result jsonb; checked_line jsonb;
begin
  insert into private.stockflow_customers(name,tally_key,created_by_email)
  values('Rate units customer','rate-units-customer','test') returning id into customer;
  foreach scenario in array array['equal','box','legacy-match','legacy-diff','normalized'] loop
    item := 'RATE-UNITS-'||scenario;
    invoice := 'SD/RATE-UNITS/'||scenario;
    unit := case scenario when 'equal' then 'Nos' when 'box' then 'Box' when 'normalized' then ' nos ' else null end;
    invoice_rate := case when scenario='legacy-diff' then 5998 else 6000 end;
    expected_state := case when scenario='box' then 'unit_differs' when scenario='legacy-diff' then 'different' else 'matches' end;
    expected_delta := case when scenario='box' then null else invoice_rate-6000 end;
    insert into private.stockflow_products(tally_item_key,name,base_unit) values(item,item,'Nos');
    insert into private.stockflow_tally_purchase_costs(tally_item_key,cost_amount,cost_kind,effective_at,source_reference,source_id,source_version)
    values(item,3465,'purchase_price',today-20,item||'-cost',item||'-cost','1');
    insert into private.stockflow_tally_sales_prices(customer_id,tally_item_key,invoice_rate,invoice_date,invoice_reference,source_id,source_version,invoice_unit)
    values(customer,item,6000,today-10,item||'-history',item||'-history','1',null);
    insert into public.stockflow_snapshots(id,company,fetched_at,payload)
    values('suprabha','RATE UNITS TEST',now()::text,jsonb_build_object('catalog',
      jsonb_build_array(jsonb_build_object('tallyKey',item,'item',item,'baseUnit','Nos','group','Rate units tests','closing',10,'active',true))))
    on conflict(id) do update set payload=excluded.payload;

    result := public.stockflow_order_gateway('rate-check-units-key','admin@rateunits.test.local','create_order',
      jsonb_build_object('customerId',customer,'customerName','Rate units customer','source','phone',
        'idempotencyKey','rate-units-create-'||scenario,
        'lines',jsonb_build_array(jsonb_build_object('tallyKey',item,'quantity',2))));
    o := (result->>'orderId')::uuid;
    select id into strict line_id from private.stockflow_order_lines where order_id=o;
    result := public.stockflow_pricing_gateway('rate-check-units-key','admin@rateunits.test.local',
      'apply_governed_order_pricing',jsonb_build_object('orderId',o,
        'expectedVersion',(select version from private.stockflow_orders where id=o),
        'idempotencyKey','rate-units-price-'||scenario));
    if result->>'pricingState' is distinct from 'approved' then
      raise exception 'Real pricing failed: %',result;
    end if;
    foreach status in array array['confirmed','packed','awaiting_tally_billing','billed_in_tally'] loop
      result := public.stockflow_order_gateway('rate-check-units-key',
        case when status='billed_in_tally' then 'billing@rateunits.test.local' else 'admin@rateunits.test.local' end,
        'transition_order',jsonb_build_object('orderId',o,
          'expectedVersion',(select version from private.stockflow_orders where id=o),
          'toStatus',status,'tallyInvoiceNumber',invoice,
          'idempotencyKey','rate-units-transition-'||scenario||'-'||status));
      if result->>'status' is distinct from status then raise exception 'Real billing transition failed: %',result; end if;
    end loop;
    insert into private.stockflow_tally_sales_prices(customer_id,tally_item_key,invoice_rate,invoice_date,invoice_reference,source_id,source_version,invoice_unit)
    values(customer,item,invoice_rate,today,invoice,item||'-invoice','1',unit);
    result := public.stockflow_pricing_gateway('rate-check-units-key','admin@rateunits.test.local',
      'get_order_pricing',jsonb_build_object('orderId',o,'view','rate_check'));
    checked_line := result->'lines'->0;
    if jsonb_array_length(result->'lines') is distinct from 1
      or checked_line->>'lineId' is distinct from line_id::text
      or checked_line->>'state' is distinct from expected_state
      or (checked_line->>'difference')::numeric is distinct from expected_delta
      or checked_line->>'orderUnit' is distinct from 'Nos'
      or checked_line->'invoiceUnits' is distinct from (case when unit is null then '[]'::jsonb else jsonb_build_array(unit) end)
      or (result->>'differentCount')::integer is distinct from (case when expected_state='matches' then 0 else 1 end)
      or result->>'state' is distinct from (case when expected_state='matches' then 'matches' else 'different' end) then
      raise exception 'Unit check failed for %: %',scenario,result;
    end if;
  end loop;
end $scenarios$;

grant select, insert, update on public.stockflow_snapshots to service_role;
create policy rate_units_snapshot_upload on public.stockflow_snapshots
  for all to service_role using (true) with check (true);
set local role service_role;
insert into public.stockflow_snapshots(id,company,fetched_at,payload)
values('suprabha','RATE UNITS TEST',now()::text,jsonb_build_object(
  'fetchedAtIso','rate-units-import','catalog','[]'::jsonb,'customers','[]'::jsonb,'tallyInvoices','[]'::jsonb,
  'pricingHistory',jsonb_build_object('purchaseCosts','[]'::jsonb,'sales',jsonb_build_array(jsonb_build_object(
    'customerTallyKey','rate-units-customer','tallyItemKey','RATE-UNITS-equal','rate',6000,
    'invoiceDate',(now() at time zone 'Asia/Kolkata')::date,'invoiceReference','SD/RATE-UNITS/IMPORT',
    'sourceId','rate-units-import','sourceVersion','1','unit',' Box ')))))
on conflict(id) do update set payload=excluded.payload;
reset role;
do $import$
begin
  if not exists(select 1 from private.stockflow_tally_sales_prices
    where source_id='rate-units-import' and source_version='1' and invoice_unit='Box') then
    raise exception 'Snapshot trigger did not persist trimmed unit';
  end if;
  if (select payload ? 'pricingHistory' from public.stockflow_snapshots where id='suprabha') then
    raise exception 'Pricing evidence leaked into snapshot';
  end if;
end $import$;
rollback;
