begin;
alter table public.stockflow_members drop constraint if exists stockflow_members_roles_pending_union;
update private.stockflow_gateway_config
set secret_sha256=encode(extensions.digest('remembered-price-test-key','sha256'),'hex') where name='orders';
update private.stockflow_pricing_policies set active=false where active;
insert into private.stockflow_pricing_policies(policy_version,minimum_margin_percent,target_margin_percent,
  override_approval_percent,rounding_increment,rounding_rule_version,effective_from,created_by_email)
values('remembered-price-test',25,30,5,1,'remembered-rounding',(now() at time zone 'Asia/Kolkata')::date-90,'test');
insert into public.stockflow_members(email,role,status) values
  ('management@remembered.test.local','management','active'),
  ('requester@remembered.test.local','accounts','active');
update public.stockflow_members set roles=array[role] where email like '%@remembered.test.local';

create function pg_temp.remembered_order(p_customer uuid,p_items text[],p_name text)
returns uuid language plpgsql as $$
declare o uuid; item text;
begin
  insert into private.stockflow_orders(order_number,customer_id,customer_name,source,status,idempotency_key,created_by_email,updated_by_email)
  values(private.stockflow_next_order_number(now()),p_customer,'Remembered customer','phone','packed','remembered-order-'||p_name,
    'requester@remembered.test.local','requester@remembered.test.local') returning id into o;
  foreach item in array p_items loop
    insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,quantity) values(o,item,item,1);
  end loop;
  return o;
end $$;

create function pg_temp.remembered_submit(p_order uuid,p_name text,p_rate numeric default 4450)
returns void language plpgsql as $$
declare payload jsonb := '[]'; line record; resolved jsonb; result jsonb;
begin
  for line in select id from private.stockflow_order_lines where order_id=p_order order by tally_item_key loop
    resolved := private.stockflow_resolve_pricing_line(line.id,(now() at time zone 'Asia/Kolkata')::date);
    payload := payload||jsonb_build_array(jsonb_build_object('lineId',line.id,'enteredRate',p_rate,
      'reason','Requested customer discount','evidenceHash',resolved->>'evidenceHash'));
  end loop;
  result := public.stockflow_pricing_gateway('remembered-price-test-key','requester@remembered.test.local','submit_order_pricing',
    jsonb_build_object('orderId',p_order,'expectedVersion',(select version from private.stockflow_orders where id=p_order),
      'idempotencyKey','remembered-submit-'||p_name,'lines',payload));
  if result->>'pricingState' is distinct from 'approval_required' then
    raise exception 'Expected pending fixture %, got %',p_name,result;
  end if;
end $$;

create function pg_temp.remembered_approve(p_exception uuid,p_name text,p_extra jsonb default '{}')
returns jsonb language plpgsql as $$
begin
  return public.stockflow_pricing_gateway('remembered-price-test-key','management@remembered.test.local','approve_price_exception',
    jsonb_build_object('exceptionId',p_exception,'expectedVersion',1,'reason','Approved customer discount',
      'idempotencyKey','remembered-approve-'||p_name)||p_extra);
end $$;

create function pg_temp.remembered_contract(p_customer uuid,p_item text,p_date date,p_name text,p_price numeric default 4450,p_previous uuid default null)
returns uuid language plpgsql as $$
declare result jsonb; contract uuid;
begin
  result := public.stockflow_pricing_gateway('remembered-price-test-key','requester@remembered.test.local','create_price_contract',
    jsonb_build_object('customerId',p_customer,'tallyKey',p_item,'price',p_price,'validFrom',p_date,
      'source','manual_governed','reason','Legacy or future customer agreement','supersedesPriceId',p_previous,
      'idempotencyKey','remembered-contract-'||p_name));
  contract := (result->>'contractId')::uuid;
  perform public.stockflow_pricing_gateway('remembered-price-test-key','management@remembered.test.local','approve_price_contract',
    jsonb_build_object('contractId',contract,'expectedVersion',1,'reason','Approved customer agreement',
      'idempotencyKey','remembered-contract-approve-'||p_name));
  return contract;
end $$;

do $scenarios$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  customer uuid; o uuid; second_order uuid; ex uuid; first_ex uuid; line_id uuid;
  first_price uuid; next_price uuid; future_price uuid; old_price uuid;
  item text; scenario text; result jsonb; replay jsonb; resolved jsonb; invalid jsonb;
  before_exception jsonb; events_before bigint; rows_before bigint; failed boolean;
  actual_message text; entry record;
  approval_hash text; approval_snapshot_hash text;
begin
  insert into private.stockflow_customers(name,tally_key,created_by_email)
  values('Remembered customer','remembered-customer','test') returning id into customer;
  foreach item in array array['REM-MAIN','REM-THRESHOLD','REM-KIND','REM-MISSING','REM-ONCE',
    'REM-BATCH-A','REM-BATCH-B','REM-COMPLETE-A','REM-COMPLETE-B','REM-FUTURE','REM-OLDER','REM-PRIOR','REM-INVALID'] loop
    insert into private.stockflow_products(tally_item_key,name,base_unit) values(item,item,'Nos');
    insert into private.stockflow_tally_purchase_costs(tally_item_key,cost_amount,cost_kind,effective_at,source_reference,source_id,source_version)
    values(item,3465,'purchase_price',today-20,item||'-cost',item||'-cost','1');
    insert into private.stockflow_tally_sales_prices(customer_id,tally_item_key,invoice_rate,invoice_date,invoice_reference,source_id,source_version)
    values(customer,item,6000,today-10,item||'-sale',item||'-sale','1');
  end loop;

  o := pg_temp.remembered_order(customer,array['REM-MAIN'],'first');
  perform pg_temp.remembered_submit(o,'first');
  select id into strict first_ex from private.stockflow_price_exceptions where order_id=o;
  select d.evidence_hash into strict approval_hash from private.stockflow_order_pricing_decisions d
  join private.stockflow_price_exceptions e on e.decision_id=d.id where e.id=first_ex;
  result := pg_temp.remembered_approve(first_ex,'first');
  if result->>'ok' is distinct from 'true' or result->>'pricingState' is distinct from 'approved' then
    raise exception 'Default approval failed: %',result;
  end if;
  select id into strict first_price from private.stockflow_customer_product_prices where origin_exception_id=first_ex;
  if not exists(select 1 from private.stockflow_customer_product_prices p join private.stockflow_orders ord on ord.id=o
    where p.id=first_price and p.price_amount=4450 and p.approved_cost_amount=3465 and p.approved_cost_kind='purchase_price'
      and ord.order_number is not null and p.source_reference=ord.order_number and p.source_type='manual_governed' and p.valid_from=today
      and p.created_by_email='requester@remembered.test.local' and p.approved_by_email='management@remembered.test.local'
      and p.reason='Approved customer discount' and p.status='approved') then
    raise exception 'Default remembered price has incorrect provenance or baseline';
  end if;
  if not exists(select 1 from private.stockflow_order_pricing_decisions d
    join private.stockflow_price_exceptions e on e.decision_id=d.id
    where e.id=first_ex and d.gross_margin_percent<25 and round(d.gross_margin_percent)=22) then
    raise exception 'Fixture does not exercise a 22 percent margin';
  end if;
  select id into strict line_id from private.stockflow_order_lines where order_id=o;
  resolved := private.stockflow_resolve_pricing_line(line_id,today);
  if not exists(select 1 from private.stockflow_order_pricing_decisions d
    join private.stockflow_order_lines l on l.approved_pricing_decision_id=d.id
    where l.id=line_id and d.evidence_hash=resolved->>'evidenceHash')
    or not exists(select 1 from private.stockflow_orders ord join private.stockflow_billing_snapshots s on s.id=ord.pricing_snapshot_id
      cross join lateral jsonb_array_elements(s.pricing_payload) d where ord.id=o
      and d->>'order_line_id'=line_id::text and d->>'evidence_hash'=approval_hash) then
    raise exception 'Remembering must refresh current evidence and preserve the approval snapshot';
  end if;
  select s.snapshot_hash into strict approval_snapshot_hash from private.stockflow_orders ord
  join private.stockflow_billing_snapshots s on s.id=ord.pricing_snapshot_id where ord.id=o;
  update private.stockflow_orders set status='awaiting_tally_billing' where id=o;
  if not exists(select 1 from private.stockflow_orders ord join private.stockflow_billing_snapshots s on s.id=ord.pricing_snapshot_id
    where ord.id=o and s.snapshot_hash=approval_snapshot_hash) then raise exception 'Billing changed the sealed snapshot'; end if;
  if (select count(*) from private.stockflow_pricing_events where entity_id=first_price and event_type='customer_price_remembered')<>1
    or not exists(select 1 from private.stockflow_pricing_events where entity_id=first_price and event_type='customer_price_remembered'
      and metadata=jsonb_build_object('orderId',o,'customerId',customer,'tallyKey','REM-MAIN','price',4450,'approvedCost',3465)) then
    raise exception 'Expected exactly one remembered event with complete metadata';
  end if;
  select count(*) into events_before from private.stockflow_pricing_events;
  select count(*) into rows_before from private.stockflow_customer_product_prices;
  replay := pg_temp.remembered_approve(first_ex,'first');
  if replay is distinct from result or events_before<>(select count(*) from private.stockflow_pricing_events)
    or rows_before<>(select count(*) from private.stockflow_customer_product_prices) then
    raise exception 'Completing approval replay changed rows or events';
  end if;

  second_order := pg_temp.remembered_order(customer,array['REM-MAIN'],'repeat');
  select id into strict line_id from private.stockflow_order_lines where order_id=second_order;
  resolved := private.stockflow_resolve_pricing_line(line_id,today);
  if resolved->'source'->>'type' is distinct from 'APPROVED_CONTRACT' or (resolved->>'proposedRate')::numeric is distinct from 4450::numeric
    or resolved->>'guardrail' is distinct from 'PRICE_OK' then raise exception 'Repeat resolution: %',resolved; end if;
  result := public.stockflow_pricing_gateway('remembered-price-test-key','requester@remembered.test.local','apply_governed_order_pricing',
    jsonb_build_object('orderId',second_order,'expectedVersion',(select version from private.stockflow_orders where id=second_order),
      'idempotencyKey','remembered-governed-repeat'));
  if result->>'pricingState' is distinct from 'approved'
    or exists(select 1 from private.stockflow_price_exceptions where order_id=second_order)
    or not exists(select 1 from private.stockflow_order_lines l join private.stockflow_order_pricing_decisions d
      on d.id=l.approved_pricing_decision_id where l.id=line_id and d.approved_rate=4450 and d.state='approved') then
    raise exception 'Governed apply did not approve without exception: %',result;
  end if;

  second_order := pg_temp.remembered_order(customer,array['REM-MAIN'],'changed');
  perform pg_temp.remembered_submit(second_order,'changed',4300);
  select id into strict ex from private.stockflow_price_exceptions where order_id=second_order;
  result := pg_temp.remembered_approve(ex,'changed','{"changedRate":4510,"saveAsCustomerPrice":true}');
  select id into strict next_price from private.stockflow_customer_product_prices where origin_exception_id=ex;
  if not exists(select 1 from private.stockflow_customer_product_prices where id=next_price and price_amount=4510 and supersedes_price_id=first_price)
    or not exists(select 1 from private.stockflow_customer_product_prices where id=first_price and status='superseded' and valid_to=today) then
    raise exception 'Same-day replacement or changed rate not saved';
  end if;
  resolved := private.stockflow_customer_price(customer,'REM-MAIN',today);
  if (resolved->>'currentPrice')::numeric is distinct from 4510::numeric
    or resolved->>'agreementId' is distinct from next_price::text then raise exception 'Same-day successor did not win: %',resolved; end if;
  select count(*) into events_before from private.stockflow_pricing_events;
  select count(*) into rows_before from private.stockflow_customer_product_prices;
  replay := pg_temp.remembered_approve(ex,'changed','{"changedRate":4510,"saveAsCustomerPrice":true}');
  if replay is distinct from result or events_before<>(select count(*) from private.stockflow_pricing_events)
    or rows_before<>(select count(*) from private.stockflow_customer_product_prices) then
    raise exception 'Change-and-approve replay changed rows or events';
  end if;

  foreach item in array array['REM-THRESHOLD','REM-KIND','REM-MISSING'] loop
    o := pg_temp.remembered_order(customer,array[item],item);
    perform pg_temp.remembered_submit(o,item);
    select id into strict ex from private.stockflow_price_exceptions where order_id=o;
    perform pg_temp.remembered_approve(ex,item,'{"saveAsCustomerPrice":true}');
    select id into strict line_id from private.stockflow_order_lines where order_id=o;
    if item='REM-THRESHOLD' then
      insert into private.stockflow_tally_purchase_costs(tally_item_key,cost_amount,cost_kind,effective_at,source_reference,source_id,source_version)
      values(item,3534.30,'purchase_price',today-2,item||'-2pct',item||'-2pct','1');
      resolved := private.stockflow_resolve_pricing_line(line_id,today);
      if resolved->>'guardrail' is distinct from 'PRICE_OK' or (resolved->>'currentCost')::numeric is distinct from 3534.30::numeric
        or (resolved->>'costChange')::numeric is distinct from 69.30::numeric then
        raise exception 'Exactly 2 percent must bypass the old positive-costChange gate: %',resolved;
      end if;
      insert into private.stockflow_tally_purchase_costs(tally_item_key,cost_amount,cost_kind,effective_at,source_reference,source_id,source_version)
      values(item,3534.31,'purchase_price',today-1,item||'-over',item||'-over','1');
    elsif item='REM-KIND' then
      insert into private.stockflow_tally_purchase_costs(tally_item_key,cost_amount,cost_kind,effective_at,source_reference,source_id,source_version)
      values(item,3465,'landed_cost',today-1,item||'-landed',item||'-landed','1');
    else
      insert into private.stockflow_tally_purchase_costs(tally_item_key,cost_amount,cost_kind,effective_at,source_reference,source_id,source_version)
      values(item,3465,'purchase_price',today-1,item||'-ambiguous1',item||'-ambiguous1','1'),
        (item,3466,'purchase_price',today-1,item||'-ambiguous2',item||'-ambiguous2','1');
    end if;
    resolved := private.stockflow_resolve_pricing_line(line_id,today);
    if resolved->>'guardrail' is distinct from 'PRICE_REVIEW_REQUIRED'
      or (item='REM-MISSING' and resolved->>'currentCost' is not null)
      or (item='REM-KIND' and resolved->'cost'->>'kind' is distinct from 'landed_cost') then
      raise exception 'Changed or missing cost must require review: % %',item,resolved;
    end if;
  end loop;

  o := pg_temp.remembered_order(customer,array['REM-ONCE'],'once');
  perform pg_temp.remembered_submit(o,'once');
  select id into strict ex from private.stockflow_price_exceptions where order_id=o;
  result := pg_temp.remembered_approve(ex,'once','{"saveAsCustomerPrice":false}');
  if exists(select 1 from private.stockflow_customer_product_prices where origin_exception_id=ex)
    or (select save_as_customer_price from private.stockflow_price_exceptions where id=ex) then
    raise exception 'Opt-out price was remembered';
  end if;
  replay := pg_temp.remembered_approve(ex,'once','{"saveAsCustomerPrice":false}');
  if replay is distinct from result then raise exception 'Opt-out replay failed'; end if;
  second_order := pg_temp.remembered_order(customer,array['REM-ONCE'],'once-repeat');
  perform pg_temp.remembered_submit(second_order,'once-repeat');

  foreach scenario in array array['rejected','completed'] loop
    o := pg_temp.remembered_order(customer,
      case when scenario='rejected' then array['REM-BATCH-A','REM-BATCH-B'] else array['REM-COMPLETE-A','REM-COMPLETE-B'] end,
      'batch-'||scenario);
    perform pg_temp.remembered_submit(o,'batch-'||scenario);
    for entry in select e.id,l.tally_item_key from private.stockflow_price_exceptions e
      join private.stockflow_order_lines l on l.id=e.order_line_id where e.order_id=o order by l.tally_item_key loop
      if right(entry.tally_item_key,1)='A' then
        first_ex := entry.id;
        perform pg_temp.remembered_approve(entry.id,'batch-'||scenario||'-a','{"saveAsCustomerPrice":true}');
        if exists(select 1 from private.stockflow_customer_product_prices where origin_exception_id=entry.id)
          or exists(select 1 from private.stockflow_billing_snapshots where order_id=o and invalidated_at is null) then
          raise exception 'Partial batch saved a price or snapshot';
        end if;
      elsif scenario='rejected' then
        perform public.stockflow_pricing_gateway('remembered-price-test-key','management@remembered.test.local','reject_price_exception',
          jsonb_build_object('exceptionId',entry.id,'expectedVersion',1,'reason','Declined related price',
            'idempotencyKey','remembered-batch-rejection'));
      else
        perform pg_temp.remembered_approve(entry.id,'batch-completed-b');
      end if;
    end loop;
    if (case when scenario='rejected' then
      exists(select 1 from private.stockflow_customer_product_prices where origin_exception_id=first_ex)
      or not exists(select 1 from private.stockflow_order_pricing_decisions d join private.stockflow_price_exceptions e on e.decision_id=d.id
        where e.id=first_ex and d.state='rejected')
      else (select count(*) from private.stockflow_customer_product_prices p join private.stockflow_price_exceptions e on e.id=p.origin_exception_id
        where e.order_id=o)<>2 end) then raise exception 'Batch save boundary failed: %',scenario; end if;
  end loop;

  old_price := pg_temp.remembered_contract(customer,'REM-OLDER',today-5,'older');
  o := pg_temp.remembered_order(customer,array['REM-OLDER'],'older');
  select id into strict line_id from private.stockflow_order_lines where order_id=o;
  resolved := private.stockflow_resolve_pricing_line(line_id,today);
  if resolved->>'guardrail' is distinct from 'PRICE_REVIEW_REQUIRED' or resolved->>'approvedCostAmount' is not null
    or (resolved->>'costChange')::numeric is distinct from 0::numeric then raise exception 'Legacy low margin changed: %',resolved; end if;
  perform pg_temp.remembered_contract(customer,'REM-OLDER',today-4,'older-high',6000,old_price);
  resolved := private.stockflow_resolve_pricing_line(line_id,today);
  if resolved->>'guardrail' is distinct from 'PRICE_OK' then raise exception 'Legacy high margin baseline: %',resolved; end if;
  insert into private.stockflow_tally_purchase_costs(tally_item_key,cost_amount,cost_kind,effective_at,source_reference,source_id,source_version)
  values('REM-OLDER',3466,'purchase_price',today-1,'REM-OLDER-up','REM-OLDER-up','1');
  resolved := private.stockflow_resolve_pricing_line(line_id,today);
  if resolved->>'guardrail' is distinct from 'PRICE_REVIEW_REQUIRED' or (resolved->>'costChange')::numeric is distinct from 1::numeric
    or (resolved->'margin'->>'grossMarginPercent')::numeric<=25 then raise exception 'Legacy positive costChange changed: %',resolved; end if;

  old_price := pg_temp.remembered_contract(customer,'REM-PRIOR',today-5,'prior');
  o := pg_temp.remembered_order(customer,array['REM-PRIOR'],'prior');
  perform pg_temp.remembered_submit(o,'prior');
  select id into strict ex from private.stockflow_price_exceptions where order_id=o;
  perform pg_temp.remembered_approve(ex,'prior');
  if not exists(select 1 from private.stockflow_customer_product_prices where id=old_price and status='superseded' and valid_to=today-1)
    or not exists(select 1 from private.stockflow_customer_product_prices where origin_exception_id=ex and supersedes_price_id=old_price) then
    raise exception 'Prior-day supersession differs from contract approval';
  end if;

  future_price := pg_temp.remembered_contract(customer,'REM-FUTURE',today+5,'future');
  o := pg_temp.remembered_order(customer,array['REM-FUTURE'],'future');
  perform pg_temp.remembered_submit(o,'future');
  select id into strict ex from private.stockflow_price_exceptions where order_id=o;
  result := pg_temp.remembered_approve(ex,'future');
  if result->>'pricingState' is distinct from 'approved'
    or exists(select 1 from private.stockflow_customer_product_prices where origin_exception_id=ex)
    or not exists(select 1 from private.stockflow_customer_product_prices where id=future_price and status='approved' and valid_from=today+5)
    or (select count(*) from private.stockflow_pricing_events where entity_id=ex and event_type='customer_price_not_remembered')<>1
    or not exists(select 1 from private.stockflow_pricing_events where entity_id=ex and event_type='customer_price_not_remembered'
      and metadata=jsonb_build_object('orderId',o,'tallyKey','REM-FUTURE',
        'reason','A future-dated customer price already exists','futurePriceId',future_price)) then
    raise exception 'Future price must remain intact and produce one skip event';
  end if;
  select count(*) into events_before from private.stockflow_pricing_events;
  replay := pg_temp.remembered_approve(ex,'future');
  if replay is distinct from result or events_before<>(select count(*) from private.stockflow_pricing_events)
    or exists(select 1 from private.stockflow_customer_product_prices where origin_exception_id=ex) then
    raise exception 'Skipped approval replay created a row or event';
  end if;

  o := pg_temp.remembered_order(customer,array['REM-INVALID'],'invalid');
  perform pg_temp.remembered_submit(o,'invalid');
  select id,to_jsonb(e) into strict ex,before_exception from private.stockflow_price_exceptions e where order_id=o;
  select count(*) into events_before from private.stockflow_pricing_events;
  for invalid in select value from jsonb_array_elements('[null,"true","false",0,1,{},[]]'::jsonb) loop
    failed := false;
    begin
      perform pg_temp.remembered_approve(ex,'invalid',jsonb_build_object('saveAsCustomerPrice',invalid));
    exception when sqlstate '22023' then
      get stacked diagnostics actual_message=message_text;
      if actual_message<>'saveAsCustomerPrice must be true or false' then raise exception 'Wrong flag error: %',actual_message; end if;
      failed := true;
    end;
    if not failed or before_exception is distinct from (select to_jsonb(e) from private.stockflow_price_exceptions e where id=ex)
      or events_before<>(select count(*) from private.stockflow_pricing_events) then raise exception 'Invalid flag was accepted or mutated state'; end if;
  end loop;
  failed := false;
  begin
    perform public.stockflow_pricing_gateway('remembered-price-test-key','requester@remembered.test.local','approve_price_exception',
      jsonb_build_object('exceptionId',ex,'expectedVersion',1,'reason','Unauthorized save attempt',
        'saveAsCustomerPrice',false,'idempotencyKey','remembered-unauthorized'));
  exception when insufficient_privilege then failed := true;
  end;
  if not failed or before_exception is distinct from (select to_jsonb(e) from private.stockflow_price_exceptions e where id=ex) then
    raise exception 'Unauthorized approval persisted the opt-out';
  end if;
end $scenarios$;

do $sales_revisions$
declare
  customer uuid; o uuid; line_id uuid; resolved jsonb; workspace jsonb; purchased jsonb;
  today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  insert into private.stockflow_customers(name,tally_key,created_by_email)
  values('Revised invoice customer','remembered-revision-customer','test') returning id into customer;
  insert into private.stockflow_products(tally_item_key,name,base_unit) values('REM-REVISION','Revised invoice product','Nos');
  insert into private.stockflow_tally_purchase_costs(tally_item_key,cost_amount,cost_kind,effective_at,source_reference,source_id,source_version)
  values('REM-REVISION',3465,'purchase_price',today-20,'REM-REVISION-cost','REM-REVISION-cost','1');
  insert into private.stockflow_tally_sales_prices(customer_id,tally_item_key,invoice_rate,invoice_date,invoice_reference,source_id,source_version,imported_at)
  values(customer,'REM-REVISION',4450,today-1,'SD/26-27/0715','REM-MASTER|1|REM-REVISION','1',now()-interval '2 hours'),
    (customer,'REM-REVISION',4510,today-1,'SD/26-27/0715','REM-MASTER|1|REM-REVISION','2',now()-interval '1 hour');
  o := pg_temp.remembered_order(customer,array['REM-REVISION'],'revisions');
  select id into strict line_id from private.stockflow_order_lines where order_id=o;
  resolved := private.stockflow_customer_price(customer,'REM-REVISION',today);
  if (resolved->>'lastRate')::numeric is distinct from 4510::numeric
    or resolved->'warnings' ? 'AMBIGUOUS_SALES_HISTORY'
    or jsonb_array_length(resolved->'recentRates') is distinct from 1
    or (resolved->'recentRates'->0->>'rate')::numeric is distinct from 4510::numeric
    or resolved->'recentRates'->0->>'sourceVersion' is distinct from '2' then
    raise exception 'Invoice revisions must resolve to one latest sale: %',resolved;
  end if;
  workspace := public.stockflow_pricing_gateway('remembered-price-test-key','requester@remembered.test.local','get_order_pricing',
    jsonb_build_object('orderId',o));
  if workspace->'lines'->0->'recentRates' is distinct from resolved->'recentRates'
    or (workspace->'lines'->0->>'proposedRate')::numeric is distinct from 4510::numeric then
    raise exception 'Workspace did not use the latest invoice revision: %',workspace;
  end if;
  purchased := public.stockflow_pricing_gateway('remembered-price-test-key','requester@remembered.test.local','list_customer_purchased_items',
    jsonb_build_object('customerId',customer));
  if jsonb_array_length(purchased->'items') is distinct from 1
    or (purchased->'items'->0->>'lastRate')::numeric is distinct from 4510::numeric then
    raise exception 'Purchased-item last rate did not use latest revision: %',purchased;
  end if;

  insert into private.stockflow_tally_sales_prices(customer_id,tally_item_key,invoice_rate,invoice_date,invoice_reference,source_id,source_version,imported_at)
  values(customer,'REM-REVISION',4450,today-1,'SD/26-27/0715','REM-MASTER|2|REM-REVISION','1',now());
  resolved := private.stockflow_customer_price(customer,'REM-REVISION',today);
  if not (resolved->'warnings' ? 'AMBIGUOUS_SALES_HISTORY') or resolved->>'lastRate' is not null
    or jsonb_array_length(resolved->'recentRates') is distinct from 2 then
    raise exception 'Distinct invoice lines at different rates must remain ambiguous: %',resolved;
  end if;
  resolved := private.stockflow_resolve_pricing_line(line_id,today);
  if not (resolved->'warnings' ? 'AMBIGUOUS_SALES_HISTORY') then raise exception 'Line resolution lost genuine ambiguity'; end if;

  insert into private.stockflow_tally_sales_prices(customer_id,tally_item_key,invoice_rate,invoice_date,invoice_reference,
    source_id,source_version,imported_at,exceptional,exception_type)
  values(customer,'REM-REVISION',0,today-1,'SD/26-27/0715','REM-MASTER|2|REM-REVISION','2',now()+interval '1 minute',true,'foc');
  resolved := private.stockflow_customer_price(customer,'REM-REVISION',today);
  if resolved->'warnings' ? 'AMBIGUOUS_SALES_HISTORY' or jsonb_array_length(resolved->'recentRates') is distinct from 1
    or (resolved->>'lastRate')::numeric is distinct from 4510::numeric then
    raise exception 'Ineligible latest revision must not revive an older eligible row: %',resolved;
  end if;
  purchased := public.stockflow_pricing_gateway('remembered-price-test-key','requester@remembered.test.local','list_customer_purchased_items',
    jsonb_build_object('customerId',customer));
  if (purchased->'items'->0->>'lastRate')::numeric is distinct from 4510::numeric then
    raise exception 'Purchased-item list revived an older eligible revision: %',purchased;
  end if;
end $sales_revisions$;

do $definitions$
declare signature text; definition text; needle text; client text; patch record;
begin
  for patch in select * from (values
    ('private.stockflow_customer_price_before_customer_first(uuid,text,date)',
      'order by valid_from desc, approved_at desc nulls last, version desc, id desc'),
    ('private.stockflow_customer_price_before_customer_first(uuid,text,date)',
      '''approvedCostAmount'',agreement.approved_cost_amount'),
    ('private.stockflow_resolve_pricing_line_before_group_margin(uuid,date)',
      'current_cost > (resolved->>''approvedCostAmount'')::numeric * 1.02'),
    ('private.stockflow_pricing_gateway_v1(text,text,text,jsonb)',
      'and v_resolved->>''guardrail''=''PRICE_OK'' and v_difference=0,false)'),
    ('private.stockflow_customer_price_before_customer_first(uuid,text,date)',') latest_sale_pick where'),
    ('private.stockflow_customer_price_before_customer_first(uuid,text,date)',') latest_sale_ambiguity where'),
    ('private.stockflow_customer_price_before_customer_first(uuid,text,date)',') latest_recent_rates where'),
    ('private.stockflow_pricing_gateway_v1(text,text,text,jsonb)','order by source_id, imported_at desc, id desc')
  ) expected(signature,needle) loop
    definition := pg_get_functiondef(patch.signature::regprocedure);
    if (length(definition)-length(replace(definition,patch.needle,'')))/length(patch.needle)<>1 then
      raise exception 'Patch must occur exactly once: % %',patch.signature,patch.needle;
    end if;
  end loop;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('private','public') and position('''recentRates''' in p.prosrc)>0)<>1
    or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('private','public') and position('''recentRates''' in p.prosrc)>0
      and position(') latest_recent_rates where' in p.prosrc)=0) then
    raise exception 'Unpatched live recentRates builder; the original 20260912 body should have been replaced';
  end if;
  foreach signature in array array['public.stockflow_pricing_gateway(text,text,text,jsonb)',
    'public.stockflow_pricing_gateway_before_remembered_price(text,text,text,jsonb)',
    'private.stockflow_remember_order_prices(uuid,text)'] loop
    foreach client in array array['anon','authenticated'] loop
      if has_function_privilege(client,signature,'EXECUTE') then raise exception 'Client execute exposed: % %',client,signature; end if;
    end loop;
    if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where p.oid=signature::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE') then
      raise exception 'Public execute exposed: %',signature;
    end if;
  end loop;
  if not has_function_privilege('service_role','public.stockflow_pricing_gateway(text,text,text,jsonb)','EXECUTE')
    or has_function_privilege('service_role','private.stockflow_remember_order_prices(uuid,text)','EXECUTE') then
    raise exception 'Unexpected service execute privileges';
  end if;
end $definitions$;

rollback;
