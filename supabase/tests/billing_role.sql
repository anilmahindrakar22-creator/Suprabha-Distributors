-- Run against a migrated non-production database. Self-contained; rolls back.
begin;
alter table public.stockflow_members drop constraint if exists stockflow_members_roles_pending_union;
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('billing-role-key','sha256'),'hex') where name='orders';
insert into public.stockflow_members(email,role,status) values
 ('billing-only@test.local','billing','active'),
 ('billing-sales@test.local','sales','active'),
 ('billing-viewer@test.local','viewer','active'),
 ('billing-admin@test.local','administrator','active');
update public.stockflow_members set roles=array[role] where email like 'billing-%@test.local';

do $test$
declare
  customer uuid; o uuid; line uuid; snapshot uuid; sheet jsonb; keys text[]; line_keys text[]; a text;
begin
  insert into private.stockflow_customers(name,tally_key,created_by_email) values('Billing Role Lab','billing-role-lab','test') returning id into customer;
  insert into private.stockflow_orders(customer_id,customer_name,source,status,idempotency_key,created_by_email,updated_by_email)
    values(customer,'Billing Role Lab','phone','packed','billing-role-order-0001','billing-sales@test.local','test') returning id into o;
  insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,base_unit,quantity,fulfilled_quantity)
    values(o,'BILLING-ITEM','Billing Reagent','Nos',3,2) returning id into line;
  insert into private.stockflow_billing_snapshots(order_id,snapshot_version,order_version,pricing_payload,snapshot_hash,created_by_email)
    values(o,1,1,jsonb_build_array(jsonb_build_object('order_line_id',line,'state','approved','approved_rate',450,'cost_amount',300,'gross_margin_percent',33.3,'gross_profit_amount',150,'source_reference','SD/26-27/0001')),
      repeat('a',64),'test') returning id into snapshot;
  update private.stockflow_orders set pricing_state='approved', pricing_snapshot_id=snapshot where id=o;

  -- Administrators read the sheet at any stage; billing-only staff only once the order reaches billing.
  sheet := public.stockflow_pricing_gateway('billing-role-key','billing-admin@test.local','get_order_pricing',jsonb_build_object('orderId',o,'view','billing'));
  if sheet->>'ready' <> 'true' then raise exception 'Administrator billing sheet not ready: %', sheet; end if;
  begin
    perform public.stockflow_pricing_gateway('billing-role-key','billing-only@test.local','get_order_pricing',jsonb_build_object('orderId',o,'view','billing'));
    raise exception 'Billing read a packed order before it reached billing';
  exception when insufficient_privilege then null; end;

  update private.stockflow_orders set status='awaiting_tally_billing', version=version+1 where id=o;
  sheet := public.stockflow_pricing_gateway('billing-role-key','billing-only@test.local','get_order_pricing',jsonb_build_object('orderId',o,'view','billing'));
  select array_agg(k order by k) into keys from jsonb_object_keys(sheet) k;
  if keys <> array['customerName','lines','orderId','orderNumber','ready','status','total','view'] then raise exception 'Unexpected billing keys %', keys; end if;
  select array_agg(k order by k) into line_keys from jsonb_object_keys(sheet->'lines'->0) k;
  if line_keys <> array['amount','approvedRate','billQuantity','itemName','lineId','orderedQuantity','packedQuantity','unit'] then raise exception 'Unexpected billing line keys %', line_keys; end if;
  if sheet::text ~* '(cost|margin|gross|profit|source)' then raise exception 'Billing sheet leaks commercial detail: %', sheet; end if;
  if (sheet->'lines'->0->>'approvedRate')::numeric <> 450 or (sheet->'lines'->0->>'billQuantity')::numeric <> 2 or (sheet->>'total')::numeric <> 900 then
    raise exception 'Billing amounts wrong: %', sheet;
  end if;

  -- An invalidated snapshot gives no rates.
  update private.stockflow_billing_snapshots set invalidated_at=now(), invalidation_reason='test' where id=snapshot;
  sheet := public.stockflow_pricing_gateway('billing-role-key','billing-admin@test.local','get_order_pricing',jsonb_build_object('orderId',o,'view','billing'));
  if sheet->>'ready' <> 'false' or sheet ? 'lines' then raise exception 'Invalidated snapshot still priced: %', sheet; end if;
  update private.stockflow_billing_snapshots set invalidated_at=null, invalidation_reason=null where id=snapshot;

  -- Sales and viewers never read billing prices; billing never reads the full pricing workspace.
  foreach a in array array['billing-sales@test.local','billing-viewer@test.local'] loop
    begin
      perform public.stockflow_pricing_gateway('billing-role-key',a,'get_order_pricing',jsonb_build_object('orderId',o,'view','billing'));
      raise exception 'Non-billing role % read billing prices', a;
    exception when insufficient_privilege then null; end;
  end loop;
  begin
    perform public.stockflow_pricing_gateway('billing-role-key','billing-only@test.local','get_order_pricing',jsonb_build_object('orderId',o));
    raise exception 'Billing read the full pricing workspace';
  exception when insufficient_privilege then null; end;
  begin
    perform public.stockflow_pricing_gateway('wrong-key','billing-only@test.local','get_order_pricing',jsonb_build_object('orderId',o,'view','billing'));
    raise exception 'Billing view accepted a wrong gateway key';
  exception when insufficient_privilege then null; end;

  -- Billing may mark billed, and nothing else in the transition table.
  perform private.assert_stockflow_order_transition(array['billing'],'awaiting_tally_billing','billed_in_tally',null,'SD/26-27/0099');
  begin
    perform private.assert_stockflow_order_transition(array['billing'],'packed','awaiting_tally_billing',null,null);
    raise exception 'Billing gained a non-billing transition';
  exception when insufficient_privilege then null; end;

  -- End to end through the real order gateway: billing punches the bill.
  sheet := public.stockflow_order_gateway('billing-role-key','billing-only@test.local','transition_order',
    jsonb_build_object('orderId',o,'expectedVersion',(select version from private.stockflow_orders where id=o),'toStatus','billed_in_tally',
      'tallyInvoiceNumber','SD/26-27/0099','idempotencyKey','billing-role-mark-billed-0001'));
  if sheet->>'status' <> 'billed_in_tally' or (select tally_invoice_number from private.stockflow_orders where id=o) <> 'SD/26-27/0099' then
    raise exception 'Billing could not mark the order billed: %', sheet;
  end if;
  begin
    perform public.stockflow_order_gateway('billing-role-key','billing-only@test.local','transition_order',
      jsonb_build_object('orderId',o,'expectedVersion',(select version from private.stockflow_orders where id=o),'toStatus','ready_for_dispatch','idempotencyKey','billing-role-dispatch-0001'));
    raise exception 'Billing moved a billed order to dispatch';
  exception when insufficient_privilege then null; end;

  if has_function_privilege('authenticated','private.stockflow_order_billing_sheet(uuid)','execute')
     or has_function_privilege('authenticated','public.stockflow_pricing_gateway(text,text,text,jsonb)','execute') then
    raise exception 'Billing functions exposed to clients';
  end if;
end $test$;
rollback;
