-- Disposable migrated database only. Orders, lines, approvals and events use real gateways.
begin;
alter table public.stockflow_members drop constraint if exists stockflow_members_roles_pending_union;
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('challan-test-key','sha256'),'hex') where name='orders';
insert into public.stockflow_members(email,role,status,roles) values
 ('challan-admin@test.local','administrator','active',array['administrator']),
 ('challan-operations@test.local','operations','active',array['operations']),
 ('challan-combined@test.local','sales','active',array['sales','operations']),
 ('challan-billing@test.local','billing','active',array['billing']),
 ('challan-accounts@test.local','accounts','active',array['accounts']),
 ('challan-warehouse@test.local','warehouse','active',array['warehouse']),
 ('challan-viewer@test.local','viewer','active',array['viewer']),
 ('challan-sales@test.local','sales','active',array['sales']);
update private.stockflow_pricing_policies set active=false where active;
insert into private.stockflow_pricing_policies(policy_version,minimum_margin_percent,target_margin_percent,
 override_approval_percent,rounding_increment,rounding_rule_version,effective_from,created_by_email)
values('challan-test',25,30,5,1,'challan-rounding',(now() at time zone 'Asia/Kolkata')::date-90,'test');

create function pg_temp.challan_command(p_order uuid,p_action text,p_extra jsonb default '{}',p_actor text default 'challan-admin@test.local')
returns jsonb language plpgsql as $$
declare payload jsonb;
begin
  delete from private.stockflow_request_log where actor_email=p_actor;
  payload:=jsonb_build_object('orderId',p_order,'expectedVersion',(select version from private.stockflow_orders where id=p_order),
    'idempotencyKey','challan-command-'||gen_random_uuid())||p_extra;
  if p_action in ('save_dispatch','confirm_delivery') then
    return public.stockflow_delivery_gateway('challan-test-key',p_actor,p_action,payload);
  elsif p_action='save_fulfilment' then
    return public.stockflow_fulfilment_gateway('challan-test-key',p_actor,p_action,payload);
  end if;
  return public.stockflow_order_gateway('challan-test-key',p_actor,p_action,payload);
end $$;

create function pg_temp.challan_create(p_customer uuid,p_item text,p_pack boolean default true)
returns uuid language plpgsql as $$
declare r jsonb; o uuid;
begin
  delete from private.stockflow_request_log where actor_email='challan-admin@test.local';
  r:=public.stockflow_order_gateway('challan-test-key','challan-admin@test.local','create_order',
    jsonb_build_object('customerId',p_customer,'customerName','Challan Test Hospital','source','phone',
      'idempotencyKey','challan-create-'||gen_random_uuid(),
      'lines',jsonb_build_array(jsonb_build_object('tallyKey',p_item,'quantity',3))));
  o:=(r->>'orderId')::uuid;
  if o is null or r->>'status' is distinct from 'awaiting_confirmation' then raise exception 'Create failed: %',r; end if;
  if p_pack then
    -- Governed confirmation is the real auto-approval path used by push_alerts.sql.
    perform pg_temp.challan_command(o,'transition_order','{"toStatus":"confirmed"}');
    perform pg_temp.challan_command(o,'save_fulfilment',jsonb_build_object('deliveryAddress','Challan test address',
      'lines',jsonb_build_array(jsonb_build_object('tallyKey',p_item,'fulfilledQuantity',3))));
    perform pg_temp.challan_command(o,'transition_order','{"toStatus":"packed"}');
  end if;
  return o;
end $$;

create function pg_temp.challan_reject(p_order uuid,p_action text,p_extra jsonb,p_actor text,p_code text)
returns void language plpgsql as $$
begin
  begin
    perform pg_temp.challan_command(p_order,p_action,p_extra,p_actor);
  exception when others then
    if sqlstate=p_code then return; end if;
    raise exception 'Expected %, got %: %',p_code,sqlstate,sqlerrm;
  end;
  raise exception 'Expected % rejection for %',p_code,p_action;
end $$;

do $test$
declare customer uuid; o uuid; unpriced uuid; early_order uuid; normal_order uuid; combined_order uuid;
  r jsonb; replay jsonb; payload jsonb; a text; today date:=(now() at time zone 'Asia/Kolkata')::date;
  initial_version integer; invoice text:='SD/'||private.stockflow_financial_year(now())||'/CHALLAN-1';
  normal_invoice text:='SD/'||private.stockflow_financial_year(now())||'/NORMAL-1';
begin
  insert into private.stockflow_customers(name,tally_key,created_by_email)
    values('Challan Test Hospital','challan-test-hospital','test') returning id into customer;
  insert into private.stockflow_products(tally_item_key,name,base_unit) values
    ('CHALLAN-ITEM','Challan reagent','Nos'),('CHALLAN-UNPRICED','Unpriced reagent','Nos');
  insert into private.stockflow_tally_purchase_costs(tally_item_key,cost_amount,cost_kind,effective_at,source_reference,source_id,source_version)
    values('CHALLAN-ITEM',3465,'purchase_price',today-20,'challan-cost','challan-cost','1');
  insert into private.stockflow_tally_sales_prices(customer_id,tally_item_key,invoice_rate,invoice_date,invoice_reference,source_id,source_version)
    values(customer,'CHALLAN-ITEM',6000,today-10,'CHALLAN-PRIOR','challan-sale','1');
  insert into public.stockflow_snapshots(id,company,fetched_at,payload)
    values('suprabha','CHALLAN TEST',now()::text,jsonb_build_object('catalog',jsonb_build_array(
      jsonb_build_object('tallyKey','CHALLAN-ITEM','item','Challan reagent','baseUnit','Nos','group','Challan tests','closing',10,'active',true),
      jsonb_build_object('tallyKey','CHALLAN-UNPRICED','item','Unpriced reagent','baseUnit','Nos','group','Challan tests','closing',10,'active',true))))
    on conflict(id) do update set payload=excluded.payload;
  o:=pg_temp.challan_create(customer,'CHALLAN-ITEM');
  unpriced:=pg_temp.challan_create(customer,'CHALLAN-UNPRICED');
  early_order:=pg_temp.challan_create(customer,'CHALLAN-ITEM',false);
  normal_order:=pg_temp.challan_create(customer,'CHALLAN-ITEM');
  if not exists(select 1 from private.stockflow_orders where id=o and pricing_state='approved' and pricing_snapshot_id is not null)
     or not exists(select 1 from private.stockflow_orders where id=unpriced and status='packed' and pricing_state<>'approved') then
    raise exception 'Fixture did not exercise governed approval and unapproved packed paths';
  end if;
  if exists(select 1 from private.stockflow_order_transition_rules where from_status='packed' and to_status='ready_for_dispatch') then
    raise exception 'Generic billing bypass was introduced';
  end if;
  perform pg_temp.challan_reject(o,'transition_order','{"toStatus":"ready_for_dispatch"}','challan-admin@test.local','22023');
  perform pg_temp.challan_reject(unpriced,'send_on_challan','{"challanNumber":"DC-REJECT"}','challan-operations@test.local','22023');
  perform pg_temp.challan_reject(early_order,'send_on_challan','{"challanNumber":"DC-REJECT"}','challan-operations@test.local','22023');
  foreach a in array array['viewer','warehouse','accounts','billing'] loop
    perform pg_temp.challan_reject(o,'send_on_challan','{"challanNumber":"DC-REJECT"}','challan-'||a||'@test.local','42501');
  end loop;
  perform pg_temp.challan_reject(o,'send_on_challan','{"challanNumber":"   "}','challan-operations@test.local','22023');
  perform pg_temp.challan_reject(o,'send_on_challan',jsonb_build_object('challanNumber',repeat('x',41)),'challan-operations@test.local','22023');
  perform pg_temp.challan_reject(o,'send_on_challan','{"challanNumber":"DC-REJECT","expectedVersion":0}','challan-operations@test.local','PT409');
  select version into initial_version from private.stockflow_orders where id=o;
  payload:=jsonb_build_object('orderId',o,'expectedVersion',initial_version,'challanNumber','  DC-001  ','idempotencyKey','challan-send-replay-001');
  r:=public.stockflow_order_gateway('challan-test-key','challan-operations@test.local','send_on_challan',payload);
  replay:=public.stockflow_order_gateway('challan-test-key','challan-operations@test.local','send_on_challan',payload);
  if r is distinct from replay or r->>'status' is distinct from 'ready_for_dispatch'
     or not exists(select 1 from private.stockflow_orders where id=o and status='ready_for_dispatch'
       and challan_number='DC-001' and challan_at is not null and challan_billed_at is null and version=initial_version+1)
     or (select count(*) from private.stockflow_order_events where order_id=o and event_type='sent_on_challan'
       and metadata->>'challanNumber'='DC-001' and from_status='packed' and to_status='ready_for_dispatch')<>1 then
    raise exception 'Challan send, event or replay failed: %',r;
  end if;
  perform pg_temp.challan_reject(o,'bill_challan',jsonb_build_object('invoiceNumber',invoice),'challan-sales@test.local','42501');
  perform pg_temp.challan_reject(normal_order,'bill_challan',jsonb_build_object('invoiceNumber',invoice),'challan-billing@test.local','22023');
  perform pg_temp.challan_reject(o,'bill_challan','{"invoiceNumber":""}','challan-billing@test.local','22023');
  perform pg_temp.challan_reject(o,'bill_challan',jsonb_build_object('invoiceNumber',repeat('x',161)),'challan-billing@test.local','22023');
  perform pg_temp.challan_reject(o,'bill_challan',jsonb_build_object('invoiceNumber',invoice,'expectedVersion',0),'challan-billing@test.local','PT409');
  -- Billing authority comes from the live transition rule, not a copied role list.
  update private.stockflow_order_transition_rules set allowed_roles=array_remove(allowed_roles,'billing')
    where from_status='awaiting_tally_billing' and to_status='billed_in_tally';
  perform pg_temp.challan_reject(o,'bill_challan',jsonb_build_object('invoiceNumber',invoice),'challan-billing@test.local','42501');
  update private.stockflow_order_transition_rules set allowed_roles=array_append(allowed_roles,'billing')
    where from_status='awaiting_tally_billing' and to_status='billed_in_tally';
  perform pg_temp.challan_command(o,'save_dispatch',jsonb_build_object('courierName','Test Transport','trackingNumber','TRACK-001','dispatchDate',current_date),'challan-operations@test.local');
  perform pg_temp.challan_command(o,'confirm_delivery',jsonb_build_object('deliveredAt',now(),'receivedBy','Test Receiver'),'challan-operations@test.local');
  r:=public.stockflow_order_list_gateway('challan-test-key','challan-billing@test.local','list_orders','{"status":"challan_unbilled"}');
  if (r->'pagination'->>'total')::integer<>1 or (r->'operations'->>'challanUnbilled')::integer<>1
     or r->'orders'->0->>'id' is distinct from o::text or r->'orders'->0->>'status' is distinct from 'delivered'
     or r->'orders'->0->>'challanNumber' is distinct from 'DC-001'
     or r->'orders'->0->>'challanOverdue' is distinct from 'false' then
    raise exception 'Delivered unbilled challan missing or current month overdue: %',r;
  end if;
  update private.stockflow_role_order_scopes set scope='created_by' where role='billing';
  r:=public.stockflow_order_list_gateway('challan-test-key','challan-billing@test.local','list_orders','{"status":"challan_unbilled"}');
  if (r->'pagination'->>'total')::integer<>0 or (r->'operations'->>'challanUnbilled')::integer<>0 then
    raise exception 'Challan list or totals bypassed order access: %',r;
  end if;
  perform pg_temp.challan_reject(o,'bill_challan',jsonb_build_object('invoiceNumber',invoice),'challan-billing@test.local','42501');
  update private.stockflow_role_order_scopes set scope='global' where role='billing';
  update private.stockflow_orders set challan_at=(date_trunc('month',now() at time zone 'Asia/Kolkata')-interval '1 second') at time zone 'Asia/Kolkata' where id=o;
  r:=public.stockflow_order_list_gateway('challan-test-key','challan-billing@test.local','list_orders','{"status":"challan_unbilled"}');
  if r->'orders'->0->>'challanOverdue' is distinct from 'true' or (r->'operations'->>'challanOverdue')::integer<>1 then
    raise exception 'Previous IST month challan not overdue: %',r;
  end if;
  update private.stockflow_orders set challan_at=date_trunc('month',now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' where id=o;
  r:=public.stockflow_order_list_gateway('challan-test-key','challan-billing@test.local','list_orders','{"status":"challan_unbilled"}');
  if r->'orders'->0->>'challanOverdue' is distinct from 'false' then raise exception 'IST month boundary wrong'; end if;
  select version into initial_version from private.stockflow_orders where id=o;
  payload:=jsonb_build_object('orderId',o,'expectedVersion',initial_version,'invoiceNumber','  '||invoice||'  ','idempotencyKey','challan-bill-replay-001');
  r:=public.stockflow_order_gateway('challan-test-key','challan-billing@test.local','bill_challan',payload);
  replay:=public.stockflow_order_gateway('challan-test-key','challan-billing@test.local','bill_challan',payload);
  if r is distinct from replay or r->>'status' is distinct from 'delivered'
     or not exists(select 1 from private.stockflow_orders where id=o and status='delivered' and tally_invoice_number=invoice
       and challan_billed_at is not null and version=initial_version+1)
     or not exists(select 1 from private.stockflow_order_tally_invoices where order_id=o and voucher_reference=invoice and linked_at is not null)
     or (select count(*) from private.stockflow_order_events where order_id=o and event_type='challan_billed'
       and metadata->>'tallyInvoiceNumber'=invoice and from_status='delivered' and to_status='delivered')<>1 then
    raise exception 'Billing changed delivery, lost invoice link, or replayed twice: %',r;
  end if;
  perform pg_temp.challan_reject(o,'bill_challan',jsonb_build_object('invoiceNumber',invoice),'challan-billing@test.local','22023');
  r:=public.stockflow_order_list_gateway('challan-test-key','challan-billing@test.local','list_orders','{"status":"challan_unbilled"}');
  if (r->'pagination'->>'total')::integer<>0 or (r->'operations'->>'challanUnbilled')::integer<>0
     or (r->'operations'->>'challanOverdue')::integer<>0 then raise exception 'Billed challan remained open: %',r; end if;

  -- The ordinary invoice-first path still writes the identical invoice column and link table.
  perform pg_temp.challan_command(normal_order,'transition_order','{"toStatus":"awaiting_tally_billing"}');
  perform pg_temp.challan_command(normal_order,'transition_order',jsonb_build_object('toStatus','billed_in_tally','tallyInvoiceNumber','  '||normal_invoice||'  '),'challan-billing@test.local');
  if not exists(select 1 from private.stockflow_orders n join private.stockflow_order_tally_invoices l on l.order_id=n.id
      where n.id=normal_order and n.status='billed_in_tally' and n.tally_invoice_number=normal_invoice
        and l.voucher_reference=normal_invoice and n.challan_number is null and n.challan_billed_at is null) then
    raise exception 'Normal billing invoice storage changed';
  end if;
  perform pg_temp.challan_command(normal_order,'transition_order','{"toStatus":"ready_for_dispatch"}');
  perform pg_temp.challan_command(normal_order,'save_dispatch',jsonb_build_object('courierName','Test Transport','trackingNumber','TRACK-002','dispatchDate',current_date));
  perform pg_temp.challan_command(normal_order,'confirm_delivery',jsonb_build_object('deliveredAt',now(),'receivedBy','Test Receiver'));
  combined_order:=pg_temp.challan_create(customer,'CHALLAN-ITEM');
  r:=pg_temp.challan_command(combined_order,'send_on_challan','{"challanNumber":"DC-COMBINED"}','challan-combined@test.local');
  if r->>'status' is distinct from 'ready_for_dispatch' then raise exception 'Combined operations role rejected'; end if;
  if has_function_privilege('authenticated','public.stockflow_order_gateway(text,text,text,jsonb)','execute')
    or has_function_privilege('service_role','public.stockflow_order_gateway_before_challan(text,text,text,jsonb)','execute') then
    raise exception 'Challan wrapper grants are unsafe';
  end if;
end $test$;
rollback;
