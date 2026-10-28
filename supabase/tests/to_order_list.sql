begin;
-- Inputs only. No fabricated orders, lines, decisions or fulfilment state.
-- Clock default gives real gateway orders distinct creation times; rollback restores it.
alter table private.stockflow_orders alter column created_at set default clock_timestamp();
update private.stockflow_gateway_config
  set secret_sha256=encode(extensions.digest('to-order-key','sha256'),'hex') where name='orders';
insert into public.stockflow_members(email,role,roles,status) values
  ('to-order@test.local','administrator',array['administrator'],'active');

create function pg_temp.to_order_create(p_customer uuid,p_item text,p_qty numeric,p_confirm boolean default true)
returns uuid language plpgsql as $$
declare result jsonb; o uuid;
begin
  -- Request-log isolation: all commands share now() in this rollback transaction.
  delete from private.stockflow_request_log where actor_email='to-order@test.local';
  result:=public.stockflow_order_gateway('to-order-key','to-order@test.local','create_order',
    jsonb_build_object('customerId',p_customer,'customerName','To order customer','source','phone',
      'idempotencyKey','to-order-create-'||p_item||'-'||p_confirm,
      'lines',jsonb_build_array(jsonb_build_object('tallyKey',p_item,'quantity',p_qty))));
  o:=(result->>'orderId')::uuid;
  if o is null or result->>'status' is distinct from 'awaiting_confirmation'
    or (select count(*) from private.stockflow_order_lines where order_id=o)<>1 then
    raise exception 'To order create failed: %',result;
  end if;
  if p_confirm then
    result:=public.stockflow_order_gateway('to-order-key','to-order@test.local','transition_order',
      jsonb_build_object('orderId',o,'expectedVersion',(select version from private.stockflow_orders where id=o),
        'toStatus','confirmed','idempotencyKey','to-order-confirm-'||o));
    if result->>'status' is distinct from 'confirmed'
      or (select status from private.stockflow_orders where id=o) is distinct from 'confirmed' then
      raise exception 'To order confirmation failed: %',result;
    end if;
  end if;
  return o;
end $$;

do $test$
declare customer uuid; advisor uuid; demand uuid; r jsonb; legacy jsonb; expected jsonb;
  a jsonb; catalog jsonb; baseline_catalog jsonb; rows jsonb; extra jsonb; item text; role_name text; signature text;
begin
  -- The replay preserves a packed upgrade order. Cover pre-existing demand with
  -- catalog input rather than rewriting or archiving any saved order.
  select coalesce(jsonb_agg(jsonb_build_object('tallyKey',tally_item_key,'closing',remaining)), '[]'::jsonb)
    into baseline_catalog from (
      select tally_item_key,sum(greatest(quantity-fulfilled_quantity,0)) as remaining
      from private.stockflow_order_lines group by tally_item_key
    ) existing;
  insert into private.stockflow_customers(name,tally_key,created_by_email)
    values('To order customer','to-order-customer','test') returning id into customer;
  foreach item in array array['TO-ADVISOR','TO-DEMAND','TO-COVERED','TO-UNKNOWN'] loop
    insert into private.stockflow_products(tally_item_key,name,base_unit) values(item,item,'Nos');
  end loop;
  select jsonb_agg(jsonb_build_object('tallyKey',x,'item',x,'baseUnit','Nos',
    'group','To order tests','closing',0,'active',true)) into catalog
    from unnest(array['TO-ADVISOR','TO-DEMAND','TO-COVERED','TO-UNKNOWN']) x;
  insert into public.stockflow_snapshots(id,company,fetched_at,payload)
    values('suprabha','TO ORDER TEST',now()::text,jsonb_build_object('catalog',catalog,'rows','[]'::jsonb))
    on conflict(id) do update set payload=excluded.payload;
  advisor:=pg_temp.to_order_create(customer,'TO-ADVISOR',8);
  demand:=pg_temp.to_order_create(customer,'TO-DEMAND',5);
  perform pg_temp.to_order_create(customer,'TO-COVERED',5);
  perform pg_temp.to_order_create(customer,'TO-UNKNOWN',3);
  perform pg_temp.to_order_create(customer,'TO-ADVISOR',100,false);
  if (select created_at from private.stockflow_orders where id=advisor)
    >= (select created_at from private.stockflow_orders where id=demand) then
    raise exception 'Oldest-order fixture clocks tied';
  end if;
  -- Catalog disagrees with reorder closing deliberately: reorder evidence wins.
  catalog:='[{"tallyKey":"TO-ADVISOR","closing":99,"group":"Catalog group"},
    {"tallyKey":"TO-DEMAND","closing":2,"group":"Demand group"},
    {"tallyKey":"TO-COVERED","closing":0},{"tallyKey":"TO-UNKNOWN"}]';
  catalog:=catalog||baseline_catalog;
  rows:='[{"item":"TO-REORDER","group":"Reorder group","closing":4,"reorderLevel":15,"minimumOrder":30,"purchaseOrder":0,"salesOrder":0,"orderToBePlaced":30},
    {"item":"TO-ADVISOR","group":"Reorder group","closing":5,"reorderLevel":10,"minimumOrder":1,"purchaseOrder":0,"salesOrder":0,"orderToBePlaced":5},
    {"item":"TO-COVERED","closing":20,"reorderLevel":10,"minimumOrder":1,"purchaseOrder":0,"orderToBePlaced":0}]';
  update public.stockflow_snapshots set payload=jsonb_build_object('catalog',catalog,'rows',rows) where id='suprabha';
  r:=public.stockflow_requirements_gateway('to-order-key','to-order@test.local','get_requirements','{"view":"to_order","page":1}');
  if r->>'view' is distinct from 'to_order' or r->>'page' is distinct from '1'
    or r->>'pageSize' is distinct from '25' or r->>'total' is distinct from '3'
    or r->>'waitingCount' is distinct from '2' or r->>'unknownCount' is distinct from '1'
    or jsonb_array_length(r->'items')<>4 then raise exception 'Counts/contract: %',r; end if;
  if (select jsonb_agg(x->>'itemKey' order by n) from jsonb_array_elements(r->'items') with ordinality t(x,n))
    is distinct from '["TO-ADVISOR","TO-DEMAND","TO-REORDER","TO-UNKNOWN"]'::jsonb then
    raise exception 'Waiting/oldest/unknown ordering: %',r;
  end if;
  a:=r->'items'->0;
  if (a->>'suggestedQty')::numeric is distinct from 13::numeric
    or (a->>'openDemand')::numeric is distinct from 8::numeric or a->>'waitingOrders' is distinct from '1'
    or a->>'group' is distinct from 'Reorder group' or (a->>'closing')::numeric is distinct from 5::numeric
    or (a->>'oldestOrderAt')::timestamptz is distinct from (select created_at from private.stockflow_orders where id=advisor)
    or a->'reasons' is distinct from '["waiting_orders","below_reorder"]'::jsonb then
    raise exception 'Advisor: %',a;
  end if;
  a:=r->'items'->1;
  if (a->>'suggestedQty')::numeric is distinct from 3::numeric
    or a->'reasons' is distinct from '["waiting_orders"]'::jsonb
    or a->>'group' is distinct from 'Demand group' or a->'reorderLevel' is distinct from 'null'::jsonb
    or a->'minimumOrder' is distinct from 'null'::jsonb or a->'tallyOpenPurchase' is distinct from 'null'::jsonb then
    raise exception 'Demand-only: %',a;
  end if;
  a:=r->'items'->2;
  if (a->>'suggestedQty')::numeric is distinct from (rows->0->>'orderToBePlaced')::numeric
    or a->'reasons' is distinct from '["below_reorder"]'::jsonb
    or a->>'waitingOrders' is distinct from '0' or a->'oldestOrderAt' is distinct from 'null'::jsonb then
    raise exception 'Reorder-only: %',a;
  end if;
  a:=r->'items'->3;
  if a->>'state' is distinct from 'stock_unknown' or a->'suggestedQty' is distinct from 'null'::jsonb
    or a->'closing' is distinct from 'null'::jsonb or a->'reasons' is distinct from '[]'::jsonb then
    raise exception 'Unknown stock: %',a;
  end if;
  if exists(select 1 from jsonb_array_elements(r->'items') x where x->>'itemKey'='TO-COVERED') then
    raise exception 'Covered item listed';
  end if;
  -- Full equality is stronger than comparing legacy keys alone.
  expected:=public.stockflow_requirements_gateway_before_to_order('to-order-key','to-order@test.local','get_requirements','{"page":1}');
  legacy:=public.stockflow_requirements_gateway('to-order-key','to-order@test.local','get_requirements','{"page":1}');
  if legacy is distinct from expected then raise exception 'Missing view changed legacy response'; end if;
  legacy:=public.stockflow_requirements_gateway('to-order-key','to-order@test.local','get_requirements','{"page":1,"view":"other"}');
  if legacy is distinct from expected then raise exception 'Other view changed legacy response'; end if;
  -- 22 further reorder rows make 26 listed items (25 order + one unknown).
  -- Fractional need, purchase deduction and ignored Tally salesOrder are exercised together.
  select jsonb_agg(jsonb_build_object('item','TO-PAGE-'||lpad(n::text,2,'0'),
    'closing',0.2,'reorderLevel',10,'minimumOrder',1,'purchaseOrder',2,'salesOrder',100,'orderToBePlaced',8))
    into extra from generate_series(1,22) n;
  update public.stockflow_snapshots set payload=payload||jsonb_build_object('rows',rows||extra) where id='suprabha';
  r:=public.stockflow_requirements_gateway('to-order-key','to-order@test.local','get_requirements','{"view":"to_order","page":1}');
  if jsonb_array_length(r->'items')<>25 or r->>'total' is distinct from '25'
    or r->>'waitingCount' is distinct from '2' or r->>'unknownCount' is distinct from '1'
    or r->'items'->2->>'itemKey' is distinct from 'TO-REORDER'
    or r->'items'->3->>'itemKey' is distinct from 'TO-PAGE-01'
    or r->'items'->24->>'itemKey' is distinct from 'TO-PAGE-22'
    or exists(select 1 from jsonb_array_elements(r->'items') x
      where x->>'itemKey' like 'TO-PAGE-%' and (x->>'suggestedQty')::numeric is distinct from 8::numeric) then
    raise exception 'Pagination/ratio/name/ceil/purchase/salesOrder: %',r;
  end if;
  r:=public.stockflow_requirements_gateway('to-order-key','to-order@test.local','get_requirements','{"view":"to_order","page":2}');
  if jsonb_array_length(r->'items')<>1 or r->'items'->0->>'itemKey' is distinct from 'TO-UNKNOWN'
    or r->>'total' is distinct from '25' or r->>'waitingCount' is distinct from '2'
    or r->>'unknownCount' is distinct from '1' then raise exception 'Second page: %',r; end if;
  foreach role_name in array array['anon','authenticated'] loop
    foreach signature in array array['private.stockflow_to_order(integer)',
      'public.stockflow_requirements_gateway(text,text,text,jsonb)',
      'public.stockflow_requirements_gateway_before_to_order(text,text,text,jsonb)'] loop
      if has_function_privilege(role_name,signature,'EXECUTE') then raise exception 'Client execute: %, %',role_name,signature; end if;
    end loop;
  end loop;
  begin
    perform public.stockflow_requirements_gateway('wrong-key','to-order@test.local','get_requirements','{"view":"to_order"}');
    raise exception 'Wrong key allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.stockflow_requirements_gateway('to-order-key','nonmember@test.local','get_requirements','{"view":"to_order"}');
    raise exception 'Nonmember allowed';
  exception when insufficient_privilege then null; end;
  update public.stockflow_members set status='suspended' where email='to-order@test.local';
  begin
    perform public.stockflow_requirements_gateway('to-order-key','to-order@test.local','get_requirements','{"view":"to_order"}');
    raise exception 'Suspended member allowed';
  exception when insufficient_privilege then null; end;
end $test$;
rollback;
