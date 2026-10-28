begin;
-- All business mutations use real gateways; evidence uses the real snapshot trigger.
-- Fixture literals / constraints:
-- members: po-{role}@test.local; roles administrator,management,operations,warehouse,
-- sales,viewer,accounts,billing; status active (existing member enums).
-- products/catalog: PO-A,PO-B,PO-C,PO-NONE (keys/names 1..220); baseUnit Nos (1..40).
-- suppliers: Alpha,Beta,Old,Wrong,Legacy (1..220); units Nos,' nos ',Box,null (<=40).
-- rates: 1,2,10,12,15,20 (positive numeric(14,4)); dates today,today-1,today-366 (finite dates).
-- references: P-1 (1..160); source IDs item|supplier|unit (1..240).
-- snapshot: id suprabha,company PO TEST,fetched_at now()::text; catalog active true.
-- reorder: closing 0,reorderLevel 10,minimumOrder 5,purchaseOrder 0,orderToBePlaced 10.
-- commands: UUIDs gen_random_uuid(); quantities 6,10,3,2,1 (>0 <=1000000), received 0,2,6.
-- cancellation reason 'Duplicate order' (3..300); invalid fixtures are isolated subtransactions.
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('supplier-po-test-key','sha256'),'hex') where name='orders';
insert into public.stockflow_members(email,role,roles,status)
  select 'po-'||r||'@test.local',r,array[r],'active' from unnest(array[
    'administrator','management','operations','warehouse','sales','viewer','accounts','billing']) r;

create function pg_temp.po_call(a text,p jsonb default '{}',r text default 'administrator')
returns jsonb language plpgsql as $$
begin
  delete from private.stockflow_request_log where actor_email='po-'||r||'@test.local';
  return public.stockflow_purchase_gateway('supplier-po-test-key','po-'||r||'@test.local',a,p);
end $$;
create function pg_temp.po_assert(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%',message; end if; end $$;
create function pg_temp.po_private(r jsonb) returns void language plpgsql as $$
begin
  -- Strict missing-member access raises on heterogeneous JSON. Suppress that
  -- structural error, then also traverse in lax mode so it cannot hide a later key.
  perform pg_temp.po_assert(not coalesce(jsonb_path_exists(r,'strict $.**.rate','{}',true),false)
    and not jsonb_path_exists(r,'$.**.rate'),'Operations leaked rate');
  perform pg_temp.po_assert(not coalesce(jsonb_path_exists(r,'strict $.**.total','{}',true),false)
    and not jsonb_path_exists(r,'$.**.total'),'Operations leaked total');
end $$;
create function pg_temp.po_error(a text,p jsonb,code text,r text default 'administrator')
returns void language plpgsql as $$
declare actual text;
begin
  begin perform pg_temp.po_call(a,p,r);
  exception when others then get stacked diagnostics actual=returned_sqlstate; end;
  perform pg_temp.po_assert(actual=code,'Expected '||code||' for '||a||', got '||coalesce(actual,'success'));
end $$;
create function pg_temp.po_evidence(item text,supplier text,price numeric,day date,u text default 'Nos')
returns jsonb language sql as $$
 select jsonb_build_object('tallyItemKey',item,'supplierName',supplier,'rate',price,'unit',u,
  'effectiveAt',day,'sourceReference','P-1','sourceId',item||'|'||supplier||'|'||coalesce(u,''))
$$;
create function pg_temp.po_import(evidence jsonb) returns void language plpgsql as $$
begin
  update public.stockflow_snapshots set payload=payload||jsonb_build_object('pricingHistory',jsonb_build_object('supplierPrices',evidence)) where id='suprabha';
end $$;
create function pg_temp.po_requirements() returns jsonb language sql as $$
  select public.stockflow_requirements_gateway('supplier-po-test-key','po-operations@test.local','get_requirements','{"view":"to_order","page":1}')
$$;

do $test$
declare today date:=(now() at time zone 'Asia/Kolkata')::date; evidence jsonb; saved jsonb; p jsonb; r jsonb; replay jsonb;
  x jsonb; a uuid; b uuid; c uuid; number1 integer; number2 integer; fy text; y integer; role_name text;
  before_count integer; actual text; message text; sig text; t text; item text;
begin
  foreach item in array array['PO-A','PO-B','PO-C','PO-NONE'] loop
    insert into private.stockflow_products(tally_item_key,name,base_unit) values(item,item,'Nos');
  end loop;
  insert into public.stockflow_snapshots(id,company,fetched_at,payload)
  values('suprabha','PO TEST',now()::text,jsonb_build_object('catalog',
    (select jsonb_agg(jsonb_build_object('tallyKey',v,'item',v,'baseUnit','Nos','closing',0,'active',true))
      from unnest(array['PO-A','PO-B','PO-C','PO-NONE']) v),
    'rows',(select jsonb_agg(jsonb_build_object('item',v,'closing',0,'reorderLevel',10,'minimumOrder',5,'purchaseOrder',0,'orderToBePlaced',10))
      from unnest(array['PO-A','PO-B']) v)))
  on conflict(id) do update set payload=excluded.payload;
  evidence:=jsonb_build_array(
    pg_temp.po_evidence('PO-A','Alpha',10,today),pg_temp.po_evidence('PO-A','Beta',12,today),
    pg_temp.po_evidence('PO-A','Old',1,today-366),pg_temp.po_evidence('PO-A','Wrong',1,today,'Box'),
    pg_temp.po_evidence('PO-B','Alpha',15,today-1),pg_temp.po_evidence('PO-B','Beta',15,today,' nos '),
    pg_temp.po_evidence('PO-C','Alpha',20,today),pg_temp.po_evidence('PO-C','Legacy',2,today,null));
  perform pg_temp.po_import(evidence);
  perform pg_temp.po_assert((select supplier_name='Alpha' from private.stockflow_lowest_supplier('PO-A')),'Cheapest/base-unit/age selection failed');
  perform pg_temp.po_assert((select supplier_name='Beta' from private.stockflow_lowest_supplier('PO-B')),'Latest date tie or normalized units failed');
  perform pg_temp.po_assert((select supplier_name='Legacy' from private.stockflow_lowest_supplier('PO-C')),'Legacy null unit rejected');
  -- Missing key preserves; explicit empty array replaces; subsequent array restores.
  update public.stockflow_snapshots set payload=payload||'{"pricingHistory":{"purchaseCosts":[]}}'::jsonb where id='suprabha';
  perform pg_temp.po_assert((select count(*)=8 from private.stockflow_supplier_prices),'Old connector cleared prices');
  perform pg_temp.po_import('[]');
  perform pg_temp.po_assert((select count(*)=0 from private.stockflow_supplier_prices),'Empty replacement failed');
  perform pg_temp.po_import(evidence);
  begin
    perform pg_temp.po_import(evidence||jsonb_build_array(pg_temp.po_evidence('PO-A','Debit',1,today)||'{"voucherType":"Debit Note"}'::jsonb));
    raise exception 'Debit Note evidence accepted';
  exception when sqlstate '22023' then null; end;
  perform pg_temp.po_assert((select count(*)=8 from private.stockflow_supplier_prices),'Rejected batch changed current state');
  begin perform pg_temp.po_import(evidence||jsonb_build_array(pg_temp.po_evidence('PO-A','Invalid',0,today)));
    raise exception 'Invalid rate accepted'; exception when sqlstate '22023' then null; end;
  begin perform pg_temp.po_import(evidence||jsonb_build_array(evidence->0));
    raise exception 'Duplicate evidence accepted'; exception when sqlstate '22023' then null; end;
  -- Three lines, two suppliers (explicit override C to Alpha).
  p:=jsonb_build_object('idempotencyKey',gen_random_uuid(),'lines',jsonb_build_array(
    jsonb_build_object('itemKey','PO-A','quantity',6),jsonb_build_object('itemKey','PO-B','quantity',10),
    jsonb_build_object('itemKey','PO-C','quantity',3,'supplierName','Alpha')));
  r:=pg_temp.po_call('create_purchase_orders',p);
  perform pg_temp.po_assert(jsonb_array_length(r->'purchaseOrders')=2,'Did not group by supplier');
  a:=(r->'purchaseOrders'->0->>'id')::uuid; b:=(r->'purchaseOrders'->1->>'id')::uuid;
  number1:=split_part(r->'purchaseOrders'->0->>'poNumber','/',3)::integer;
  number2:=split_part(r->'purchaseOrders'->1->>'poNumber','/',3)::integer;
  y:=extract(year from today)::integer-case when extract(month from today)<4 then 1 else 0 end;
  fy:=lpad((y%100)::text,2,'0')||'-'||lpad(((y+1)%100)::text,2,'0');
  perform pg_temp.po_assert(number2=number1+1 and r->'purchaseOrders'->0->>'poNumber' like 'PO/'||fy||'/%','FY/consecutive numbering failed');
  if today between date '2026-04-01' and date '2027-03-31' then
    perform pg_temp.po_assert(r->'purchaseOrders'->0->>'poNumber' ~ '^PO/26-27/[0-9]{4,}$','2026 FY format failed'); end if;
  perform pg_temp.po_assert((select rate=10 from private.stockflow_purchase_order_lines where po_id=a and tally_item_key='PO-A'),'Rate not snapshotted');
  select count(*) into before_count from private.stockflow_purchase_orders;
  replay:=pg_temp.po_call('create_purchase_orders',p);
  perform pg_temp.po_assert(replay=r and (select count(*)=before_count from private.stockflow_purchase_orders),'Idempotency created another PO');
  -- A changed supplier import must not rewrite saved PO prices.
  perform pg_temp.po_import(jsonb_build_array(pg_temp.po_evidence('PO-A','Alpha',20,today)));
  perform pg_temp.po_assert((select rate=10 from private.stockflow_purchase_order_lines where po_id=a and tally_item_key='PO-A'),'Import rewrote PO rate');
  perform pg_temp.po_import(evidence);
  -- Replays must use current roles, including a downgrade from administrator to operations.
  update public.stockflow_members set role='operations',roles=array['operations'] where email='po-administrator@test.local';
  perform pg_temp.po_private(pg_temp.po_call('create_purchase_orders',p));
  update public.stockflow_members set role='administrator',roles=array['administrator'] where email='po-administrator@test.local';
  r:=pg_temp.po_requirements();
  select value into x from jsonb_array_elements(r->'items') where value->>'itemKey'='PO-A';
  perform pg_temp.po_assert((x->>'openPoQty')::numeric=6 and (x->>'suggestedQty')::numeric=5,'Need 4 must round to minimum 5 with open PO 6');
  perform pg_temp.po_assert(not exists(select 1 from jsonb_array_elements(r->'items') where value->>'itemKey'='PO-B'),'Covered item remained listed');
  perform pg_temp.po_assert(not coalesce(jsonb_path_exists(r,'strict $.**.rate','{}',true),false)
    and not jsonb_path_exists(r,'$.**.rate'),'To order leaked rate');
  perform pg_temp.po_assert(x->'lowestSupplier'='{"supplierName":"Alpha"}'::jsonb,'To order supplier contract failed');
  -- All action responses for operations must be recursively rate-free.
  perform pg_temp.po_private(pg_temp.po_call('supplier_options','{"itemKey":"PO-A"}','operations'));
  perform pg_temp.po_private(pg_temp.po_call('list_purchase_orders','{}','operations'));
  foreach role_name in array array['administrator','management'] loop
    r:=pg_temp.po_call('list_purchase_orders','{}',role_name);
    perform pg_temp.po_assert(jsonb_path_exists(r,'$.**.rate') and jsonb_path_exists(r,'$.**.total'),'Privileged list missing prices');
    r:=pg_temp.po_call('supplier_options','{"itemKey":"PO-A"}',role_name);
    perform pg_temp.po_assert(jsonb_path_exists(r,'$.**.rate'),'Privileged suppliers missing prices');
  end loop;
  foreach role_name in array array['warehouse','sales','viewer','accounts','billing'] loop
    foreach t in array array['supplier_options','create_purchase_orders','list_purchase_orders','mark_purchase_order_shared','receive_purchase_order','cancel_purchase_order'] loop
      perform pg_temp.po_error(t,'{}','42501',role_name);
    end loop;
  end loop;
  p:=jsonb_build_object('idempotencyKey',gen_random_uuid(),'lines',jsonb_build_array(jsonb_build_object('itemKey','PO-C','quantity',1)));
  r:=pg_temp.po_call('create_purchase_orders',p,'operations'); perform pg_temp.po_private(r);
  c:=(r->'purchaseOrders'->0->>'id')::uuid;
  perform pg_temp.po_assert(split_part(r->'purchaseOrders'->0->>'poNumber','/',3)::integer=number2+1,'Sequential create reused/skipped number');
  p:=jsonb_build_object('id',c,'expectedVersion',1,'idempotencyKey',gen_random_uuid());
  r:=pg_temp.po_call('mark_purchase_order_shared',p,'operations'); perform pg_temp.po_private(r);
  perform pg_temp.po_assert(r->>'sharedAt' is not null and (r->>'version')::integer=2,'Share failed');
  perform pg_temp.po_assert(pg_temp.po_call('mark_purchase_order_shared',p,'operations')=r,'Share replay changed result');
  r:=pg_temp.po_call('mark_purchase_order_shared',p||jsonb_build_object('expectedVersion',2,'idempotencyKey',gen_random_uuid()),'operations');
  perform pg_temp.po_assert((r->>'version')::integer=2,'Repeated sharing bumped version');
  perform pg_temp.po_error('cancel_purchase_order',jsonb_build_object('id',c,'expectedVersion',2,'idempotencyKey',gen_random_uuid()),'22023');
  r:=pg_temp.po_call('cancel_purchase_order',jsonb_build_object('id',c,'expectedVersion',2,'reason','Duplicate order','idempotencyKey',gen_random_uuid()),'operations');
  perform pg_temp.po_private(r); perform pg_temp.po_assert(r->>'status'='cancelled','Cancel failed');
  -- Receive is an absolute quantity, permits partial lines, and locks/version-checks the PO.
  p:=jsonb_build_object('id',a,'expectedVersion',1,'idempotencyKey',gen_random_uuid(),'lines',jsonb_build_array(jsonb_build_object('itemKey','PO-A','receivedQuantity',2)));
  r:=pg_temp.po_call('receive_purchase_order',p,'operations'); perform pg_temp.po_private(r);
  perform pg_temp.po_assert(r->>'status'='open' and (r->>'version')::integer=2,'Partial receive closed PO');
  select value into x from jsonb_array_elements(pg_temp.po_requirements()->'items') where value->>'itemKey'='PO-A';
  perform pg_temp.po_assert((x->>'openPoQty')::numeric=4,'Partial receive did not reduce open quantity');
  perform pg_temp.po_error('receive_purchase_order',p||jsonb_build_object('idempotencyKey',gen_random_uuid()),'PT409');
  perform pg_temp.po_error('receive_purchase_order',p||jsonb_build_object('idempotencyKey',gen_random_uuid(),'expectedVersion',2,'lines',jsonb_build_array(jsonb_build_object('itemKey','PO-A','receivedQuantity',7))),'22023');
  r:=pg_temp.po_call('receive_purchase_order',p||jsonb_build_object('idempotencyKey',gen_random_uuid(),'expectedVersion',2,'lines',jsonb_build_array(
    jsonb_build_object('itemKey','PO-A','receivedQuantity',6),jsonb_build_object('itemKey','PO-C','receivedQuantity',3))),'operations');
  perform pg_temp.po_private(r); perform pg_temp.po_assert(r->>'status'='received','Full receive did not close PO');
  perform pg_temp.po_error('cancel_purchase_order',jsonb_build_object('id',a,'expectedVersion',3,'idempotencyKey',gen_random_uuid(),'reason','Duplicate order'),'22023');
  perform pg_temp.po_error('create_purchase_orders',jsonb_build_object('idempotencyKey',gen_random_uuid(),'lines',jsonb_build_array(jsonb_build_object('itemKey','PO-A','quantity',1,'supplierName','Unlisted'))),'22023');
  begin
    perform pg_temp.po_call('create_purchase_orders',jsonb_build_object('idempotencyKey',gen_random_uuid(),'lines',jsonb_build_array(jsonb_build_object('itemKey','PO-NONE','quantity',1))));
  exception when others then get stacked diagnostics actual=returned_sqlstate,message=message_text; end;
  perform pg_temp.po_assert(actual='22023' and message='No supplier price for PO-NONE; choose a supplier','Missing price error lacks item');
  -- Listed supplier with only incompatible unit evidence is a manual choice with no base-unit rate.
  r:=pg_temp.po_call('create_purchase_orders',jsonb_build_object('idempotencyKey',gen_random_uuid(),'lines',jsonb_build_array(jsonb_build_object('itemKey','PO-A','quantity',1,'supplierName','Wrong'))));
  perform pg_temp.po_assert(r->'purchaseOrders'->0->'lines'->0->'rate'='null'::jsonb,'Wrong-unit rate used on a base-unit PO');
  foreach t in array array['stockflow_supplier_prices','stockflow_purchase_orders','stockflow_purchase_order_lines','stockflow_po_sequences','stockflow_purchase_order_events'] loop
    perform pg_temp.po_assert(not has_table_privilege('anon','private.'||t,'select,insert,update,delete')
      and not has_table_privilege('authenticated','private.'||t,'select,insert,update,delete')
      and (select relrowsecurity from pg_class where oid=('private.'||t)::regclass),'Private table exposed: '||t);
  end loop;
  sig:='public.stockflow_purchase_gateway(text,text,text,jsonb)';
  perform pg_temp.po_assert(not has_function_privilege('anon',sig,'execute') and not has_function_privilege('authenticated',sig,'execute')
    and has_function_privilege('service_role',sig,'execute'),'Gateway grants incorrect');
end $test$;
rollback;
