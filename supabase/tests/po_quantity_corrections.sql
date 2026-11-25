begin;
-- Disposable replay fixtures: generic members/products/supplier, finite dates,
-- positive quantities and rates. All gateway, roster and evidence changes roll back.
set local statement_timeout='120s';
set local lock_timeout='10s';
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('pqc-test-key','sha256'),'hex') where name='orders';
-- Isolate the manager roster so the fallback test does not depend on seed members.
update public.stockflow_members set status='suspended' where status='active' and 'management'=any(roles);
insert into public.stockflow_members(email,role,roles,status) values
  ('ops@test','operations',array['operations'],'active'),
  ('mgr@test','management',array['management'],'active'),
  ('mgr2@test','management',array['management'],'active'),
  ('admin@test','administrator',array['administrator'],'active'),
  ('sales@test','sales',array['sales'],'active');
insert into private.stockflow_products(tally_item_key,name,base_unit) values('PQC-ITEM','Test item','Nos');
insert into private.stockflow_supplier_prices(tally_item_key,supplier_name,rate,unit,effective_at,source_reference,source_id)
  values('PQC-ITEM','Test supplier',10,'Nos',(now() at time zone 'Asia/Kolkata')::date,'PQC-1','PQC-SOURCE');

create function pg_temp.pqc_assert(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%',message; end if; end $$;
create function pg_temp.pqc_call(a text,p jsonb default '{}',actor text default 'ops@test')
returns jsonb language plpgsql as $$
begin
  -- Like supplier_purchase_orders.sql, isolate semantic tests from admission counts.
  delete from private.stockflow_request_log where actor_email=actor;
  if a in ('request_po_quantity_correction','decide_po_quantity_correction','confirm_purchase_order_supplier','list_po_corrections') then
    return public.stockflow_po_revision_gateway('pqc-test-key',actor,a,p);
  end if;
  return public.stockflow_purchase_gateway('pqc-test-key',actor,a,p);
end $$;
create function pg_temp.pqc_error(a text,p jsonb,code text,message text,actor text default 'ops@test')
returns void language plpgsql as $$
declare actual text; detail text;
begin
  begin perform pg_temp.pqc_call(a,p,actor);
  exception when others then get stacked diagnostics actual=returned_sqlstate,detail=message_text; end;
  perform pg_temp.pqc_assert(actual=code and detail=message,
    a||': expected '||code||' / '||message||', got '||coalesce(actual,'success')||' / '||coalesce(detail,''));
end $$;
create function pg_temp.pqc_private(r jsonb) returns void language plpgsql as $$
begin
  perform pg_temp.pqc_assert(not coalesce(jsonb_path_exists(r,'strict $.**.rate','{}',true),false)
    and not jsonb_path_exists(r,'$.**.rate'),'Operations leaked rate');
  perform pg_temp.pqc_assert(not coalesce(jsonb_path_exists(r,'strict $.**.totalValue','{}',true),false)
    and not jsonb_path_exists(r,'$.**.totalValue'),'Operations leaked totalValue');
end $$;
create function pg_temp.pqc_po(actor text default 'ops@test') returns uuid language plpgsql as $$
declare r jsonb;
begin
  r:=pg_temp.pqc_call('create_purchase_orders',jsonb_build_object('idempotencyKey',gen_random_uuid(),
    'lines',jsonb_build_array(jsonb_build_object('itemKey','PQC-ITEM','quantity',10,'supplierName','Test supplier'))),actor);
  return (r->'purchaseOrders'->0->>'id')::uuid;
end $$;
create function pg_temp.pqc_command(po uuid) returns jsonb language sql as $$
  select jsonb_build_object('id',po,'expectedVersion',version,'idempotencyKey',gen_random_uuid())
    from private.stockflow_purchase_orders where id=po
$$;
create function pg_temp.pqc_correction(po uuid,qty numeric) returns jsonb language sql as $$
  select pg_temp.pqc_command(po)||jsonb_build_object('itemKey','PQC-ITEM','quantity',qty,
    'reasonCode','typing_mistake','note','  Correct test quantity  ')
$$;
create function pg_temp.pqc_decision(request uuid,decision text default 'approve') returns jsonb language sql as $$
  select jsonb_build_object('requestId',q.id,'expectedVersion',o.version,'decision',decision,'idempotencyKey',gen_random_uuid())
    from private.stockflow_po_correction_requests q join private.stockflow_purchase_orders o on o.id=q.po_id where q.id=request
$$;
-- Same voucher/line evidence insert pattern as po_tally_receipts.sql, then a link
-- fixture; production receipt behavior is covered by that unchanged regression suite.
create function pg_temp.pqc_link(po uuid) returns void language plpgsql as $$
declare voucher uuid; source_line uuid; source text:='pqc-'||po::text;
begin
  insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,kind,cancelled,evidence)
    values('pqc-company',source,1,current_date,'purchase',false,jsonb_build_object('sourceReference','PQC receipt')) returning id into voucher;
  insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
    values(voucher,'1','pqc-product-guid',1,'Nos',500,jsonb_build_object('label','PQC-ITEM')) returning id into source_line;
  insert into private.stockflow_po_tally_receipt_links(po_id,tally_item_key,company_id,source_id,line_key,source_line_id,business_date,quantity,unit,linked_by)
    values(po,'PQC-ITEM','pqc-company',source,'1',source_line,current_date,1,'Nos','ops@test');
end $$;

do $tests$
declare a uuid; b uuid; c uuid; d uuid; request uuid; second_request uuid;
  r jsonb; p jsonb; replay jsonb; old_share jsonb; old_share_result jsonb; pdf_share jsonb; decision_payload jsonb;
  row_doc jsonb; before_count integer; before_version integer; actual text; detail text;
  actor text; signature text; i integer;
begin
  a:=pg_temp.pqc_po('mgr@test');
  perform pg_temp.pqc_assert((select quantity=10 and original_quantity=10 from private.stockflow_purchase_order_lines where po_id=a),
    'Original quantity did not default on gateway creation');
  r:=pg_temp.pqc_call('request_po_quantity_correction',pg_temp.pqc_correction(a,8));
  perform pg_temp.pqc_private(r);
  perform pg_temp.pqc_assert(r->'applied'='true'::jsonb and r->'purchaseOrder'->>'revisionCount'='1'
    and r->'purchaseOrder'->>'version'='2' and r->'purchaseOrder'->'lines'->0->>'quantity'='8'
    and r->'purchaseOrder'->'lines'->0->>'originalQuantity'='10','Direct reduction/base/version');
  perform pg_temp.pqc_assert((select count(*)=1 and bool_and(metadata @> jsonb_build_object('itemKey','PQC-ITEM',
    'fromQuantity',10,'toQuantity',8,'reasonCode','typing_mistake','note','Correct test quantity',
    'requestedByEmail','ops@test','approvedByEmail',null,'mode','direct'))
    from private.stockflow_purchase_order_events where po_id=a and event_type='correct_purchase_order_quantity'),'Direct audit');
  begin
    update private.stockflow_purchase_order_lines set original_quantity=9 where po_id=a;
  exception when others then get stacked diagnostics actual=returned_sqlstate,detail=message_text; end;
  perform pg_temp.pqc_assert(actual='22023' and detail='Original quantity cannot change','Immutable original trigger');
  raise notice 'PASS: original quantity defaults, direct reduction and immutable baseline';

  r:=pg_temp.pqc_call('request_po_quantity_correction',pg_temp.pqc_correction(a,12));
  perform pg_temp.pqc_assert(r->'applied'='true'::jsonb and (r->'purchaseOrder'->'lines'->0->>'quantity')::numeric=12,
    'Exactly 120 percent did not apply');
  b:=pg_temp.pqc_po();
  r:=pg_temp.pqc_call('request_po_quantity_correction',pg_temp.pqc_correction(b,11));
  perform pg_temp.pqc_assert(r->'applied'='true'::jsonb,'First 10 percent increase');
  r:=pg_temp.pqc_call('request_po_quantity_correction',pg_temp.pqc_correction(b,12));
  perform pg_temp.pqc_assert(r->'applied'='true'::jsonb,'Second 10 percent increase');
  p:=pg_temp.pqc_correction(b,12.5);
  r:=pg_temp.pqc_call('request_po_quantity_correction',p);
  perform pg_temp.pqc_assert(r->'applied'='false'::jsonb and r->'purchaseOrder'->>'revisionCount'='2'
    and (r->'purchaseOrder'->'lines'->0->>'quantity')::numeric=12
    and jsonb_array_length(r->'purchaseOrder'->'pendingCorrections')=1,'Chained increase escaped original base');
  request:=(r->'purchaseOrder'->'pendingCorrections'->0->>'requestId')::uuid;
  perform pg_temp.pqc_assert(r->'purchaseOrder'->'pendingCorrections'->0 @> jsonb_build_object('itemKey','PQC-ITEM',
    'fromQuantity',12,'toQuantity',12.5,'reasonCode','typing_mistake','note','Correct test quantity','requestedByEmail','ops@test')
    and r->'purchaseOrder'->'pendingCorrections'->0 ? 'requestedAt','Pending JSON fields');
  select count(*) into before_count from private.stockflow_purchase_order_events where po_id=b;
  replay:=pg_temp.pqc_call('request_po_quantity_correction',p);
  perform pg_temp.pqc_assert(replay=r and (select count(*)=before_count from private.stockflow_purchase_order_events where po_id=b),
    'Request replay changed result or added audit');
  perform pg_temp.pqc_private(replay);
  perform pg_temp.pqc_error('request_po_quantity_correction',p||jsonb_build_object('idempotencyKey',gen_random_uuid()),
    'PT409','Purchase order has changed');
  perform pg_temp.pqc_error('request_po_quantity_correction',pg_temp.pqc_correction(b,13),
    '22023','A correction is already waiting for approval');
  perform pg_temp.pqc_error('request_po_quantity_correction',pg_temp.pqc_correction(b,9),
    '22023','A correction is already waiting for approval');
  raise notice 'PASS: original-based 20 percent boundary, pending uniqueness, replay and stale version';

  old_share:=pg_temp.pqc_command(a)||jsonb_build_object('channel','text');
  old_share_result:=pg_temp.pqc_call('mark_purchase_order_shared',old_share,'mgr@test');
  r:=pg_temp.pqc_call('confirm_purchase_order_supplier',pg_temp.pqc_command(a)||jsonb_build_object('note','Confirmed'),'mgr@test');
  perform pg_temp.pqc_assert(r->'purchaseOrder'->>'supplierConfirmedAt' is not null,'Initial confirmation missing');
  r:=pg_temp.pqc_call('request_po_quantity_correction',pg_temp.pqc_correction(a,11),'mgr@test');
  perform pg_temp.pqc_assert(r->'applied'='false'::jsonb and (r->'purchaseOrder'->'lines'->0->>'quantity')::numeric=12,
    'Shared reduction applied directly');
  request:=(r->'purchaseOrder'->'pendingCorrections'->0->>'requestId')::uuid;
  p:=pg_temp.pqc_decision(request);
  perform pg_temp.pqc_error('decide_po_quantity_correction',p,'42501','You cannot approve your own correction','mgr@test');
  perform pg_temp.pqc_error('decide_po_quantity_correction',p||'{"decision":"reject"}',
    '42501','You cannot approve your own correction','mgr@test');
  perform pg_temp.pqc_error('decide_po_quantity_correction','{}','42501','Only management can review corrections');
  perform pg_temp.pqc_error('decide_po_quantity_correction',p,'42501','Role cannot manage purchase orders','sales@test');
  perform pg_temp.pqc_error('decide_po_quantity_correction',p,'42501','A manager must review this correction','admin@test');
  perform pg_temp.pqc_error('decide_po_quantity_correction',p||'{"decision":"reject"}',
    '42501','A manager must review this correction','admin@test');
  update public.stockflow_members set status='suspended' where email='mgr2@test';
  r:=pg_temp.pqc_call('decide_po_quantity_correction',p||jsonb_build_object('note','Reviewed'),'admin@test');
  perform pg_temp.pqc_assert(r->'purchaseOrder'->'resendNeeded'='true'::jsonb
    and r->'purchaseOrder'->'supplierConfirmedAt'='null'::jsonb and r->'purchaseOrder'->>'revisionCount'='3'
    and (r->'purchaseOrder'->'lines'->0->>'quantity')::numeric=11,'Approval did not apply/clear confirmation/require re-send');
  perform pg_temp.pqc_assert((select status='approved' and decided_by_email='admin@test' and decided_at is not null and decision_note='Reviewed'
    from private.stockflow_po_correction_requests where id=request),'Approval decision fields');
  perform pg_temp.pqc_assert((select count(*)=1 from private.stockflow_purchase_order_events where po_id=a
    and event_type='correct_purchase_order_quantity' and metadata @> jsonb_build_object('requestId',request,
      'requestedByEmail','mgr@test','approvedByEmail','admin@test','fromQuantity',12,'toQuantity',11,'mode','approved')),'Approved audit');
  perform pg_temp.pqc_error('decide_po_quantity_correction',pg_temp.pqc_decision(request),
    '22023','This request was already decided','admin@test');
  raise notice 'PASS: shared reductions pending; separate manager and administrator fallback rules';

  perform pg_temp.pqc_error('confirm_purchase_order_supplier',pg_temp.pqc_command(a),'22023','Share the corrected PO first');
  perform pg_temp.pqc_error('mark_purchase_order_shared',pg_temp.pqc_command(a)||'{"channel":"email"}',
    '22023','Invalid share channel');
  perform pg_temp.pqc_error('mark_purchase_order_shared',pg_temp.pqc_command(a)||'{"channel":null}',
    '22023','Invalid share channel');
  pdf_share:=pg_temp.pqc_command(a)||jsonb_build_object('channel','pdf');
  r:=pg_temp.pqc_call('mark_purchase_order_shared',pdf_share);
  perform pg_temp.pqc_assert(r->'resendNeeded'='false'::jsonb and r->'version'=pdf_share->'expectedVersion',
    'PDF did not clear resend or changed repeated-share version');
  perform pg_temp.pqc_assert((select count(*)=1 from private.stockflow_request_log where actor_email='ops@test'),
    'Share wrapper double-counted admission');
  perform pg_temp.pqc_assert((select count(*)=1 from private.stockflow_purchase_order_events where po_id=a
    and event_type='mark_purchase_order_shared' and metadata->>'channel'='pdf'),'PDF audit channel missing');
  r:=pg_temp.pqc_call('confirm_purchase_order_supplier',pg_temp.pqc_command(a));
  perform pg_temp.pqc_private(r);
  perform pg_temp.pqc_assert(r->'purchaseOrder'->>'supplierConfirmedAt' is not null,'Supplier confirmation after PDF');
  perform pg_temp.pqc_assert((select count(*)=2 from private.stockflow_purchase_order_events where po_id=a
    and event_type='confirm_purchase_order_supplier'),'Confirmation audit missing');
  r:=pg_temp.pqc_call('request_po_quantity_correction',pg_temp.pqc_correction(a,10));
  second_request:=(r->'purchaseOrder'->'pendingCorrections'->0->>'requestId')::uuid;
  r:=pg_temp.pqc_call('decide_po_quantity_correction',pg_temp.pqc_decision(second_request),'mgr@test');
  select count(*),max(o.version) into before_count,before_version
    from private.stockflow_purchase_order_events e join private.stockflow_purchase_orders o on o.id=e.po_id where o.id=a;
  replay:=pg_temp.pqc_call('mark_purchase_order_shared',old_share,'mgr@test');
  perform pg_temp.pqc_assert(replay=old_share_result and (select resend_needed_at is not null and version=before_version
    from private.stockflow_purchase_orders where id=a),'Old share replay cleared newer resend');
  perform pg_temp.pqc_call('mark_purchase_order_shared',pdf_share);
  perform pg_temp.pqc_assert((select resend_needed_at is not null from private.stockflow_purchase_orders where id=a)
    and (select count(*)=before_count from private.stockflow_purchase_order_events where po_id=a),'Old PDF replay changed state/audit');
  perform pg_temp.pqc_error('mark_purchase_order_shared',pdf_share||jsonb_build_object('idempotencyKey',gen_random_uuid()),
    'PT409','Purchase order has changed');
  raise notice 'PASS: approve, PDF re-send, confirm and old share/PDF replay protection';

  c:=pg_temp.pqc_po();
  perform pg_temp.pqc_error('confirm_purchase_order_supplier',pg_temp.pqc_command(c),'22023','Share the purchase order first');
  perform pg_temp.pqc_call('receive_purchase_order',pg_temp.pqc_command(c)||jsonb_build_object('lines',
    jsonb_build_array(jsonb_build_object('itemKey','PQC-ITEM','receivedQuantity',5))));
  perform pg_temp.pqc_error('request_po_quantity_correction',pg_temp.pqc_correction(c,4),'22023','Quantity cannot be below what was received');
  perform pg_temp.pqc_error('request_po_quantity_correction',pg_temp.pqc_correction(c,10),'22023','Enter a different quantity');
  perform pg_temp.pqc_error('request_po_quantity_correction',pg_temp.pqc_correction(c,0),'22023','Invalid quantity');
  perform pg_temp.pqc_error('request_po_quantity_correction',pg_temp.pqc_correction(c,1000001),'22023','Invalid quantity');
  perform pg_temp.pqc_error('request_po_quantity_correction',pg_temp.pqc_correction(c,9)||'{"itemKey":"missing"}',
    '22023','Purchase order line not found');
  r:=pg_temp.pqc_call('request_po_quantity_correction',pg_temp.pqc_correction(c,5));
  perform pg_temp.pqc_assert(r->'applied'='true'::jsonb,'Quantity equal to received was refused');
  perform pg_temp.pqc_link(c);
  perform pg_temp.pqc_error('request_po_quantity_correction',pg_temp.pqc_correction(c,6),'22023','Line is locked: a Tally receipt is linked');
  perform pg_temp.pqc_assert(private.stockflow_purchase_order_json(c,false)->'lines'->0->'locked'='true'::jsonb,'Locked JSON missing');

  -- Pending line cannot be corrected through the gateway; simulate drift as replay owner.
  select id into request from private.stockflow_po_correction_requests where po_id=b and status='pending';
  update private.stockflow_purchase_order_lines set quantity=11 where po_id=b;
  perform pg_temp.pqc_error('decide_po_quantity_correction',pg_temp.pqc_decision(request),'22023',
    'This line changed after the request. Reject it and ask again.','mgr@test');
  perform pg_temp.pqc_call('cancel_purchase_order',pg_temp.pqc_command(b)||jsonb_build_object('reason','Test cancellation'));
  perform pg_temp.pqc_error('request_po_quantity_correction',pg_temp.pqc_correction(b,9),'22023','Open purchase order required');
  perform pg_temp.pqc_error('decide_po_quantity_correction',pg_temp.pqc_decision(request),'22023','Open purchase order required','mgr@test');
  r:=pg_temp.pqc_call('list_po_corrections','{}','mgr@test');
  select value into row_doc from jsonb_array_elements(r->'items') where value->>'poId'=b::text;
  perform pg_temp.pqc_assert(row_doc->>'pending'='0','Cancelled PO included in pending count');
  r:=pg_temp.pqc_call('decide_po_quantity_correction',pg_temp.pqc_decision(request,'reject')||jsonb_build_object('note','Cancelled order'),'mgr@test');
  perform pg_temp.pqc_assert(r->'purchaseOrder'->>'status'='cancelled'
    and r->'purchaseOrder'->'pendingCorrections'='[]'::jsonb
    and (select status='rejected' and decided_by_email='mgr@test' and decided_at is not null and decision_note='Cancelled order'
      from private.stockflow_po_correction_requests where id=request),'Reject on cancelled order');
  raise notice 'PASS: received bounds, Tally locks, drift refusal and rejection on cancelled PO';

  -- Approval rechecks receipt state and links acquired after a request was made.
  d:=pg_temp.pqc_po();
  perform pg_temp.pqc_call('mark_purchase_order_shared',pg_temp.pqc_command(d));
  r:=pg_temp.pqc_call('request_po_quantity_correction',pg_temp.pqc_correction(d,4));
  request:=(r->'purchaseOrder'->'pendingCorrections'->0->>'requestId')::uuid;
  perform pg_temp.pqc_call('receive_purchase_order',pg_temp.pqc_command(d)||jsonb_build_object('lines',
    jsonb_build_array(jsonb_build_object('itemKey','PQC-ITEM','receivedQuantity',5))));
  perform pg_temp.pqc_error('decide_po_quantity_correction',pg_temp.pqc_decision(request),'22023','Quantity cannot be below what was received','mgr@test');
  perform pg_temp.pqc_link(d);
  perform pg_temp.pqc_error('decide_po_quantity_correction',pg_temp.pqc_decision(request),'22023','Line is locked: a Tally receipt is linked','mgr@test');
  raise notice 'PASS: approval revalidates receipt quantity and Tally locks';

  -- Cache was created with financial visibility, then replayed under current roles.
  c:=pg_temp.pqc_po('mgr@test');
  p:=pg_temp.pqc_correction(c,9);
  r:=pg_temp.pqc_call('request_po_quantity_correction',p,'mgr@test');
  perform pg_temp.pqc_assert(jsonb_path_exists(r,'$.**.rate') and jsonb_path_exists(r,'$.**.totalValue'),'Privileged result lost rates');
  update public.stockflow_members set role='operations',roles=array['operations'] where email='mgr@test';
  replay:=pg_temp.pqc_call('request_po_quantity_correction',p,'mgr@test');
  perform pg_temp.pqc_private(replay);
  perform pg_temp.pqc_assert(replay=private.stockflow_purchase_redact(r),'Cached role downgrade did not redact exactly');
  update public.stockflow_members set role='management',roles=array['management'] where email='mgr@test';
  update public.stockflow_members set status='active' where email='mgr2@test';
  r:=pg_temp.pqc_call('request_po_quantity_correction',pg_temp.pqc_correction(c,13));
  request:=(r->'purchaseOrder'->'pendingCorrections'->0->>'requestId')::uuid;
  decision_payload:=pg_temp.pqc_decision(request);
  perform pg_temp.pqc_call('decide_po_quantity_correction',decision_payload,'mgr2@test');
  update public.stockflow_members set role='operations',roles=array['operations'] where email='mgr2@test';
  perform pg_temp.pqc_error('decide_po_quantity_correction',decision_payload,'42501','Only management can review corrections','mgr2@test');
  update public.stockflow_members set role='management',roles=array['management'] where email='mgr2@test';
  raise notice 'PASS: fresh/cached recursive redaction and role check before cached decisions';

  perform pg_temp.pqc_call('receive_purchase_order',pg_temp.pqc_command(a)||jsonb_build_object('lines',
    jsonb_build_array(jsonb_build_object('itemKey','PQC-ITEM','receivedQuantity',1))));
  r:=pg_temp.pqc_call('list_po_corrections','{}','mgr@test');
  perform pg_temp.pqc_assert(r->>'view'='po_corrections' and r->>'since'=((now() at time zone 'Asia/Kolkata')::date-7)::text
    and jsonb_array_length(r->'items')<=100,'Weekly envelope or bound');
  select value into row_doc from jsonb_array_elements(r->'items') where value->>'poId'=a::text;
  perform pg_temp.pqc_assert(row_doc @> jsonb_build_object('poId',a,'supplierName','Test supplier','status','open',
    'createdByEmail','mgr@test','corrections',4,'pending',0,'flags',jsonb_build_object(
      'byCreator',true,'moreThanTwo',true,'beforeReceipt',true,'notResent',true)) and row_doc ? 'poNumber','Weekly counts and flags');
  select value into row_doc from jsonb_array_elements(r->'items') where value->>'poId'=d::text;
  perform pg_temp.pqc_assert(row_doc->>'pending'='1' and row_doc->>'corrections'='0','Requested-only PO missing');
  perform pg_temp.pqc_error('list_po_corrections','{}','42501','Only management can review corrections');
  perform pg_temp.pqc_error('list_po_corrections','{}','42501','Role cannot manage purchase orders','sales@test');
  perform pg_temp.pqc_error('list_po_corrections','{"extra":true}','22023','Invalid corrections list payload','mgr@test');
  raise notice 'PASS: weekly creator, repeated-correction, before-receipt, pending and not-resent flags';

  -- Exact command keys, JSON types and reason/note bounds are server-side controls.
  c:=pg_temp.pqc_po();
  p:=pg_temp.pqc_correction(c,9);
  perform pg_temp.pqc_error('request_po_quantity_correction',p||'{"extra":true}','22023','Invalid correction payload');
  perform pg_temp.pqc_error('request_po_quantity_correction',p-'note','22023','Invalid correction payload');
  perform pg_temp.pqc_error('request_po_quantity_correction',p||'{"quantity":"9"}','22023','Invalid quantity');
  perform pg_temp.pqc_error('request_po_quantity_correction',p||'{"reasonCode":"other"}','22023','Invalid correction reason');
  perform pg_temp.pqc_error('request_po_quantity_correction',p||'{"note":" x "}','22023','Correction note must contain 3 to 300 characters');
  perform pg_temp.pqc_error('request_po_quantity_correction',p||jsonb_build_object('note',repeat('x',301)),
    '22023','Correction note must contain 3 to 300 characters');
  perform pg_temp.pqc_error('request_po_quantity_correction',p||'{"idempotencyKey":"bad"}','22023','Valid idempotency key required');
  perform pg_temp.pqc_error('confirm_purchase_order_supplier',pg_temp.pqc_command(c)||'{"extra":true}',
    '22023','Invalid supplier confirmation payload');
  perform pg_temp.pqc_error('confirm_purchase_order_supplier',pg_temp.pqc_command(c)||jsonb_build_object('note',repeat('x',201)),
    '22023','Confirmation note must contain at most 200 characters');
  select id into request from private.stockflow_po_correction_requests where po_id=d and status='pending';
  p:=pg_temp.pqc_decision(request,'reject');
  perform pg_temp.pqc_error('decide_po_quantity_correction',p||'{"extra":true}','22023','Invalid correction decision payload','mgr@test');
  perform pg_temp.pqc_error('decide_po_quantity_correction',p||'{"decision":"other"}','22023','Invalid correction decision','mgr@test');
  perform pg_temp.pqc_error('decide_po_quantity_correction',p||jsonb_build_object('note',repeat('x',301)),
    '22023','Decision note must contain at most 300 characters','mgr@test');
  raise notice 'PASS: exact payload keys and type, reason and note validation';

  -- History remains bounded without losing the all-time revision/audit count.
  for i in 1..21 loop
    perform pg_temp.pqc_call('request_po_quantity_correction',pg_temp.pqc_correction(c,case when i%2=1 then 9 else 10 end));
  end loop;
  r:=private.stockflow_purchase_order_json(c,true);
  perform pg_temp.pqc_assert(jsonb_array_length(r->'corrections')=20 and r->>'revisionCount'='21'
    and (select count(*)=21 from private.stockflow_purchase_order_events where po_id=c and event_type='correct_purchase_order_quantity'),
    'History cap changed audit retention');
  perform pg_temp.pqc_assert((r->>'totalValue')::numeric=90,'Original totalValue expression changed');
  perform pg_temp.pqc_assert((select relrowsecurity from pg_class where oid='private.stockflow_po_correction_requests'::regclass),'Requests RLS');
  foreach actor in array array['anon','authenticated','service_role'] loop
    perform pg_temp.pqc_assert(not has_table_privilege(actor,'private.stockflow_po_correction_requests','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
      'Requests exposed to '||actor);
    foreach signature in array array['private.stockflow_po_line_original_default()','private.stockflow_po_line_original_immutable()',
      'private.stockflow_purchase_order_json(uuid,boolean)'] loop
      perform pg_temp.pqc_assert(not has_function_privilege(actor,signature,'EXECUTE'),'Private helper exposed: '||signature);
    end loop;
  end loop;
  foreach signature in array array['public.stockflow_po_revision_gateway(text,text,text,jsonb)',
    'public.stockflow_purchase_gateway(text,text,text,jsonb)','public.stockflow_purchase_gateway_before_revisions(text,text,text,jsonb)'] loop
    perform pg_temp.pqc_assert(not has_function_privilege('anon',signature,'EXECUTE')
      and not has_function_privilege('authenticated',signature,'EXECUTE') and has_function_privilege('service_role',signature,'EXECUTE'),
      'Gateway grants: '||signature);
  end loop;
  -- Test the shared admission counter without the fixture helper clearing it.
  delete from private.stockflow_request_log where actor_email='ops@test';
  insert into private.stockflow_request_log(actor_email,action)
    select 'ops@test','list_purchase_orders' from generate_series(1,30);
  actual:=null; detail:=null;
  begin perform public.stockflow_po_revision_gateway('pqc-test-key','ops@test','request_po_quantity_correction',pg_temp.pqc_correction(c,8));
  exception when others then get stacked diagnostics actual=returned_sqlstate,detail=message_text; end;
  perform pg_temp.pqc_assert(actual='54000' and detail='Too many order requests','Shared purchase admission counter');
  actual:=null; detail:=null;
  begin perform public.stockflow_po_revision_gateway('wrong-key','sales@test','list_po_corrections','{}');
  exception when others then get stacked diagnostics actual=returned_sqlstate,detail=message_text; end;
  perform pg_temp.pqc_assert(actual='42501' and detail='Unauthorized gateway','Gateway key must be checked first');
  raise notice 'PASS: bounded history, unchanged total value, private grants and shared admission';
end $tests$;
rollback;
