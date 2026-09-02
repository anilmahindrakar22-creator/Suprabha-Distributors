-- Run against a migrated non-production database. This test is self-contained and rolls back.
begin;

update private.stockflow_gateway_config
set secret_sha256=encode(extensions.digest('inventory-integration-test','sha256'),'hex')
where name='orders';

insert into public.stockflow_members(email,role,status,updated_at)
values('inventory-test@stockflow.local','administrator','active',now())
on conflict(email) do update set role='administrator',status='active',updated_at=now();

insert into private.stockflow_products(tally_item_key,name,item_group,base_unit,tracking_mode)
values('INVENTORY-TEST-ITEM','Inventory Test Reagent','Test','box','expiry')
on conflict(tally_item_key) do update set active=true,tracking_mode='expiry';

do $test$
declare
  v_first jsonb; v_replay jsonb; v_count integer; v_on_hand numeric; v_available numeric; v_failed boolean:=false;
begin
  v_first:=public.stockflow_inventory_gateway('inventory-integration-test','inventory-test@stockflow.local','receive_stock',
    jsonb_build_object('idempotencyKey','inventory-receipt-test-0001','tallyKey','INVENTORY-TEST-ITEM','batchNumber','LOT-TEST-1','expiryDate','2027-12-31','quantity',5,'locationCode','MAIN'));
  v_replay:=public.stockflow_inventory_gateway('inventory-integration-test','inventory-test@stockflow.local','receive_stock',
    jsonb_build_object('idempotencyKey','inventory-receipt-test-0001','tallyKey','INVENTORY-TEST-ITEM','batchNumber','LOT-TEST-1','expiryDate','2027-12-31','quantity',5,'locationCode','MAIN'));
  if v_first<>v_replay then raise exception 'Duplicate receipt did not replay its original result'; end if;
  select count(*) into v_count from private.stockflow_inventory_movements where request_id='inventory-receipt-test-0001';
  if v_count<>1 then raise exception 'Duplicate receipt created % movements',v_count; end if;

  perform public.stockflow_inventory_gateway('inventory-integration-test','inventory-test@stockflow.local','adjust_stock',
    jsonb_build_object('idempotencyKey','inventory-adjust-test-0001','tallyKey','INVENTORY-TEST-ITEM','batchNumber','LOT-TEST-1','quantityDelta',-2,'reason','Verified test count','locationCode','MAIN'));
  select on_hand into v_on_hand from private.stockflow_inventory_balances where tally_item_key='INVENTORY-TEST-ITEM' and lot_number='LOT-TEST-1';
  if v_on_hand<>3 then raise exception 'Expected on hand 3, got %',v_on_hand; end if;

  begin
    perform public.stockflow_inventory_gateway('inventory-integration-test','inventory-test@stockflow.local','adjust_stock',
      jsonb_build_object('idempotencyKey','inventory-adjust-test-0002','tallyKey','INVENTORY-TEST-ITEM','batchNumber','LOT-TEST-1','quantityDelta',-4,'reason','Must fail','locationCode','MAIN'));
  exception when invalid_parameter_value then v_failed:=true;
  end;
  if not v_failed then raise exception 'Negative inventory adjustment was accepted'; end if;

  begin
    update private.stockflow_inventory_movements set reason='tampered' where request_id='inventory-receipt-test-0001';
    raise exception 'Append-only movement was updated';
  exception when others then
    if sqlerrm='Append-only movement was updated' then raise; end if;
  end;

  perform public.stockflow_inventory_gateway('inventory-integration-test','inventory-test@stockflow.local','receive_stock',
    jsonb_build_object('idempotencyKey','inventory-expired-test-0001','tallyKey','INVENTORY-TEST-ITEM','batchNumber','LOT-EXPIRED','expiryDate','2020-01-01','quantity',1,'locationCode','MAIN'));
  select available into v_available from private.stockflow_inventory_balances where tally_item_key='INVENTORY-TEST-ITEM' and lot_number='LOT-EXPIRED';
  if v_available<>0 then raise exception 'Expired stock remained available'; end if;
end
$test$;

rollback;
