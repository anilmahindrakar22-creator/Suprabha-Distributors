-- Run after inventory migrations on a non-production database. Always rolls back.
begin;
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('allocation-test-key','sha256'),'hex') where name='orders';
insert into public.stockflow_members(email,role,status,updated_at) values('allocation-test@stockflow.local','administrator','active',now())
on conflict(email) do update set role='administrator',status='active',updated_at=now();

do $test$
declare
 v_product text; v_customer uuid; v_order uuid; v_order2 uuid; v_line uuid; v_line2 uuid;
 v_early numeric; v_late numeric; v_status text; v_reserved numeric; v_count integer; v_available numeric;
begin
 select tally_item_key into v_product from private.stockflow_products where active order by name limit 1;
 if v_product is null then raise exception 'No product synchronized'; end if;
 perform public.stockflow_inventory_gateway('allocation-test-key','allocation-test@stockflow.local','receive_stock',jsonb_build_object('idempotencyKey','fefo-receipt-early-0001','tallyKey',v_product,'batchNumber','FEFO-EARLY','expiryDate','2027-01-31','quantity',4));
 perform public.stockflow_inventory_gateway('allocation-test-key','allocation-test@stockflow.local','receive_stock',jsonb_build_object('idempotencyKey','fefo-receipt-late-0001','tallyKey',v_product,'batchNumber','FEFO-LATE','expiryDate','2028-01-31','quantity',5));
 insert into private.stockflow_customers(name,created_by_email) values('FEFO Test Customer','allocation-test@stockflow.local') returning id into v_customer;
 insert into private.stockflow_orders(customer_id,customer_name,status,idempotency_key,created_by_email,updated_by_email) values(v_customer,'FEFO Test Customer','confirmed','fefo-order-create-0001','allocation-test@stockflow.local','allocation-test@stockflow.local') returning id into v_order;
 insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,quantity,snapshot_closing) values(v_order,v_product,'FEFO Test Product',7,9) returning id into v_line;
 perform public.stockflow_allocation_gateway('allocation-test-key','allocation-test@stockflow.local','allocate_order',jsonb_build_object('idempotencyKey','fefo-allocate-order-0001','orderId',v_order,'expectedVersion',1));
 perform public.stockflow_allocation_gateway('allocation-test-key','allocation-test@stockflow.local','allocate_order',jsonb_build_object('idempotencyKey','fefo-allocate-order-0001','orderId',v_order,'expectedVersion',1));
 select coalesce(sum(reserved_delta),0) into v_early from private.stockflow_inventory_movements m join private.stockflow_batches b on b.id=m.batch_id where m.order_id=v_order and b.lot_number='FEFO-EARLY';
 select coalesce(sum(reserved_delta),0) into v_late from private.stockflow_inventory_movements m join private.stockflow_batches b on b.id=m.batch_id where m.order_id=v_order and b.lot_number='FEFO-LATE';
 select status into v_status from private.stockflow_orders where id=v_order; select reserved_quantity into v_reserved from private.stockflow_order_lines where id=v_line;
 select count(*) into v_count from private.stockflow_inventory_movements where order_id=v_order and movement_type='reservation';
 if v_early<>4 or v_late<>3 or v_status<>'fully_reserved' or v_reserved<>7 or v_count<>2 then raise exception 'FEFO/full/idempotency failed'; end if;
 insert into private.stockflow_orders(customer_id,customer_name,status,idempotency_key,created_by_email,updated_by_email) values(v_customer,'FEFO Partial Customer','confirmed','fefo-order-create-0002','allocation-test@stockflow.local','allocation-test@stockflow.local') returning id into v_order2;
 insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,quantity,snapshot_closing) values(v_order2,v_product,'FEFO Test Product',4,9) returning id into v_line2;
 perform public.stockflow_allocation_gateway('allocation-test-key','allocation-test@stockflow.local','allocate_order',jsonb_build_object('idempotencyKey','fefo-allocate-order-0002','orderId',v_order2,'expectedVersion',1));
 select status into v_status from private.stockflow_orders where id=v_order2; select reserved_quantity into v_reserved from private.stockflow_order_lines where id=v_line2;
 if v_status<>'partially_reserved' or v_reserved<>2 then raise exception 'Partial allocation failed'; end if;
 update private.stockflow_orders set status='cancelled',version=version+1,updated_by_email='allocation-test@stockflow.local' where id=v_order2;
 select reserved_quantity into v_reserved from private.stockflow_order_lines where id=v_line2;
 select coalesce(sum(available),0) into v_available from private.stockflow_inventory_balances where tally_item_key=v_product;
 if v_reserved<>0 or v_available<>2 then raise exception 'Cancellation release failed'; end if;
 perform public.stockflow_inventory_gateway('allocation-test-key','allocation-test@stockflow.local','bootstrap_inventory','{}'::jsonb);
end
$test$;
rollback;
