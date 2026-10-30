begin;
-- Isolated PTR fixtures: UUID command keys, finite relative dates, positive
-- quantities, INR vouchers, nonempty product/unit evidence. No concurrency prefix.
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('ptr-test-key','sha256'),'hex') where name='orders';
insert into public.stockflow_members(email,role,roles,status)
 select 'ptr-'||r||'@test.local',r,array[r],'active'
 from unnest(array['administrator','management','operations','sales','warehouse']) r;

create function pg_temp.ptr_assert(p_ok boolean,p_message text) returns void language plpgsql as $$
begin if p_ok is distinct from true then raise exception '%',p_message; end if; end $$;
create function pg_temp.ptr_call(p_action text,p_payload jsonb,p_role text default 'administrator')
returns jsonb language plpgsql as $$
begin
 delete from private.stockflow_request_log where actor_email='ptr-'||p_role||'@test.local';
 return public.stockflow_po_receipt_gateway('ptr-test-key','ptr-'||p_role||'@test.local',p_action,p_payload);
end $$;
create function pg_temp.ptr_error(p_action text,p_payload jsonb,p_code text,p_role text default 'administrator')
returns text language plpgsql as $$
declare v_code text; v_message text;
begin
 begin perform pg_temp.ptr_call(p_action,p_payload,p_role);
 exception when others then get stacked diagnostics v_code=returned_sqlstate,v_message=message_text; end;
 perform pg_temp.ptr_assert(v_code=p_code,'Expected '||p_code||', got '||coalesce(v_code,'success'));
 return v_message;
end $$;
create function pg_temp.ptr_private(p_value jsonb) returns void language plpgsql as $$
begin
 perform pg_temp.ptr_assert(p_value::text !~* '"[^"]*(rate|amount|paise|totalValue)[^"]*"\s*:', 'R7: private amount in response');
end $$;
create function pg_temp.ptr_po(p_item text,p_qty numeric,p_unit text default 'Nos') returns uuid language plpgsql as $$
declare v_id uuid:=gen_random_uuid();
begin
 insert into private.stockflow_products(tally_item_key,name,base_unit) values(p_item,p_item,'Nos') on conflict(tally_item_key) do nothing;
 insert into private.stockflow_purchase_orders(id,po_number,supplier_name,created_by_email,created_at)
 values(v_id,'PTR-'||v_id,'PTR supplier','ptr-administrator@test.local',current_date::timestamp at time zone 'Asia/Kolkata');
 insert into private.stockflow_purchase_order_lines(po_id,tally_item_key,item_name,quantity,unit,rate)
 values(v_id,p_item,p_item,p_qty,p_unit,10);
 return v_id;
end $$;
-- Same insert pattern as economics_candidate_rebuild.sql; evidence label, not product_id, matches the PO.
create function pg_temp.ptr_source(p_source text,p_item text,p_qty numeric,p_day date,p_revision bigint default 1,
 p_unit text default 'Nos',p_cancelled boolean default false,p_kind text default 'purchase',p_line text default '1',p_company text default 'ptr-company')
returns uuid language plpgsql as $$
declare v_voucher uuid; v_line uuid;
begin
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,kind,cancelled,evidence)
 values(p_company,p_source,p_revision,p_day,p_kind,p_cancelled,jsonb_build_object('sourceReference','PTR '||p_source))
 on conflict(company_id,source_id,source_revision) do nothing;
 select id into v_voucher from private.stockflow_economic_source_vouchers where company_id=p_company and source_id=p_source and source_revision=p_revision;
 insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
 values(v_voucher,p_line,'ptr-product-guid',p_qty,p_unit,500,jsonb_build_object('label',p_item)) returning id into v_line;
 return v_line;
end $$;
create function pg_temp.ptr_command(p_id uuid,p_item text,p_source text,p_version integer default 1,p_line text default '1')
returns jsonb language sql as $$
 select jsonb_build_object('id',p_id,'expectedVersion',p_version,'idempotencyKey',gen_random_uuid(),
 'links',jsonb_build_array(jsonb_build_object('itemKey',p_item,'sourceId',p_source,'lineKey',p_line)))
$$;

do $tests$
declare v_a uuid; v_b uuid; v_c uuid; v_line uuid; v_result jsonb; v_before jsonb; v_payload jsonb;
 v_candidates jsonb; v_role text; v_action text; v_code text; v_message text;
begin
 -- R1: Matching label/date, cancellation, kind, quantity and latest revision eligibility.
 v_a:=pg_temp.ptr_po('PTR-ELIGIBLE',10,null);
 perform pg_temp.ptr_source('eligible','PTR-ELIGIBLE',2,current_date,1,' nos ');
 perform pg_temp.ptr_source('early','PTR-ELIGIBLE',2,current_date-1);
 perform pg_temp.ptr_source('cancelled','PTR-ELIGIBLE',2,current_date,1,'Nos',true);
 perform pg_temp.ptr_source('revised','PTR-ELIGIBLE',9,current_date,1);
 v_line:=pg_temp.ptr_source('revised','PTR-ELIGIBLE',3,current_date,2);
 perform pg_temp.ptr_source('cancel-revision','PTR-ELIGIBLE',2,current_date,1);
 perform pg_temp.ptr_source('cancel-revision','PTR-ELIGIBLE',2,current_date,2,'Nos',true);
 perform pg_temp.ptr_source('sale','PTR-ELIGIBLE',2,current_date,1,'Nos',false,'sale');
 perform pg_temp.ptr_source('zero','PTR-ELIGIBLE',0,current_date);
 perform pg_temp.ptr_source('negative','PTR-ELIGIBLE',-1,current_date);
 perform pg_temp.ptr_source('wrong-label','PTR-OTHER',2,current_date);
 -- A newer source in a different company must not suppress this company's latest revision.
 perform pg_temp.ptr_source('eligible','PTR-OTHER',2,current_date,99,'Nos',false,'purchase','1','ptr-other-company');
 v_result:=pg_temp.ptr_call('get_tally_receipts',jsonb_build_object('id',v_a));
 v_candidates:=v_result->'lines'->0->'candidates';
 perform pg_temp.ptr_assert(v_result->>'poId'=v_a::text and (v_result->>'version')::integer=1
  and jsonb_array_length(v_candidates)=2 and v_candidates @> '[{"sourceId":"eligible","quantity":2,"selectable":true,"reason":null},{"sourceId":"revised","quantity":3,"selectable":true}]','R1: eligibility or base-unit fallback');
 perform pg_temp.ptr_private(v_result);
 perform pg_temp.ptr_assert((select received_quantity=0 from private.stockflow_purchase_order_lines where po_id=v_a),'R1: advisory read received stock');
 raise notice 'PASS R1: candidate eligibility and latest revision';

 -- R2: Add to a manual partial receipt, audit, version, and completion.
 v_b:=pg_temp.ptr_po('PTR-RECEIVE',5);
 perform public.stockflow_purchase_gateway('ptr-test-key','ptr-administrator@test.local','receive_purchase_order',
  jsonb_build_object('id',v_b,'expectedVersion',1,'idempotencyKey',gen_random_uuid(),'lines',jsonb_build_array(jsonb_build_object('itemKey','PTR-RECEIVE','receivedQuantity',2))));
 v_line:=pg_temp.ptr_source('receive','PTR-RECEIVE',3,current_date);
 v_payload:=pg_temp.ptr_command(v_b,'PTR-RECEIVE','receive',2);
 v_result:=pg_temp.ptr_call('receive_from_tally',v_payload);
 perform pg_temp.ptr_assert(v_result->>'status'='received' and (v_result->>'version')::integer=3
  and (v_result->'lines'->0->>'receivedQuantity')::numeric=5,'R2: additive receipt/completion/version');
 perform pg_temp.ptr_assert((select count(*)=1 and bool_and(source_line_id=v_line and quantity=3 and linked_by='ptr-administrator@test.local')
  from private.stockflow_po_tally_receipt_links where po_id=v_b),'R2: link missing');
 perform pg_temp.ptr_assert((select count(*)=1 from private.stockflow_purchase_order_events where po_id=v_b
  and event_type='receive_purchase_order' and metadata->>'source'='tally' and metadata->'links'=v_payload->'links'),'R2: audit missing');
 raise notice 'PASS R2: additive receipt, audit, version and completion';

 -- R3: Revision-independent one-line/one-PO guarantee.
 v_c:=pg_temp.ptr_po('PTR-RECEIVE',5);
 perform pg_temp.ptr_error('receive_from_tally',pg_temp.ptr_command(v_c,'PTR-RECEIVE','receive'),'PT409');
 perform pg_temp.ptr_source('receive','PTR-RECEIVE',4,current_date,2);
 perform pg_temp.ptr_error('receive_from_tally',pg_temp.ptr_command(v_c,'PTR-RECEIVE','receive'),'PT409');
 perform pg_temp.ptr_assert(jsonb_array_length(pg_temp.ptr_call('get_tally_receipts',jsonb_build_object('id',v_c))->'lines'->0->'candidates')=0,'R3: revision reoffered linked line');
 perform pg_temp.ptr_assert((select source_line_id=v_line and quantity=3 from private.stockflow_po_tally_receipt_links where po_id=v_b),'R3: original evidence changed');
 raise notice 'PASS R3: duplicate receipt blocked across revisions';

 -- R6: Replay is identical even after re-revision; fresh-key stale version conflicts.
 perform pg_temp.ptr_assert(pg_temp.ptr_call('receive_from_tally',v_payload)=v_result,'R6: replay changed result');
 perform pg_temp.ptr_assert((select count(*)=1 from private.stockflow_po_tally_receipt_links where po_id=v_b),'R6: replay duplicated link');
 perform pg_temp.ptr_error('receive_from_tally',v_payload||jsonb_build_object('idempotencyKey',gen_random_uuid()),'PT409');
 update public.stockflow_members set role='operations',roles=array['operations'] where email='ptr-administrator@test.local';
 perform pg_temp.ptr_private(pg_temp.ptr_call('receive_from_tally',v_payload));
 update public.stockflow_members set role='administrator',roles=array['administrator'] where email='ptr-administrator@test.local';
 raise notice 'PASS R6: idempotency, stale version and replay redaction';

 -- R4: Each candidate fits alone; their per-item sum must still be rejected atomically.
 perform pg_temp.ptr_source('sum','PTR-RECEIVE',3,current_date,1,'Nos',false,'purchase','1');
 perform pg_temp.ptr_source('sum','PTR-RECEIVE',3,current_date,1,'Nos',false,'purchase','2');
 v_before:=pg_temp.ptr_call('get_tally_receipts',jsonb_build_object('id',v_c));
 v_payload:=pg_temp.ptr_command(v_c,'PTR-RECEIVE','sum');
 v_payload:=jsonb_set(v_payload,'{links}',v_payload->'links'||jsonb_build_array(jsonb_build_object('itemKey','PTR-RECEIVE','sourceId','sum','lineKey','2')));
 v_message:=pg_temp.ptr_error('receive_from_tally',v_payload,'22023');
 perform pg_temp.ptr_assert(v_message like '%5%' and pg_temp.ptr_call('get_tally_receipts',jsonb_build_object('id',v_c))=v_before,'R4: over-receipt changed state or omitted remaining');
 perform pg_temp.ptr_assert(not exists(select 1 from private.stockflow_po_tally_receipt_links where po_id=v_c),'R4: partial link committed');
 perform pg_temp.ptr_source('too-large','PTR-RECEIVE',6,current_date);
 v_result:=pg_temp.ptr_call('get_tally_receipts',jsonb_build_object('id',v_c));
 perform pg_temp.ptr_assert(v_result->'lines'->0->'candidates' @> '[{"sourceId":"too-large","selectable":false,"reason":"exceeds_remaining"}]','R4: candidate reason');
 perform pg_temp.ptr_error('receive_from_tally',pg_temp.ptr_command(v_c,'PTR-RECEIVE','too-large'),'22023');
 raise notice 'PASS R4: summed over-receipt rejected atomically';

 -- R5: Explicit PO unit takes priority over product base unit.
 v_a:=pg_temp.ptr_po('PTR-UNIT',10,'Box');
 perform pg_temp.ptr_source('unit','PTR-UNIT',1,current_date,1,'Nos');
 v_result:=pg_temp.ptr_call('get_tally_receipts',jsonb_build_object('id',v_a));
 perform pg_temp.ptr_assert(v_result->'lines'->0->'candidates' @> '[{"sourceId":"unit","selectable":false,"reason":"unit_mismatch"}]','R5: wrong-unit selectable');
 perform pg_temp.ptr_error('receive_from_tally',pg_temp.ptr_command(v_a,'PTR-UNIT','unit'),'22023');
 raise notice 'PASS R5: unit mismatch read and write';

 -- R7: Operations reads and receives without any financial fields; forbidden roles fail all actions.
 v_a:=pg_temp.ptr_po('PTR-OPS',1);
 perform pg_temp.ptr_source('ops','PTR-OPS',1,current_date);
 perform pg_temp.ptr_private(pg_temp.ptr_call('get_tally_receipts',jsonb_build_object('id',v_a),'operations'));
 perform pg_temp.ptr_private(pg_temp.ptr_call('get_tally_receipt_counts',jsonb_build_object('ids',jsonb_build_array(v_a)),'operations'));
 v_result:=pg_temp.ptr_call('receive_from_tally',pg_temp.ptr_command(v_a,'PTR-OPS','ops'),'operations');
 perform pg_temp.ptr_private(v_result);
 perform pg_temp.ptr_assert(v_result->>'status'='received','R7: operations cannot receive');
 foreach v_role in array array['sales','warehouse'] loop
  foreach v_action in array array['get_tally_receipts','get_tally_receipt_counts','receive_from_tally'] loop
   perform pg_temp.ptr_error(v_action,'{}','42501',v_role);
  end loop;
 end loop;
 raise notice 'PASS R7: operational access and financial redaction';

 -- R8: Both append-only helpers reject mutation; grants and RLS protect direct access.
 begin update private.stockflow_po_tally_receipt_links set quantity=2 where po_id=v_b;
 exception when others then get stacked diagnostics v_code=returned_sqlstate; end;
 perform pg_temp.ptr_assert(v_code='55000','R8: immutable trigger missing');
 v_code:=null;
 begin delete from private.stockflow_po_tally_receipt_links where po_id=v_b;
 exception when others then get stacked diagnostics v_code=returned_sqlstate; end;
 perform pg_temp.ptr_assert(v_code='42501','R8: no_delete trigger missing');
 perform pg_temp.ptr_assert((select relrowsecurity from pg_class where oid='private.stockflow_po_tally_receipt_links'::regclass)
  and not has_table_privilege('authenticated','private.stockflow_po_tally_receipt_links','select,insert,update,delete')
  and not has_table_privilege('anon','private.stockflow_po_tally_receipt_links','select,insert,update,delete'),'R8: private table exposed');
 raise notice 'PASS R8: append-only links and private access';

 -- R9: Counts are selectable, uncapped, PO-scoped, and zero for closed POs.
 v_c:=pg_temp.ptr_po('PTR-COUNT',2);
 perform pg_temp.ptr_source('count','PTR-COUNT',1,current_date);
 perform pg_temp.ptr_source('count-unit','PTR-COUNT',1,current_date,1,'Box');
 perform pg_temp.ptr_source('count-large','PTR-COUNT',3,current_date);
 v_result:=pg_temp.ptr_call('get_tally_receipt_counts',jsonb_build_object('ids',jsonb_build_array(v_c,v_b)));
 perform pg_temp.ptr_assert(v_result=jsonb_build_object('counts',jsonb_build_object(v_c::text,1,v_b::text,0)),'R9: wrong counts');
 perform pg_temp.ptr_error('get_tally_receipt_counts',jsonb_build_object('ids',(select jsonb_agg(gen_random_uuid()) from generate_series(1,21))),'22023');
 perform pg_temp.ptr_error('get_tally_receipt_counts','{"ids":[]}','22023');
 perform pg_temp.ptr_error('get_tally_receipts',jsonb_build_object('id',v_b),'22023');
 perform pg_temp.ptr_error('get_tally_receipts','{"id":"bad"}','22023');
 -- Limit is on detail only, with deterministic date/reference ordering.
 perform pg_temp.ptr_source('count-'||lpad(i::text,2,'0'),'PTR-COUNT',1,current_date+1) from generate_series(1,22) i;
 v_result:=pg_temp.ptr_call('get_tally_receipts',jsonb_build_object('id',v_c));
 perform pg_temp.ptr_assert(jsonb_array_length(v_result->'lines'->0->'candidates')=20
  and v_result->'lines'->0->'candidates'->0->>'sourceId'='count','R9: bounded/ordered detail');
 v_result:=pg_temp.ptr_call('get_tally_receipt_counts',jsonb_build_object('ids',jsonb_build_array(v_c)));
 perform pg_temp.ptr_assert((v_result->'counts'->>v_c::text)::integer=23,'R9: count incorrectly capped');
 raise notice 'PASS R9: counts, bounds and closed POs';
end $tests$;
rollback;
