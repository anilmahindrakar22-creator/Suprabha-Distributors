-- Real producer/reader integration. Only external inputs and test auth are seeded;
-- orders, lines, decisions, billing snapshots, invoices and versions use gateways.
begin;
alter table public.stockflow_members drop constraint if exists stockflow_members_roles_pending_union;
update private.stockflow_gateway_config
set secret_sha256=encode(extensions.digest('real-path-readers-key','sha256'),'hex') where name='orders';
update private.stockflow_pricing_policies set active=false where active;
insert into private.stockflow_pricing_policies(policy_version,minimum_margin_percent,target_margin_percent,
  override_approval_percent,rounding_increment,rounding_rule_version,effective_from,created_by_email)
values('real-path-readers',25,30,5,1,'real-path-rounding',(now() at time zone 'Asia/Kolkata')::date-90,'test');
insert into public.stockflow_members(email,role,status) values
  ('admin@realpath.test.local','administrator','active'),
  ('requester@realpath.test.local','accounts','active'),
  ('management@realpath.test.local','management','active'),
  ('billing@realpath.test.local','billing','active'),
  ('reviewer@realpath.test.local','sales','active'),
  ('denied@realpath.test.local','warehouse','active');
update public.stockflow_members set roles=array[role] where email like '%@realpath.test.local';
-- Same role unions as combined_role_billing_review.sql.
update public.stockflow_members set roles=array['sales','accounts'] where email='reviewer@realpath.test.local';
update public.stockflow_members set roles=array['sales','warehouse'] where email='denied@realpath.test.local';

-- Section 4: both the public summary and its authoritative helper must agree.
-- Called before/after each transition below, including confirm -> packed ->
-- awaiting_tally_billing -> billed_in_tally. Repeated reads must be stable.
create function pg_temp.real_path_revision()
returns text language plpgsql as $$
declare revision text; repeated text;
begin
  revision := public.stockflow_order_summary_gateway('real-path-readers-key',
    'admin@realpath.test.local','get_order_summary')->>'orderRevision';
  repeated := public.stockflow_order_summary_gateway('real-path-readers-key',
    'admin@realpath.test.local','get_order_summary')->>'orderRevision';
  if revision is null or revision !~ '^[0-9a-f]{32}$'
    or revision is distinct from repeated
    or revision is distinct from private.stockflow_order_revision('admin@realpath.test.local',array['administrator']) then
    raise exception 'Order revision missing, unstable or different from helper: %, %',revision,repeated;
  end if;
  return revision;
end $$;

create function pg_temp.real_path_create(p_customer uuid,p_name text,p_lines jsonb)
returns uuid language plpgsql as $$
declare result jsonb; o uuid;
begin
  result := public.stockflow_order_gateway('real-path-readers-key','admin@realpath.test.local','create_order',
    jsonb_build_object('customerId',p_customer,'customerName','Real path readers customer','source','phone',
      'idempotencyKey','real-path-create-'||p_name,'lines',p_lines));
  o := (result->>'orderId')::uuid;
  if o is null or result->>'status' is distinct from 'awaiting_confirmation'
    or not exists(select 1 from private.stockflow_orders where id=o and status='awaiting_confirmation'
      and version=(result->>'version')::integer and customer_id=p_customer)
    or (select count(*) from private.stockflow_order_lines where order_id=o) <> jsonb_array_length(p_lines)
    or exists(select 1 from private.stockflow_order_lines where order_id=o group by tally_item_key having count(*)<>1) then
    raise exception 'Create did not produce the saved order and unique item lines: %',result;
  end if;
  return o;
end $$;

create function pg_temp.real_path_transition(p_order uuid,p_status text,p_invoice text default null)
returns void language plpgsql as $$
declare result jsonb; before_version integer; before_revision text; after_revision text;
begin
  before_revision := pg_temp.real_path_revision();
  select version into strict before_version from private.stockflow_orders where id=p_order;
  result := public.stockflow_order_gateway('real-path-readers-key',
    case when p_status='billed_in_tally' then 'billing@realpath.test.local' else 'admin@realpath.test.local' end,
    'transition_order',jsonb_build_object('orderId',p_order,'expectedVersion',before_version,
      'toStatus',p_status,'tallyInvoiceNumber',p_invoice,'idempotencyKey','real-path-transition-'||p_order||'-'||p_status));
  if result->>'status' is distinct from p_status
    or not exists(select 1 from private.stockflow_orders where id=p_order and status=p_status
      and version=(result->>'version')::integer and version>before_version) then
    raise exception 'Real transition failed for %: %',p_status,result;
  end if;
  if p_status='billed_in_tally' and (
    (select tally_invoice_number from private.stockflow_orders where id=p_order) is distinct from p_invoice
    or not exists(select 1 from private.stockflow_order_tally_invoices where order_id=p_order and voucher_reference=p_invoice)) then
    raise exception 'Mark billed did not persist invoice linkage: %',result;
  end if;
  after_revision := pg_temp.real_path_revision();
  if before_revision is not distinct from after_revision then
    raise exception 'Real transition to % did not change order revision',p_status;
  end if;
end $$;

do $scenarios$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  customer uuid; o uuid; governed_order uuid; exception_order uuid; edit_order uuid; shortage_order uuid;
  line_id uuid; exception_id uuid; snapshot_id uuid; exception_version integer; before_version integer;
  item text; scenario text; shape text; actor text; invoice text;
  approved_rate numeric; total numeric; expected_quantity numeric;
  result jsonb; resolved jsonb; snap jsonb; payload jsonb; review_result jsonb; sheet jsonb; sheet_line jsonb;
  line record;
begin
  insert into private.stockflow_customers(name,tally_key,created_by_email)
  values('Real path readers customer','real-path-readers-customer','test') returning id into customer;
  foreach item in array array['REAL-PATH-GOV','REAL-PATH-EXCEPTION','REAL-PATH-SHORT-GOV','REAL-PATH-SHORT'] loop
    insert into private.stockflow_products(tally_item_key,name,base_unit) values(item,item,'Nos');
    insert into private.stockflow_tally_purchase_costs(tally_item_key,cost_amount,cost_kind,effective_at,source_reference,source_id,source_version)
    values(item,3465,'purchase_price',today-20,item||'-cost',item||'-cost','1');
    insert into private.stockflow_tally_sales_prices(customer_id,tally_item_key,invoice_rate,invoice_date,invoice_reference,source_id,source_version)
    values(customer,item,case when item='REAL-PATH-SHORT' then 7000 else 6000 end,
      today-10,item||'-history',item||'-history','1');
  end loop;
  -- External product catalog input required by create_order (not a billing
  -- snapshot). Use the same catalog shape as the order-entry gateway fixtures.
  insert into public.stockflow_snapshots(id,company,fetched_at,payload)
  values('suprabha','REAL PATH TEST',now()::text,jsonb_build_object('catalog',(
    select jsonb_agg(jsonb_build_object('tallyKey',p.tally_item_key,'item',p.name,
      'baseUnit',p.base_unit,'group','Real path tests','closing',10,'active',true))
    from private.stockflow_products p where p.tally_item_key in ('REAL-PATH-GOV','REAL-PATH-EXCEPTION','REAL-PATH-SHORT-GOV','REAL-PATH-SHORT'))))
  on conflict(id) do update set payload=excluded.payload;

  -- Sections 1/2/4: one governed snapshot and one exception decision-row
  -- snapshot, both sealed by pricing and billed with real invoice transitions.
  foreach scenario in array array['governed','exception'] loop
    item := case when scenario='governed' then 'REAL-PATH-GOV' else 'REAL-PATH-EXCEPTION' end;
    shape := case when scenario='governed' then 'lineId' else 'order_line_id' end;
    invoice := 'SD/REAL-PATH/'||upper(scenario);
    o := pg_temp.real_path_create(customer,scenario,
      jsonb_build_array(jsonb_build_object('tallyKey',item,'quantity',2)));
    select id into strict line_id from private.stockflow_order_lines where order_id=o;
    if scenario='exception' then
      resolved := private.stockflow_resolve_pricing_line(line_id,today);
      if resolved->>'guardrail' is distinct from 'PRICE_OK' then
        raise exception 'Exception fixture must start with a governed price: %',resolved;
      end if;
      result := public.stockflow_pricing_gateway('real-path-readers-key','requester@realpath.test.local',
        'submit_order_pricing',jsonb_build_object('orderId',o,
          'expectedVersion',(select version from private.stockflow_orders where id=o),
          'idempotencyKey','real-path-submit-exception',
          'lines',jsonb_build_array(jsonb_build_object('lineId',line_id,'enteredRate',4450,
            'reason','Requested customer discount','evidenceHash',resolved->>'evidenceHash'))));
      if result->>'pricingState' is distinct from 'approval_required' then
        raise exception 'Discount did not require approval: %',result;
      end if;
      select id,version into strict exception_id,exception_version
      from private.stockflow_price_exceptions where order_id=o and state='pending';
      result := public.stockflow_pricing_gateway('real-path-readers-key','management@realpath.test.local',
        'approve_price_exception',jsonb_build_object('exceptionId',exception_id,'expectedVersion',exception_version,
          'reason','Approved customer discount','idempotencyKey','real-path-approve-exception'));
      if result->>'pricingState' is distinct from 'approved' then
        raise exception 'Exception approval did not seal pricing: %',result;
      end if;
    end if;
    perform pg_temp.real_path_transition(o,'confirmed');
    select s.pricing_payload into strict snap from private.stockflow_orders ord
    join private.stockflow_billing_snapshots s on s.id=ord.pricing_snapshot_id and s.order_id=ord.id
    where ord.id=o and ord.pricing_state='approved' and s.invalidated_at is null;
    if jsonb_array_length(snap) is distinct from 1 or (snap->0 ? shape) is distinct from true then
      raise exception 'Wrong real producer shape for %: %',scenario,snap;
    end if;
    select d.approved_rate into strict approved_rate from private.stockflow_order_lines l
    join private.stockflow_order_pricing_decisions d on d.id=l.approved_pricing_decision_id
      and d.order_id=l.order_id and d.order_line_id=l.id and d.state='approved' where l.id=line_id;
    if approved_rate is distinct from (case when scenario='governed' then 6000::numeric else 4450::numeric end) then
      raise exception 'Unexpected producer rate for %: %',scenario,approved_rate;
    end if;
    if scenario='governed' and not exists(select 1 from private.stockflow_pricing_events
      where event_type='governed_order_price_auto_approved' and metadata->>'orderId'=o::text) then
      raise exception 'Confirm did not use automatic governed pricing';
    end if;

    result := public.stockflow_pricing_gateway('real-path-readers-key','requester@realpath.test.local',
      'get_order_pricing',jsonb_build_object('orderId',o,'view','rate_check'));
    if result->>'state' is distinct from 'not_billed' or result->'lines' is distinct from '[]'::jsonb then
      raise exception 'Priced order should be not_billed: %',result;
    end if;
    perform pg_temp.real_path_transition(o,'packed');
    perform pg_temp.real_path_transition(o,'awaiting_tally_billing');
    perform pg_temp.real_path_transition(o,'billed_in_tally',invoice);
    result := public.stockflow_pricing_gateway('real-path-readers-key','requester@realpath.test.local',
      'get_order_pricing',jsonb_build_object('orderId',o,'view','rate_check'));
    if result->>'state' is distinct from 'waiting_for_tally' or result->'lines' is distinct from '[]'::jsonb then
      raise exception 'Billed order without synced voucher should wait for Tally: %',result;
    end if;
    insert into private.stockflow_tally_sales_prices(customer_id,tally_item_key,invoice_rate,invoice_date,invoice_reference,source_id,source_version)
    values(customer,item,approved_rate-(case when scenario='governed' then 2 else 0 end),
      today,invoice,'real-path-voucher-'||scenario,'1');
    if scenario='governed' then governed_order := o; else exception_order := o; end if;
    result := public.stockflow_pricing_gateway('real-path-readers-key','requester@realpath.test.local',
      'get_order_pricing',jsonb_build_object('orderId',o,'view','rate_check'));
    if result->>'state' is distinct from (case when scenario='governed' then 'different' else 'matches' end)
      or jsonb_array_length(result->'lines') is distinct from 1
      or result->'lines'->0->>'lineId' is distinct from line_id::text
      or (result->'lines'->0->>'approvedRate')::numeric is distinct from approved_rate
      or (result->'lines'->0->>'difference')::numeric is distinct from (case when scenario='governed' then -2::numeric else 0::numeric end) then
      raise exception 'Real snapshot rate check failed for %: %',scenario,result;
    end if;
  end loop;

  foreach actor in array array['admin','management'] loop
    result := public.stockflow_pricing_gateway('real-path-readers-key',actor||'@realpath.test.local',
      'get_order_pricing',jsonb_build_object('view','rate_exceptions'));
    if result->>'view' is distinct from 'rate_exceptions'
      or coalesce((result->>'checkedCount')::integer,0)<2
      or jsonb_array_length(result->'orders') is distinct from 1
      or result->'orders'->0->>'orderId' is distinct from governed_order::text
      or (result->'orders'->0->>'differentCount')::integer is distinct from 1
      or (result->'orders'->0->>'worstDifference')::numeric is distinct from -2::numeric
      or exists(select 1 from jsonb_array_elements(result->'orders') e where e->>'orderId'=exception_order::text) then
      raise exception 'Rate exceptions must contain only the under-billed order for %: %',actor,result;
    end if;
  end loop;

  -- Section 3: the combined Sales+Accounts reviewer acts on a genuinely billed
  -- order. Replay is stable; a different command with the old version is stale.
  select version into strict before_version from private.stockflow_orders where id=governed_order;
  payload := jsonb_build_object('orderId',governed_order,'expectedVersion',before_version,
    'idempotencyKey','real-path-billing-review','note','Investigating the two rupee difference','outcome','investigating');
  begin
    perform public.stockflow_billing_review_gateway('real-path-readers-key','denied@realpath.test.local',
      'record_billing_review',payload||'{"roles":["administrator"]}'::jsonb);
    raise exception 'Sales+Warehouse reviewed billing with forged roles';
  exception when insufficient_privilege then null; end;
  review_result := public.stockflow_billing_review_gateway('real-path-readers-key','reviewer@realpath.test.local',
    'record_billing_review',payload);
  if review_result->>'ok' is distinct from 'true' or review_result->>'status' is distinct from 'billed_in_tally'
    or (review_result->>'version')::integer is distinct from before_version+1
    or public.stockflow_billing_review_gateway('real-path-readers-key','reviewer@realpath.test.local',
      'record_billing_review',payload) is distinct from review_result then
    raise exception 'Real billed order review/replay failed: %',review_result;
  end if;
  if (select count(*) from private.stockflow_order_events where order_id=governed_order
      and event_type='billing_reconciliation_reviewed') <> 1
    or not exists(select 1 from private.stockflow_order_events where order_id=governed_order
      and event_type='billing_reconciliation_reviewed' and actor_email='reviewer@realpath.test.local'
      and actor_role='sales' and from_status='billed_in_tally' and to_status='billed_in_tally'
      and reason=payload->>'note' and metadata->'assignedRoles'='["sales","accounts"]'::jsonb
      and metadata->>'outcome'='investigating' and metadata->>'tallyInvoiceNumber'='SD/REAL-PATH/GOVERNED'
      and metadata->>'requestId'='real-path-billing-review') then
    raise exception 'Real billed order review event missing or duplicated';
  end if;
  begin
    perform public.stockflow_billing_review_gateway('real-path-readers-key','reviewer@realpath.test.local',
      'record_billing_review',payload||'{"idempotencyKey":"real-path-billing-review-stale"}'::jsonb);
    raise exception 'Stale billing review was accepted';
  exception when sqlstate 'PT409' then
    if sqlerrm is distinct from 'Order has changed; refresh before trying again' then raise; end if;
  end;
  if (select version from private.stockflow_orders where id=governed_order) is distinct from before_version+1
    or (select count(*) from private.stockflow_order_events where order_id=governed_order
      and event_type='billing_reconciliation_reviewed') <> 1 then
    raise exception 'Rejected/replayed review changed order or event count';
  end if;

  -- Section 2: no_approved_rate is intentionally skipped. The approved-rate
  -- helper never yields a partial approved set for a valid gateway-sealed
  -- snapshot; manufacturing one would bypass the producer under test.
  -- no_approved_price also cannot be reached by edit_order: billed orders
  -- cannot be edited, and an unbilled order returns not_billed first. Exercise
  -- actual invalidation and both guards instead of forging an invoice/status.
  edit_order := pg_temp.real_path_create(customer,'edit',
    jsonb_build_array(jsonb_build_object('tallyKey','REAL-PATH-GOV','quantity',2)));
  result := public.stockflow_pricing_gateway('real-path-readers-key','requester@realpath.test.local',
    'apply_governed_order_pricing',jsonb_build_object('orderId',edit_order,
      'expectedVersion',(select version from private.stockflow_orders where id=edit_order),
      'idempotencyKey','real-path-apply-before-edit'));
  if result->>'pricingState' is distinct from 'approved' then raise exception 'Apply before edit failed: %',result; end if;
  select pricing_snapshot_id into strict snapshot_id from private.stockflow_orders where id=edit_order;
  payload := jsonb_build_object('orderId',edit_order,
    'expectedVersion',(select version from private.stockflow_orders where id=edit_order),
    'customerName','Real path readers customer','reason','Customer increased quantity',
    'idempotencyKey','real-path-invalidate-edit',
    'lines',jsonb_build_array(jsonb_build_object('tallyKey','REAL-PATH-GOV','quantity',3)));
  result := public.stockflow_edit_gateway('real-path-readers-key','admin@realpath.test.local','edit_order',payload);
  if result->>'ok' is distinct from 'true'
    or not exists(select 1 from private.stockflow_orders where id=edit_order and pricing_state='invalidated' and pricing_snapshot_id is null)
    or not exists(select 1 from private.stockflow_billing_snapshots where id=snapshot_id and invalidated_at is not null)
    or not exists(select 1 from private.stockflow_order_lines where order_id=edit_order and quantity=3
      and pricing_state='invalidated' and approved_pricing_decision_id is null) then
    raise exception 'Real quantity edit did not invalidate sealed pricing: %',result;
  end if;
  result := public.stockflow_pricing_gateway('real-path-readers-key','requester@realpath.test.local',
    'get_order_pricing',jsonb_build_object('orderId',edit_order,'view','rate_check'));
  if result->>'state' is distinct from 'not_billed' or result->'lines' is distinct from '[]'::jsonb then
    raise exception 'Invoice guard must precede invalid-price guard after real edit: %',result;
  end if;
  begin
    perform public.stockflow_edit_gateway('real-path-readers-key','admin@realpath.test.local','edit_order',
      payload||jsonb_build_object('orderId',governed_order,
        'expectedVersion',(select version from private.stockflow_orders where id=governed_order),
        'idempotencyKey','real-path-edit-billed-denied'));
    raise exception 'Billed order unexpectedly allowed a quantity edit';
  exception when invalid_parameter_value then
    if sqlerrm is distinct from 'Orders cannot be edited after billing begins' then raise; end if;
  end;

  -- Section 5: two different products, each appearing once. Ordered quantities
  -- exceed packed quantities, so ordered-quantity fallback cannot pass. Use
  -- separate products so the under-billed voucher above is not pricing evidence.
  shortage_order := pg_temp.real_path_create(customer,'shortage',jsonb_build_array(
    jsonb_build_object('tallyKey','REAL-PATH-SHORT-GOV','quantity',3),
    jsonb_build_object('tallyKey','REAL-PATH-SHORT','quantity',4)));
  perform pg_temp.real_path_transition(shortage_order,'confirmed');
  result := public.stockflow_fulfilment_gateway('real-path-readers-key','admin@realpath.test.local','save_fulfilment',
    jsonb_build_object('orderId',shortage_order,
      'expectedVersion',(select version from private.stockflow_orders where id=shortage_order),
      'idempotencyKey','real-path-pack-shortage','deliveryAddress','Real path test address',
      'lines',jsonb_build_array(
        jsonb_build_object('tallyKey','REAL-PATH-SHORT-GOV','fulfilledQuantity',1),
        jsonb_build_object('tallyKey','REAL-PATH-SHORT','fulfilledQuantity',2))));
  if result->>'ok' is distinct from 'true' then raise exception 'Save shortage failed: %',result; end if;
  perform pg_temp.real_path_transition(shortage_order,'packed');
  perform pg_temp.real_path_transition(shortage_order,'awaiting_tally_billing');
  sheet := public.stockflow_pricing_gateway('real-path-readers-key','billing@realpath.test.local',
    'get_order_pricing',jsonb_build_object('orderId',shortage_order,'view','billing'));
  if sheet->>'ready' is distinct from 'true' or sheet->>'status' is distinct from 'awaiting_tally_billing'
    or sheet->>'quantitySource' is distinct from 'packed' or jsonb_array_length(sheet->'lines') is distinct from 2 then
    raise exception 'Real packed shortage did not produce a billing sheet: %',sheet;
  end if;
  total := 0;
  for line in select l.id,l.tally_item_key,l.quantity,l.fulfilled_quantity,d.approved_rate
    from private.stockflow_order_lines l
    join private.stockflow_order_pricing_decisions d on d.id=l.approved_pricing_decision_id
      and d.order_id=l.order_id and d.order_line_id=l.id and d.state='approved'
    where l.order_id=shortage_order loop
    expected_quantity := case when line.tally_item_key='REAL-PATH-SHORT-GOV' then 1 else 2 end;
    select e into strict sheet_line from jsonb_array_elements(sheet->'lines') e where e->>'lineId'=line.id::text;
    if line.fulfilled_quantity is distinct from expected_quantity
      or line.quantity<=line.fulfilled_quantity
      or line.approved_rate is distinct from (case when line.tally_item_key='REAL-PATH-SHORT-GOV' then 6000::numeric else 7000::numeric end)
      or (sheet_line->>'orderedQuantity')::numeric is distinct from line.quantity
      or (sheet_line->>'packedQuantity')::numeric is distinct from expected_quantity
      or (sheet_line->>'billQuantity')::numeric is distinct from expected_quantity
      or (sheet_line->>'approvedRate')::numeric is distinct from line.approved_rate
      or (sheet_line->>'amount')::numeric is distinct from round(expected_quantity*line.approved_rate,2) then
      raise exception 'Shortage sheet did not bill packed quantity times approved rate: %',sheet_line;
    end if;
    total := total+round(expected_quantity*line.approved_rate,2);
  end loop;
  if total is distinct from 20000::numeric or (sheet->>'total')::numeric is distinct from total
    or (sheet->>'total')::numeric is distinct from
      (select sum((e->>'amount')::numeric) from jsonb_array_elements(sheet->'lines') e) then
    raise exception 'Shortage billing total is not the sum of packed amounts: %',sheet;
  end if;
end $scenarios$;
rollback;
