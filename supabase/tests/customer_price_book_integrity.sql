begin;
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('price-book-test-key','sha256'),'hex') where name='orders';
update private.stockflow_pricing_policies set active=false where active;
insert into private.stockflow_pricing_policies(policy_version,minimum_margin_percent,target_margin_percent,override_approval_percent,rounding_increment,rounding_rule_version,effective_from,created_by_email)
values('book-test-v1',20,30,5,5,'ceil-five-v1','2026-01-01','test');
insert into public.stockflow_members(email,role,status) values ('book-admin@test.local','administrator','active'),('book-accounts@test.local','accounts','active'),('book-sales@test.local','sales','active');

do $test$
declare a uuid; b uuid; c uuid; r jsonb; preview jsonb; decision jsonb; replay jsonb; payload jsonb; hash text; count_before int; o uuid; l uuid;
begin
  insert into private.stockflow_customers(name,tally_key,created_by_email) values('Book A','book-a','test') returning id into a;
  insert into private.stockflow_customers(name,tally_key,created_by_email) values('Book B','book-b','test') returning id into b;
  insert into private.stockflow_customers(name,tally_key,created_by_email) values('Book C','book-c','test') returning id into c;
  insert into private.stockflow_products(tally_item_key,name,base_unit) values('BOOK-GLUCOSE','Glucose','Nos');
  insert into private.stockflow_tally_sales_prices(customer_id,tally_item_key,invoice_rate,invoice_date,invoice_reference,source_id,source_version) values(a,'BOOK-GLUCOSE',420,'2026-08-18','A-420','a-sale','1'),(b,'BOOK-GLUCOSE',435,'2026-08-18','B-435','b-sale','1');
  insert into private.stockflow_tally_purchase_costs(tally_item_key,cost_amount,cost_kind,effective_at,source_reference,source_id,source_version) values('BOOK-GLUCOSE',300,'purchase_price','2026-08-01','C300','cost-300','1'),('BOOK-GLUCOSE',310,'purchase_price','2026-09-01','C310','cost-310','1');
  r:=private.stockflow_customer_price(a,'BOOK-GLUCOSE','2026-09-13');
  if (r->>'continuity')::numeric<>430 or (r->>'target')::numeric<>445 or (r->>'recommended')::numeric<>445 or (r->>'additionalGP')::numeric<>15 then raise exception 'Approved example failed: %',r; end if;
  if r->>'monthlyGPImpact' is not null then raise exception 'Volume was invented'; end if;
  if (r->>'recommendedGP')::numeric<>135 or (r->>'continuityGP')::numeric<>120 then raise exception 'GP calculation failed'; end if;
  if (r->>'continuityPrice')::numeric<>430 or (r->>'targetMarginPrice')::numeric<>445 or (r->>'recommendedPrice')::numeric<>445 or nullif(r->>'recommendationReason','') is null then raise exception 'Named pricing outputs or explanation missing'; end if;
  r:=private.stockflow_customer_price(a,'BOOK-GLUCOSE','2026-08-20');
  if (r->>'continuity')::numeric<>420 then raise exception 'Future cost contaminated historic pricing'; end if;

  -- Base is governed but must not replace an existing customer's baseline.
  insert into private.stockflow_standard_item_prices(tally_item_key,price_amount,valid_from,status,reason,approved_by_email) values('BOOK-GLUCOSE',999,'2026-01-01','approved','New customers','book-admin@test.local');
  r:=private.stockflow_customer_price(a,'BOOK-GLUCOSE','2026-09-13');
  if (r->>'recommended')::numeric<>445 then raise exception 'Base overrode customer continuity'; end if;
  r:=private.stockflow_customer_price(c,'BOOK-GLUCOSE','2026-09-13');
  if (r->>'recommended')::numeric<>999 or r->'source'->>'type'<>'STANDARD_ITEM_PRICE' then raise exception 'New customer base failed'; end if;
  insert into private.stockflow_tally_sales_prices(customer_id,tally_item_key,invoice_rate,invoice_date,invoice_reference,source_id,source_version,exceptional,exception_type) values
    (c,'BOOK-GLUCOSE',0,'2026-09-01','FOC','foc-sale','1',true,'foc'),
    (c,'BOOK-GLUCOSE',20,'2026-09-02','CORRECTION','correction-sale','1',false,'correction'),
    (c,'BOOK-GLUCOSE',9000,'2027-01-01','FUTURE','future-sale','1',false,null);
  r:=private.stockflow_customer_price(c,'BOOK-GLUCOSE','2026-09-13');
  if (r->>'recommendedPrice')::numeric<>999 or r->>'lastRate' is not null then raise exception 'Ineligible sales established a baseline'; end if;
  insert into private.stockflow_tally_sales_prices(customer_id,tally_item_key,invoice_rate,invoice_date,invoice_reference,source_id,source_version) values
    (c,'NO-HISTORIC-COST',100,'2026-07-01','EARLY','early-sale','1');
  insert into private.stockflow_tally_purchase_costs(tally_item_key,cost_amount,cost_kind,effective_at,source_reference,source_id,source_version) values
    ('NO-HISTORIC-COST',50,'purchase_price','2026-08-01','LATE','late-cost','1');
  r:=private.stockflow_customer_price(c,'NO-HISTORIC-COST','2026-09-13');
  if r->>'continuityPrice' is not null or not (r->'warnings' ? 'MISSING_COMPARABLE_HISTORIC_COST') then raise exception 'Historic cost was guessed'; end if;

  insert into private.stockflow_customer_product_prices(customer_id,tally_item_key,price_amount,valid_from,status,source_type,reason,approved_by_email,approved_at,created_by_email) values(b,'BOOK-GLUCOSE',350,'2026-01-01','approved','tender','Fixed agreement','book-admin@test.local',now(),'book-admin@test.local');
  r:=private.stockflow_customer_price(b,'BOOK-GLUCOSE','2026-09-13');
  if (r->>'recommended')::numeric<>350 or r->>'status'<>'REVIEW_REQUIRED' or not (r->>'fixed')::boolean then raise exception 'Fixed agreement not protected or low margin not flagged'; end if;

  begin
    perform public.stockflow_pricing_gateway('price-book-test-key','book-sales@test.local','get_customer_price_book',jsonb_build_object('customerId',a));
    raise exception 'Sales accessed price book';
  exception when insufficient_privilege then null; end;
  r:=public.stockflow_pricing_gateway('price-book-test-key','book-accounts@test.local','get_customer_price_book',jsonb_build_object('customerId',a,'pricingDate','2026-09-13'));
  if jsonb_array_length(r->'rows')<>1 then raise exception 'Customer purchased worksheet missing'; end if;

  preview:=public.stockflow_pricing_gateway('price-book-test-key','book-admin@test.local','get_product_price_impact',jsonb_build_object('tallyKey','BOOK-GLUCOSE','pricingDate','2026-09-13'));
  if (preview->>'protectedCount')::int<>1 or (preview->>'customerCount')::int<>2 then raise exception 'Bulk impact counts incorrect'; end if;
  payload:=jsonb_build_object('tallyKey','BOOK-GLUCOSE','pricingDate','2026-09-13','previewHash',preview->>'previewHash','choice','recommended','reason','Approved cost pass-through','idempotencyKey','book-bulk-approve-01');
  begin
    perform public.stockflow_pricing_gateway('price-book-test-key','book-accounts@test.local','apply_product_price_impact',payload);
    raise exception 'Accounts approved bulk commercial decision';
  exception when insufficient_privilege then null; end;
  decision:=public.stockflow_pricing_gateway('price-book-test-key','book-admin@test.local','apply_product_price_impact',payload);
  replay:=public.stockflow_pricing_gateway('price-book-test-key','book-admin@test.local','apply_product_price_impact',payload);
  if decision<>replay or (decision->>'applied')::int<>1 or (decision->>'skipped')::int<>1 then raise exception 'Bulk approval/replay incorrect: %',decision; end if;
  if (select count(*) from private.stockflow_pricing_events where request_id='book-bulk-approve-01')<>1 or (select count(*) from private.stockflow_outbox where topic='pricing.book_approved')<>1 then raise exception 'Atomic audit/outbox missing'; end if;

  -- A fresh idempotency key cannot overwrite a concurrent decision using the old preview.
  begin
    perform public.stockflow_pricing_gateway('price-book-test-key','book-admin@test.local','apply_product_price_impact',payload||jsonb_build_object('idempotencyKey','book-stale-approval-02'));
    raise exception 'Stale bulk preview accepted';
  exception when serialization_failure then null; end;

  r:=private.stockflow_customer_price(a,'BOOK-GLUCOSE','2026-09-13');
  payload:=jsonb_build_object('customerId',a,'tallyKey','BOOK-GLUCOSE','pricingDate','2026-09-13','evidenceHash',r->>'evidenceHash','expectedDecisionId',r->>'currentDecisionId','choice','continuity','reason','Maintain commercial continuity','idempotencyKey','book-single-approval-03');
  perform public.stockflow_pricing_gateway('price-book-test-key','book-admin@test.local','apply_price_book',payload);
  begin
    perform public.stockflow_pricing_gateway('price-book-test-key','book-admin@test.local','apply_price_book',payload||jsonb_build_object('idempotencyKey','book-single-stale-04'));
    raise exception 'Concurrent row edit accepted';
  exception when serialization_failure then null; end;

  insert into private.stockflow_orders(customer_id,customer_name,source,status,idempotency_key,created_by_email,updated_by_email) values(a,'Book A','phone','packed','book-order-01','book-admin@test.local','book-admin@test.local') returning id into o;
  insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,quantity) values(o,'BOOK-GLUCOSE','Glucose',1) returning id into l;
  r:=private.stockflow_resolve_pricing_line(l,'2026-09-13');
  if (r->>'proposedRate')::numeric<>430 then raise exception 'Accepted continuity not used by order'; end if;
  payload:=jsonb_build_object('orderId',o,'expectedVersion',1,'pricingDate','2026-09-13','idempotencyKey','book-order-stale-cost-05','lines',jsonb_build_array(jsonb_build_object('lineId',l,'enteredRate',430,'evidenceHash',r->>'evidenceHash')));
  insert into private.stockflow_tally_purchase_costs(tally_item_key,cost_amount,cost_kind,effective_at,source_reference,source_id,source_version) values('BOOK-GLUCOSE',320,'purchase_price','2026-09-12','C320','cost-320','1');
  begin
    perform public.stockflow_pricing_gateway('price-book-test-key','book-admin@test.local','submit_order_pricing',payload);
    raise exception 'Stale cost approved for billing';
  exception when serialization_failure then null; end;
  if exists(select 1 from private.stockflow_command_results where idempotency_key='book-order-stale-cost-05') then raise exception 'Failed approval left partial command'; end if;
  r:=private.stockflow_resolve_pricing_line(l,'2026-09-13');
  if (r->>'proposedRate')::numeric<>460 then raise exception 'Evidence change failed to expire accepted price'; end if;

  -- A cost decrease preserves the last customer price, never automatically discounts it.
  insert into private.stockflow_tally_purchase_costs(tally_item_key,cost_amount,cost_kind,effective_at,source_reference,source_id,source_version) values('BOOK-GLUCOSE',280,'purchase_price','2026-09-13','C280','cost-280','1');
  r:=private.stockflow_customer_price(a,'BOOK-GLUCOSE','2026-09-13');
  if (r->>'continuity')::numeric<>420 or (r->>'recommended')::numeric<>420 then raise exception 'Cost decrease reduced price'; end if;

  -- Ambiguous rates must not establish a baseline or silently fall back to base.
  insert into private.stockflow_tally_sales_prices(customer_id,tally_item_key,invoice_rate,invoice_date,invoice_reference,source_id,source_version) values(a,'BOOK-GLUCOSE',421,'2026-08-18','A-other','a-other','1');
  r:=private.stockflow_customer_price(a,'BOOK-GLUCOSE','2026-09-13');
  if r->>'recommended' is not null or not (r->'warnings' ? 'AMBIGUOUS_SALES_HISTORY') then raise exception 'Ambiguous history used'; end if;
  r:=private.stockflow_customer_price(a,'MISSING-ITEM','2026-09-13');
  if r->>'recommended' is not null or r->>'currentCost' is not null then raise exception 'Missing evidence invented'; end if;

  begin
    update private.stockflow_price_book_decisions set price=1 where customer_id=a;
    raise exception 'Book history mutable';
  exception when object_not_in_prerequisite_state then null; end;
  begin
    delete from private.stockflow_price_book_decisions where customer_id=a;
    raise exception 'Book history deletable';
  exception when insufficient_privilege then null; end;
end $test$;
-- Approval of one line must revalidate every active sibling in the same batch,
-- including auto-approved siblings and exceptions already approved separately.
do $siblings$
declare
  customer uuid; order_id uuid; first_line uuid; second_line uuid;
  first_exception uuid; second_exception uuid; response jsonb; result_before jsonb;
  first_key text; second_key text; scenario integer; pending_exception uuid;
  audit_count integer; outbox_count integer;
begin
  for scenario in 1..2 loop
    first_key:='SIBLING-FIRST-'||scenario; second_key:='SIBLING-SECOND-'||scenario;
    insert into private.stockflow_customers(name,tally_key,created_by_email)
      values('Sibling test '||scenario,'sibling-ledger-'||scenario,'test') returning id into customer;
    insert into private.stockflow_orders(customer_id,customer_name,source,status,idempotency_key,created_by_email,updated_by_email)
      values(customer,'Sibling test','phone','packed','sibling-order-'||scenario,'book-admin@test.local','book-admin@test.local') returning id into order_id;
    insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,quantity)
      values(order_id,first_key,'First reagent',1) returning id into first_line;
    insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,quantity)
      values(order_id,second_key,'Second reagent',1) returning id into second_line;
    insert into private.stockflow_tally_sales_prices(customer_id,tally_item_key,invoice_rate,invoice_date,invoice_reference,source_id,source_version)
      values(customer,first_key,100,'2026-08-18','SIB-A',first_key,'1'),(customer,second_key,100,'2026-08-18','SIB-B',second_key,'1');
    insert into private.stockflow_tally_purchase_costs(tally_item_key,cost_amount,cost_kind,effective_at,source_reference,source_id,source_version)
      values(first_key,50,'purchase_price','2026-08-01','C50',first_key,'1'),(second_key,50,'purchase_price','2026-08-01','C50',second_key,'1');
    response:=public.stockflow_pricing_gateway('price-book-test-key','book-accounts@test.local','submit_order_pricing',jsonb_build_object(
      'orderId',order_id,'expectedVersion',1,'pricingDate','2026-09-13','idempotencyKey','sibling-submission-'||scenario,
      'lines',jsonb_build_array(
        jsonb_build_object('lineId',first_line,'enteredRate',60,'reason','Special approved request','evidenceHash',private.stockflow_resolve_pricing_line(first_line,'2026-09-13')->>'evidenceHash'),
        jsonb_build_object('lineId',second_line,'enteredRate',case when scenario=1 then 100 else 60 end,'reason','Special approved request','evidenceHash',private.stockflow_resolve_pricing_line(second_line,'2026-09-13')->>'evidenceHash')
      )));
    select id into first_exception from private.stockflow_price_exceptions where order_line_id=first_line;
    if scenario=2 then
      -- Unchanged evidence must allow the first decision, and its replay.
      response:=public.stockflow_pricing_gateway('price-book-test-key','book-admin@test.local','approve_price_exception',jsonb_build_object(
        'exceptionId',first_exception,'expectedVersion',1,'pricingDate','2026-09-13','reason','Management reviewed','idempotencyKey','sibling-first-approval-2'));
      if response is distinct from public.stockflow_pricing_gateway('price-book-test-key','book-admin@test.local','approve_price_exception',jsonb_build_object(
        'exceptionId',first_exception,'expectedVersion',1,'pricingDate','2026-09-13','reason','Management reviewed','idempotencyKey','sibling-first-approval-2')) then raise exception 'Approval replay changed'; end if;
      select id into pending_exception from private.stockflow_price_exceptions where order_line_id=second_line;
      -- The already-approved first line changes while the second still waits.
      insert into private.stockflow_tally_purchase_costs(tally_item_key,cost_amount,cost_kind,effective_at,source_reference,source_id,source_version)
        values(first_key,70,'purchase_price','2026-09-12','Changed sibling cost',first_key,'2');
    else
      pending_exception:=first_exception;
      -- The automatically-approved second line changes while the first waits.
      insert into private.stockflow_tally_purchase_costs(tally_item_key,cost_amount,cost_kind,effective_at,source_reference,source_id,source_version)
        values(second_key,70,'purchase_price','2026-09-12','Changed sibling cost',second_key,'2');
    end if;
    select to_jsonb(o) into result_before from private.stockflow_orders o where o.id=order_id;
    select count(*) into audit_count from private.stockflow_pricing_events;
    select count(*) into outbox_count from private.stockflow_outbox;
    begin
      perform public.stockflow_pricing_gateway('price-book-test-key','book-admin@test.local','approve_price_exception',jsonb_build_object(
        'exceptionId',pending_exception,'expectedVersion',1,'pricingDate','2026-09-13','reason','Stale batch must fail','idempotencyKey','sibling-stale-approval-'||scenario));
      raise exception 'Stale sibling pricing was approved in scenario %',scenario;
    exception when serialization_failure then null; end;
    if result_before is distinct from (select to_jsonb(o) from private.stockflow_orders o where o.id=order_id)
      or (select count(*) from private.stockflow_pricing_events)<>audit_count
      or (select count(*) from private.stockflow_outbox)<>outbox_count
      or exists(select 1 from private.stockflow_command_results where idempotency_key='sibling-stale-approval-'||scenario)
      or exists(select 1 from private.stockflow_billing_snapshots s where s.order_id=(result_before->>'id')::uuid)
      or not exists(select 1 from private.stockflow_price_exceptions where id=pending_exception and state='pending' and version=1)
    then raise exception 'Failed sibling validation left partial approval state'; end if;
  end loop;
end $siblings$;
-- A saved approval cannot cross the billing boundary after its evidence changes.
do $billing$
declare customer uuid; order_id uuid; line_id uuid; snapshot_id uuid;
begin
  insert into private.stockflow_customers(name,tally_key,created_by_email)
    values('Billing gate','billing-gate','test') returning id into customer;
  insert into private.stockflow_orders(customer_id,customer_name,source,status,idempotency_key,created_by_email,updated_by_email)
    values(customer,'Billing gate','phone','packed','billing-gate','book-admin@test.local','book-admin@test.local') returning id into order_id;
  insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,quantity)
    values(order_id,'BILLING-GATE','Reagent',1) returning id into line_id;
  insert into private.stockflow_tally_sales_prices(customer_id,tally_item_key,invoice_rate,invoice_date,invoice_reference,source_id,source_version)
    values(customer,'BILLING-GATE',100,'2026-08-18','BG100','billing-gate','1');
  insert into private.stockflow_tally_purchase_costs(tally_item_key,cost_amount,cost_kind,effective_at,source_reference,source_id,source_version)
    values('BILLING-GATE',50,'purchase_price','2026-08-01','BG50','billing-gate','1');
  perform public.stockflow_pricing_gateway('price-book-test-key','book-accounts@test.local','submit_order_pricing',jsonb_build_object(
    'orderId',order_id,'expectedVersion',1,'pricingDate','2026-09-13','idempotencyKey','billing-gate-pricing',
    'lines',jsonb_build_array(jsonb_build_object('lineId',line_id,'enteredRate',100,'reason','Standard sale','evidenceHash',private.stockflow_resolve_pricing_line(line_id,'2026-09-13')->>'evidenceHash'))));
  select pricing_snapshot_id into snapshot_id from private.stockflow_orders where id=order_id;
  update private.stockflow_orders set status='awaiting_tally_billing' where id=order_id;
  insert into private.stockflow_tally_purchase_costs(tally_item_key,cost_amount,cost_kind,effective_at,source_reference,source_id,source_version)
    values('BILLING-GATE',60,'purchase_price','2026-09-12','BG60','billing-gate','2');
  begin
    update private.stockflow_orders set status='billed_in_tally' where id=order_id;
    raise exception 'Stale approval crossed billing boundary';
  exception when serialization_failure then null; end;
  if not exists(select 1 from private.stockflow_orders where id=order_id and status='awaiting_tally_billing' and pricing_snapshot_id=snapshot_id) then
    raise exception 'Rejected handoff altered order or snapshot';
  end if;
end $billing$;
rollback;
