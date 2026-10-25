-- Run against a migrated non-production database. Self-contained; rolls back.
begin;
alter table public.stockflow_members drop constraint if exists stockflow_members_roles_pending_union;
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('billing-rate-check-key','sha256'),'hex') where name='orders';
insert into public.stockflow_members(email,role,status) values
 ('admin@ratecheck.test.local','administrator','active'),
 ('management@ratecheck.test.local','management','active'),
 ('accounts@ratecheck.test.local','accounts','active'),
 ('billing@ratecheck.test.local','billing','active'),
 ('sales@ratecheck.test.local','sales','active'),
 ('viewer@ratecheck.test.local','viewer','active'),
 ('operations@ratecheck.test.local','operations','active'),
 ('warehouse@ratecheck.test.local','warehouse','active');
update public.stockflow_members set roles=array[role] where email like '%@ratecheck.test.local';

do $test$
declare
  customer uuid; o uuid; line_a uuid; line_b uuid; snapshot uuid; incomplete_snapshot uuid;
  result jsonb; item jsonb; delegated jsonb; payload jsonb;
  keys text[]; a text; expected_checked integer;
  limitations constant jsonb := '["Units are not compared", "Items removed from a Tally invoice, or deleted vouchers, keep their last synced rates"]'::jsonb;
begin
  insert into private.stockflow_customers(name,tally_key,created_by_email)
    values('Rate Check Lab','rate-check-lab','test') returning id into customer;
  insert into private.stockflow_orders(customer_id,customer_name,source,status,idempotency_key,created_by_email,updated_by_email)
    values(customer,'Rate Check Lab','phone','billed_in_tally','rate-check-order-0001','sales@ratecheck.test.local','test') returning id into o;
  insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,base_unit,quantity,fulfilled_quantity)
    values(o,'ITEM-A','Item A','Nos',3,2) returning id into line_a;
  insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,base_unit,quantity,fulfilled_quantity)
    values(o,'ITEM-B','Item B','Nos',2,2) returning id into line_b;
  insert into private.stockflow_billing_snapshots(order_id,snapshot_version,order_version,pricing_payload,snapshot_hash,created_by_email)
    values(o,1,1,jsonb_build_array(
      jsonb_build_object('order_line_id',line_a,'state','approved','approved_rate',450,'cost_amount',300,'gross_margin_percent',33.3,'gross_profit_amount',150,'source_reference','SD/26-27/0001'),
      jsonb_build_object('order_line_id',line_b,'state','approved','approved_rate',120)),repeat('b',64),'test') returning id into snapshot;
  update private.stockflow_orders set pricing_state='approved', pricing_snapshot_id=snapshot where id=o;
  result := private.stockflow_order_rate_check(o);
  if result->>'state' is distinct from 'not_billed' or result->'lines' is distinct from '[]'::jsonb
     or result->'limitations' is distinct from limitations then raise exception 'Unbilled response wrong: %', result; end if;
  update private.stockflow_orders set tally_invoice_number='SD/26-27/9001' where id=o;
  if not exists(select 1 from private.stockflow_order_tally_invoices where order_id=o and voucher_reference='SD/26-27/9001') then
    raise exception 'Invoice link trigger did not populate the voucher';
  end if;
  payload := jsonb_build_object('orderId',o,'view','rate_check');

  result := private.stockflow_order_rate_check(o);
  if result->>'state' is distinct from 'waiting_for_tally' or result->'lines' is distinct from '[]'::jsonb
     or result->'limitations' is distinct from limitations then raise exception 'Expected waiting for Tally: %', result; end if;
  insert into private.stockflow_tally_sales_prices(customer_id,tally_item_key,invoice_rate,invoice_date,invoice_reference,source_id,source_version,imported_at)
    values(customer,'ITEM-A',450.80,current_date,'SD/26-27/9001','ratecheck-9001|1|ITEM-A','v0',now()),
      (customer,'ITEM-B',120.00,current_date,'SD/26-27/9001','ratecheck-9001|2|ITEM-B','v0',now());
  result := private.stockflow_order_rate_check(o);
  if result->>'state' is distinct from 'matches' or (result->>'differentCount')::integer is distinct from 0
     or jsonb_array_length(result->'lines') <> 2 then raise exception 'Within tolerance did not match: %', result; end if;
  select e into item from jsonb_array_elements(result->'lines') e where e->>'lineId'=line_a::text;
  if item->'invoiceRates' is distinct from '[450.80]'::jsonb or (item->>'difference')::numeric is distinct from 0.80 then
    raise exception 'Within tolerance difference wrong: %', item;
  end if;

  -- Rate changes append history; exceptional invoice lines still count.
  insert into private.stockflow_tally_sales_prices(customer_id,tally_item_key,invoice_rate,invoice_date,invoice_reference,source_id,source_version,imported_at,exceptional,exception_type)
    values(customer,'ITEM-A',448.50,current_date,'SD/26-27/9001','ratecheck-9001|1|ITEM-A','v0-edited',now()+interval '1 second',true,'correction');
  result := private.stockflow_order_rate_check(o);
  select e into item from jsonb_array_elements(result->'lines') e where e->>'lineId'=line_a::text;
  if result->>'state' is distinct from 'different' or (result->>'differentCount')::integer is distinct from 1
     or item->>'state' is distinct from 'different' or (item->>'difference')::numeric is distinct from -1.50 then
    raise exception 'Wrong rate was not flagged: %', result;
  end if;
  insert into private.stockflow_tally_sales_prices(customer_id,tally_item_key,invoice_rate,invoice_date,invoice_reference,source_id,source_version)
    values(customer,'ITEM-C',50,current_date,'SD/26-27/9001','ratecheck-9001|3|ITEM-C','v0');
  result := private.stockflow_order_rate_check(o);
  select e into item from jsonb_array_elements(result->'lines') e where e->>'tallyKey'='ITEM-C';
  if item->>'state' is distinct from 'not_on_order' or item->'lineId' is distinct from 'null'::jsonb
     or item->>'itemName' is distinct from coalesce((select name from private.stockflow_products where tally_item_key='ITEM-C'),'ITEM-C') then
    raise exception 'Extra invoice item missing: %', result;
  end if;
  -- Only this fixture deletion bypasses the history guard, inside the rolled-back transaction.
  alter table private.stockflow_tally_sales_prices disable trigger stockflow_tally_sales_price_no_delete;
  delete from private.stockflow_tally_sales_prices where customer_id=customer and tally_item_key='ITEM-B';
  alter table private.stockflow_tally_sales_prices enable trigger stockflow_tally_sales_price_no_delete;
  result := private.stockflow_order_rate_check(o);
  select e into item from jsonb_array_elements(result->'lines') e where e->>'lineId'=line_b::text;
  if item->>'state' is distinct from 'missing_on_invoice' or item->'invoiceRates' is distinct from '[]'::jsonb
     or item->'difference' is distinct from 'null'::jsonb then raise exception 'Missing item not flagged: %', result; end if;

  select array_agg(k order by k) into keys from jsonb_object_keys(result) k;
  if keys is distinct from array['customerName','differentCount','limitations','lines','orderId','orderNumber','state','status','tolerance','view'] then
    raise exception 'Unexpected rate check keys: %', keys;
  end if;
  for item in select value from jsonb_array_elements(result->'lines') loop
    select array_agg(k order by k) into keys from jsonb_object_keys(item) k;
    if keys is distinct from array['approvedRate','difference','invoiceRates','itemName','lineId','state','tallyKey'] then
      raise exception 'Unexpected rate line keys: %', keys;
    end if;
  end loop;
  if (result - 'limitations')::text ~* '(cost|margin|gross|profit|source|reference)' then
    raise exception 'Rate check leaks commercial detail: %', result;
  end if;
  if result->'limitations' is distinct from limitations or (result->>'tolerance')::numeric is distinct from 1.00 then
    raise exception 'Rate check limitations or tolerance wrong: %', result;
  end if;
  if (select jsonb_agg(e->>'lineId' order by ord) from jsonb_array_elements(result->'lines') with ordinality as t(e,ord) where e->>'lineId' is not null)
     is distinct from (select jsonb_agg(id::text order by created_at,id) from private.stockflow_order_lines where order_id=o) then
    raise exception 'Order line ordering wrong: %', result;
  end if;

  update private.stockflow_billing_snapshots set invalidated_at=now(), invalidation_reason='test' where id=snapshot;
  result := private.stockflow_order_rate_check(o);
  if result->>'state' is distinct from 'no_approved_price' or result->'lines' is distinct from '[]'::jsonb
     or result->'limitations' is distinct from limitations then raise exception 'Invalidated snapshot still priced: %', result; end if;
  update private.stockflow_billing_snapshots set invalidated_at=null, invalidation_reason=null where id=snapshot;

  insert into private.stockflow_tally_sales_prices(customer_id,tally_item_key,invoice_rate,invoice_date,invoice_reference,source_id,source_version,imported_at)
    values(customer,'ITEM-A',440.00,current_date,'SD/26-27/9001','ratecheck-9001|1|ITEM-A','v1',now()+interval '2 seconds');
  result := private.stockflow_order_rate_check(o);
  select e into item from jsonb_array_elements(result->'lines') e where e->>'lineId'=line_a::text;
  if (item->>'difference')::numeric is distinct from -10 then raise exception 'Wrong revision not detected: %', item; end if;
  insert into private.stockflow_tally_sales_prices(customer_id,tally_item_key,invoice_rate,invoice_date,invoice_reference,source_id,source_version,imported_at)
    values(customer,'ITEM-A',450.00,current_date,'SD/26-27/9001','ratecheck-9001|1|ITEM-A','v2',now()+interval '3 seconds');
  result := private.stockflow_order_rate_check(o);
  select e into item from jsonb_array_elements(result->'lines') e where e->>'lineId'=line_a::text;
  if item->>'state' is distinct from 'matches' or item->'invoiceRates' is distinct from '[450.00]'::jsonb
     or (item->>'difference')::numeric is distinct from 0 then raise exception 'Old revision still counted: %', item; end if;

  insert into private.stockflow_tally_sales_prices(customer_id,tally_item_key,invoice_rate,invoice_date,invoice_reference,source_id,source_version,imported_at)
    values(customer,'ITEM-A',451.00,current_date,' sd/26-27/9001 ','ratecheck-9001|1|ITEM-A','v3',now()+interval '4 seconds');
  result := private.stockflow_order_rate_check(o);
  select e into item from jsonb_array_elements(result->'lines') e where e->>'lineId'=line_a::text;
  if item->>'state' is distinct from 'matches' or item->'invoiceRates' is distinct from '[451.00]'::jsonb
     or (item->>'difference')::numeric is distinct from 1 then raise exception 'Normalized voucher or exact tolerance failed: %', item; end if;

  foreach a in array array['admin','management','accounts'] loop
    result := public.stockflow_pricing_gateway('billing-rate-check-key',a||'@ratecheck.test.local','get_order_pricing',payload);
    if result->>'view' is distinct from 'rate_check' or result->>'orderId' is distinct from o::text then
      raise exception 'Allowed role % did not get rate check: %', a, result;
    end if;
  end loop;
  foreach a in array array['billing','sales','viewer','operations','warehouse'] loop
    begin
      perform public.stockflow_pricing_gateway('billing-rate-check-key',a||'@ratecheck.test.local','get_order_pricing',payload);
      raise exception 'Restricted role % read rate check', a;
    exception when insufficient_privilege then null; end;
  end loop;
  begin
    perform public.stockflow_pricing_gateway('wrong-key','admin@ratecheck.test.local','get_order_pricing',payload);
    raise exception 'Wrong gateway key accepted';
  exception when insufficient_privilege then null; end;
  foreach a in array array['{}','{"orderId":"bad-id"}'] loop
    begin
      perform public.stockflow_pricing_gateway('billing-rate-check-key','admin@ratecheck.test.local','get_order_pricing',a::jsonb||jsonb_build_object('view','rate_check'));
      raise exception 'Invalid order ID accepted';
    exception when invalid_parameter_value then null; end;
  end loop;
  select least(50,count(*))::integer into expected_checked from private.stockflow_orders
    where tally_invoice_number is not null and archived_at is null and status in ('billed_in_tally','ready_for_dispatch','dispatched','delivered');
  foreach a in array array['admin','management'] loop
    result := public.stockflow_pricing_gateway('billing-rate-check-key',a||'@ratecheck.test.local','get_order_pricing',jsonb_build_object('view','rate_exceptions'));
    select e into item from jsonb_array_elements(result->'orders') e where e->>'orderId'=o::text;
    if result->>'view' is distinct from 'rate_exceptions' or (result->>'checkedCount')::integer is distinct from expected_checked
       or coalesce((item->>'differentCount')::integer,0) < 1 or (item->>'worstDifference')::numeric is distinct from 1 then
      raise exception 'Exception list wrong for %: %', a, result;
    end if;
  end loop;
  begin
    perform public.stockflow_pricing_gateway('billing-rate-check-key','accounts@ratecheck.test.local','get_order_pricing',jsonb_build_object('view','rate_exceptions'));
    raise exception 'Accounts read rate exceptions';
  exception when insufficient_privilege then null; end;

  result := public.stockflow_pricing_gateway('billing-rate-check-key','admin@ratecheck.test.local','get_order_pricing',jsonb_build_object('orderId',o));
  delegated := public.stockflow_pricing_gateway_before_rate_check('billing-rate-check-key','admin@ratecheck.test.local','get_order_pricing',jsonb_build_object('orderId',o));
  if result is distinct from delegated or coalesce(result->>'view','') in ('rate_check','rate_exceptions','billing') then
    raise exception 'Missing view did not delegate: %', result;
  end if;
  result := public.stockflow_pricing_gateway('billing-rate-check-key','admin@ratecheck.test.local','get_order_pricing',jsonb_build_object('orderId',o,'view','billing'));
  if result->>'view' is distinct from 'billing' or result->>'ready' is distinct from 'true' then
    raise exception 'Billing view did not delegate: %', result;
  end if;

  insert into private.stockflow_tally_sales_prices(customer_id,tally_item_key,invoice_rate,invoice_date,invoice_reference,source_id,source_version)
    values(customer,'ITEM-A',448.50,current_date,'SD/26-27/9001','ratecheck-9001|4|ITEM-A','v0'),
      (customer,'ITEM-A',451.00,current_date,'SD/26-27/9001','ratecheck-9001|5|ITEM-A','v0');
  result := private.stockflow_order_rate_check(o);
  select e into item from jsonb_array_elements(result->'lines') e where e->>'lineId'=line_a::text;
  if item->'invoiceRates' is distinct from '[448.50,451.00]'::jsonb or (item->>'difference')::numeric is distinct from -1.50
     or item->>'state' is distinct from 'different' then raise exception 'Distinct rates or furthest difference wrong: %', item; end if;

  insert into private.stockflow_billing_snapshots(order_id,snapshot_version,order_version,pricing_payload,snapshot_hash,created_by_email)
    values(o,2,1,'[]'::jsonb,repeat('c',64),'test') returning id into incomplete_snapshot;
  update private.stockflow_orders set pricing_snapshot_id=incomplete_snapshot where id=o;
  result := private.stockflow_order_rate_check(o);
  select e into item from jsonb_array_elements(result->'lines') e where e->>'lineId'=line_a::text;
  if item->>'state' is distinct from 'no_approved_rate' or item->'approvedRate' is distinct from 'null'::jsonb
     or item->'difference' is distinct from 'null'::jsonb then raise exception 'Missing approved rate wrong: %', item; end if;
  result := public.stockflow_pricing_gateway('billing-rate-check-key','admin@ratecheck.test.local','get_order_pricing',jsonb_build_object('view','rate_exceptions'));
  select e into item from jsonb_array_elements(result->'orders') e where e->>'orderId'=o::text;
  if item->'worstDifference' is distinct from 'null'::jsonb then raise exception 'Unknown differences should stay null: %', item; end if;
  update private.stockflow_orders set pricing_snapshot_id=snapshot where id=o;
  update private.stockflow_orders set archived_at=now() where id=o;
  begin
    perform private.stockflow_order_rate_check(o);
    raise exception 'Archived order was accepted';
  exception when invalid_parameter_value then null; end;
  update private.stockflow_orders set archived_at=null where id=o;
  begin
    perform private.stockflow_order_rate_check(extensions.gen_random_uuid());
    raise exception 'Missing order was accepted';
  exception when invalid_parameter_value then null; end;
  if has_function_privilege('authenticated','public.stockflow_pricing_gateway(text,text,text,jsonb)','execute')
     or has_function_privilege('authenticated','public.stockflow_pricing_gateway_before_rate_check(text,text,text,jsonb)','execute')
     or has_function_privilege('authenticated','private.stockflow_order_rate_check(uuid)','execute') then
    raise exception 'Rate check functions exposed to clients';
  end if;
end $test$;
rollback;
