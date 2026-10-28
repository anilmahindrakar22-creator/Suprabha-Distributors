begin;

-- Current state only. Immutable purchase-cost evidence remains untouched.
create table private.stockflow_supplier_prices (
  tally_item_key text not null check (char_length(btrim(tally_item_key)) between 1 and 240),
  supplier_name text not null check (char_length(btrim(supplier_name)) between 1 and 220),
  rate numeric(14,4) not null check (rate > 0 and rate <> 'NaN'::numeric),
  unit text check (unit is null or char_length(btrim(unit)) between 1 and 40),
  effective_at date not null check (isfinite(effective_at)),
  source_reference text not null check (char_length(btrim(source_reference)) between 1 and 160),
  source_id text not null check (char_length(btrim(source_id)) between 1 and 240),
  imported_at timestamptz not null default now()
);
create unique index stockflow_supplier_prices_key on private.stockflow_supplier_prices
  (tally_item_key,supplier_name,coalesce(unit,''));

-- Extend the existing snapshot trigger before it removes private pricingHistory.
do $patch$
declare f text := replace(pg_get_functiondef('private.stockflow_import_tally_pricing_evidence()'::regprocedure),chr(13),'');
  anchor text := $a$new.payload:=new.payload-'pricingHistory';$a$;
  replacement text := $a$
  if new.payload->'pricingHistory' ? 'supplierPrices' then
    if jsonb_typeof(new.payload->'pricingHistory'->'supplierPrices') is distinct from 'array' then
      raise exception 'supplierPrices must be an array' using errcode='22023';
    end if;
    if jsonb_array_length(new.payload->'pricingHistory'->'supplierPrices')>5000 then
      raise exception 'Supplier prices exceed safe import limit' using errcode='22023';
    end if;
    -- Serialize full replacement, including an empty set, with PO rate snapshots.
    perform pg_advisory_xact_lock(hashtextextended('stockflow_supplier_prices',0));
    delete from private.stockflow_supplier_prices;
    for entry in select value from jsonb_array_elements(new.payload->'pricingHistory'->'supplierPrices') loop
      if jsonb_typeof(entry) is distinct from 'object'
        or jsonb_typeof(entry->'tallyItemKey') is distinct from 'string'
        or jsonb_typeof(entry->'supplierName') is distinct from 'string'
        or jsonb_typeof(entry->'rate') is distinct from 'number'
        or jsonb_typeof(entry->'effectiveAt') is distinct from 'string'
        or coalesce(entry->>'effectiveAt','') !~ '^\d{4}-\d{2}-\d{2}$'
        or jsonb_typeof(entry->'sourceReference') is distinct from 'string'
        or jsonb_typeof(entry->'sourceId') is distinct from 'string'
        or (entry ? 'unit' and jsonb_typeof(entry->'unit') not in ('string','null'))
        or (entry ? 'voucherType' and entry->>'voucherType' is distinct from 'Purchase') then
        raise exception 'Invalid supplier purchase evidence' using errcode='22023';
      end if;
      begin
        insert into private.stockflow_supplier_prices(tally_item_key,supplier_name,rate,unit,effective_at,source_reference,source_id)
        values(btrim(entry->>'tallyItemKey'),btrim(entry->>'supplierName'),(entry->>'rate')::numeric,
          nullif(btrim(entry->>'unit'),''),(entry->>'effectiveAt')::date,btrim(entry->>'sourceReference'),btrim(entry->>'sourceId'));
      exception when data_exception or check_violation or not_null_violation or unique_violation then
        raise exception 'Invalid supplier purchase evidence' using errcode='22023';
      end;
    end loop;
  end if;
  new.payload:=new.payload-'pricingHistory';$a$;
begin
  if (length(f)-length(replace(f,anchor,'')))/length(anchor)<>1 then raise exception 'Supplier import anchor changed'; end if;
  execute replace(f,anchor,replacement);
end $patch$;

-- rate_check_units.sql: null legacy units are not mismatches; known units compare lower(btrim()).
create function private.stockflow_supplier_options(p_item text)
returns table(supplier_name text,rate numeric,unit text,effective_at date)
language sql stable set search_path=pg_catalog,private as $$
  select distinct on (s.supplier_name) s.supplier_name,s.rate,s.unit,s.effective_at
  from private.stockflow_supplier_prices s join private.stockflow_products p on p.tally_item_key=s.tally_item_key
  where s.tally_item_key=p_item
    and s.effective_at between (now() at time zone 'Asia/Kolkata')::date-365 and (now() at time zone 'Asia/Kolkata')::date
    and (s.unit is null or lower(btrim(s.unit)) is not distinct from lower(btrim(p.base_unit)))
  order by s.supplier_name,s.effective_at desc,s.source_reference desc,s.unit nulls last
$$;
create function private.stockflow_lowest_supplier(p_item text)
returns table(supplier_name text,rate numeric,unit text,effective_at date)
language sql stable set search_path=pg_catalog,private as $$
  select * from private.stockflow_supplier_options(p_item) order by rate,effective_at desc,supplier_name limit 1
$$;

create table private.stockflow_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number text not null unique,
  supplier_name text not null check (char_length(btrim(supplier_name)) between 1 and 220),
  status text not null default 'open' check (status in ('open','received','cancelled')),
  shared_at timestamptz,
  version integer not null default 1 check (version>0),
  created_by_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_reason text check (cancelled_reason is null or char_length(btrim(cancelled_reason)) between 3 and 300)
);
create table private.stockflow_purchase_order_lines (
  po_id uuid not null references private.stockflow_purchase_orders(id),
  tally_item_key text not null,
  item_name text not null,
  quantity numeric not null check (quantity>0 and quantity<=1000000),
  unit text,
  rate numeric(14,4) check (rate is null or (rate>0 and rate<>'NaN'::numeric)),
  received_quantity numeric not null default 0 check (received_quantity>=0 and received_quantity<=quantity),
  primary key(po_id,tally_item_key)
);
create index stockflow_po_lines_item on private.stockflow_purchase_order_lines(tally_item_key,po_id);
create table private.stockflow_po_sequences (
  financial_year text primary key,
  last_number integer not null check(last_number>0)
);
create table private.stockflow_purchase_order_events (
  po_id uuid not null references private.stockflow_purchase_orders(id),
  event_type text not null check(event_type in ('created','mark_purchase_order_shared','receive_purchase_order','cancel_purchase_order')),
  actor_email text not null,
  metadata jsonb not null default '{}',
  recorded_at timestamptz not null default now()
);
alter table private.stockflow_supplier_prices enable row level security;
alter table private.stockflow_purchase_orders enable row level security;
alter table private.stockflow_purchase_order_lines enable row level security;
alter table private.stockflow_po_sequences enable row level security;
alter table private.stockflow_purchase_order_events enable row level security;
revoke all on private.stockflow_supplier_prices,private.stockflow_purchase_orders,private.stockflow_purchase_order_lines,
  private.stockflow_po_sequences,private.stockflow_purchase_order_events from public,anon,authenticated;

create function private.stockflow_purchase_order_json(p_id uuid,p_show_rates boolean)
returns jsonb language sql stable set search_path=pg_catalog,private as $$
  select jsonb_build_object('id',o.id,'poNumber',o.po_number,'supplierName',o.supplier_name,'status',o.status,
    'sharedAt',o.shared_at,'version',o.version,'createdAt',o.created_at,'createdByEmail',o.created_by_email,
    'lines',(select jsonb_agg(jsonb_build_object('itemKey',l.tally_item_key,'itemName',l.item_name,
      'quantity',l.quantity,'unit',l.unit,'receivedQuantity',l.received_quantity)
      || case when p_show_rates then jsonb_build_object('rate',l.rate) else '{}'::jsonb end order by l.tally_item_key)
      from private.stockflow_purchase_order_lines l where l.po_id=o.id))
    || case when p_show_rates then jsonb_build_object('total',
      (select case when count(rate)=count(*) then sum(quantity*rate) end from private.stockflow_purchase_order_lines where po_id=o.id))
      else '{}'::jsonb end
  from private.stockflow_purchase_orders o where o.id=p_id
$$;

-- Redact at the final boundary, including cached commands after a role downgrade.
create function private.stockflow_purchase_redact(p_value jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog,private as $$
declare r jsonb;
begin
  if jsonb_typeof(p_value)='object' then
    select coalesce(jsonb_object_agg(key,private.stockflow_purchase_redact(value)),'{}') into r
      from jsonb_each(p_value) where key not in ('rate','total');
  elsif jsonb_typeof(p_value)='array' then
    select coalesce(jsonb_agg(private.stockflow_purchase_redact(value) order by ordinal),'[]') into r
      from jsonb_array_elements(p_value) with ordinality a(value,ordinal);
  else r:=p_value; end if;
  return r;
end $$;

create function public.stockflow_purchase_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=pg_catalog,private,extensions as $$
declare
  v_actor text:=lower(btrim(coalesce(p_actor_email,''))); v_hash text; v_roles text[]; v_show_rates boolean;
  v_result jsonb; v_key text:=p_payload->>'idempotencyKey'; v_id uuid; v_version integer;
  v_order private.stockflow_purchase_orders%rowtype; v_product private.stockflow_products%rowtype;
  v_entry jsonb; v_lines jsonb:='[]'; v_supplier text; v_rate numeric; v_qty numeric; v_group record;
  v_page integer; v_status text; v_total bigint; v_year integer; v_fy text; v_number integer;
  v_today date:=(now() at time zone 'Asia/Kolkata')::date;
begin
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_hash then
    raise exception 'Unauthorized gateway' using errcode='42501'; end if;
  select roles into v_roles from public.stockflow_members where email=v_actor and status='active';
  if not private.stockflow_valid_roles(v_roles) or not coalesce(v_roles && array['administrator','management','operations'],false) then
    raise exception 'Role cannot manage purchase orders' using errcode='42501'; end if;
  v_show_rates:=v_roles && array['administrator','management'];
  if p_action is null or p_action not in ('supplier_options','create_purchase_orders','list_purchase_orders','mark_purchase_order_shared','receive_purchase_order','cancel_purchase_order')
    or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid purchase action' using errcode='22023'; end if;
  -- Serialize the actor's admission counter to prevent concurrent rate-limit bypass.
  perform pg_advisory_xact_lock(hashtextextended('stockflow_purchase_actor:'||v_actor,0));
  if (select count(*) from private.stockflow_request_log where actor_email=v_actor and created_at>=now()-interval '1 minute')>=30 then
    raise exception 'Too many order requests' using errcode='54000'; end if;
  insert into private.stockflow_request_log(actor_email,action) values(v_actor,p_action);
  if p_action='supplier_options' then
    if jsonb_typeof(p_payload->'itemKey') is distinct from 'string' or char_length(btrim(p_payload->>'itemKey')) not between 1 and 220 then
      raise exception 'Valid item key required' using errcode='22023'; end if;
    select * into v_product from private.stockflow_products where tally_item_key=p_payload->>'itemKey';
    if not found then raise exception 'Catalog item required' using errcode='22023'; end if;
    select jsonb_build_object('itemKey',v_product.tally_item_key,'unit',v_product.base_unit,
      'suppliers',coalesce(jsonb_agg(jsonb_build_object('supplierName',s.supplier_name,'effectiveAt',s.effective_at,
        'lowest',s.supplier_name=(select supplier_name from private.stockflow_lowest_supplier(v_product.tally_item_key)))
        || case when v_show_rates then jsonb_build_object('rate',s.rate) else '{}'::jsonb end
        order by s.rate,s.effective_at desc,s.supplier_name),'[]')) into v_result
      from private.stockflow_supplier_options(v_product.tally_item_key) s;
    return v_result;
  elsif p_action='list_purchase_orders' then
    v_page:=coalesce((p_payload->>'page')::integer,1); v_status:=coalesce(p_payload->>'status','all');
    if v_page not between 1 and 4000 or v_status not in ('open','received','cancelled','all') then raise exception 'Invalid purchase list' using errcode='22023'; end if;
    select count(*) into v_total from private.stockflow_purchase_orders where v_status='all' or status=v_status;
    select jsonb_build_object('page',v_page,'pageSize',20,'total',v_total,'items',coalesce(jsonb_agg(
      private.stockflow_purchase_order_json(q.id,v_show_rates) order by (q.status='open') desc,q.created_at desc,q.po_number desc),'[]')) into v_result
      from (select * from private.stockflow_purchase_orders where v_status='all' or status=v_status
        order by (status='open') desc,created_at desc,po_number desc limit 20 offset (v_page-1)*20) q;
    -- Pagination total is an operational count; the contract prohibits the key for operations too.
    if not v_show_rates then return private.stockflow_purchase_redact(v_result); end if;
    return v_result;
  end if;
  if coalesce(v_key,'') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Valid idempotency key required' using errcode='22023'; end if;
  v_result:=private.begin_stockflow_command(v_actor,p_action,v_key,p_payload);
  if v_result is not null then
    return case when v_show_rates then v_result else private.stockflow_purchase_redact(v_result) end;
  end if;
  if p_action in ('create_purchase_orders','receive_purchase_order') then
    if jsonb_typeof(p_payload->'lines') is distinct from 'array' then raise exception 'Lines required' using errcode='22023'; end if;
    if jsonb_array_length(p_payload->'lines') not between 1 and 100
      or (select count(distinct value->>'itemKey') from jsonb_array_elements(p_payload->'lines'))<>jsonb_array_length(p_payload->'lines') then
      raise exception 'Provide 1 to 100 distinct lines' using errcode='22023'; end if;
    for v_entry in select value from jsonb_array_elements(p_payload->'lines') loop
      if jsonb_typeof(v_entry) is distinct from 'object' or jsonb_typeof(v_entry->'itemKey') is distinct from 'string'
        or char_length(btrim(v_entry->>'itemKey')) not between 1 and 220 then raise exception 'Invalid item key' using errcode='22023'; end if;
    end loop;
  end if;
  if p_action='create_purchase_orders' then
    perform pg_advisory_xact_lock(hashtextextended('stockflow_supplier_prices',0));
    for v_entry in select value from jsonb_array_elements(p_payload->'lines') loop
      if jsonb_typeof(v_entry->'quantity') is distinct from 'number' then raise exception 'Quantity required' using errcode='22023'; end if;
      v_qty:=(v_entry->>'quantity')::numeric;
      if v_qty<=0 or v_qty>1000000 then raise exception 'Invalid quantity' using errcode='22023'; end if;
      select * into v_product from private.stockflow_products where tally_item_key=v_entry->>'itemKey';
      if not found then raise exception 'Catalog item required' using errcode='22023'; end if;
      v_supplier:=null; v_rate:=null;
      if v_entry ? 'supplierName' then
        if jsonb_typeof(v_entry->'supplierName') is distinct from 'string' or char_length(btrim(v_entry->>'supplierName')) not between 1 and 220 then
          raise exception 'Invalid supplier' using errcode='22023'; end if;
        v_supplier:=btrim(v_entry->>'supplierName');
        if not exists(select 1 from private.stockflow_supplier_prices where tally_item_key=v_product.tally_item_key and supplier_name=v_supplier) then
          raise exception 'Supplier is not listed for %',v_product.name using errcode='22023'; end if;
        select rate into v_rate from private.stockflow_supplier_options(v_product.tally_item_key) where supplier_name=v_supplier;
      else
        select supplier_name,rate into v_supplier,v_rate from private.stockflow_lowest_supplier(v_product.tally_item_key);
        if v_supplier is null then raise exception 'No supplier price for %; choose a supplier',v_product.name using errcode='22023'; end if;
      end if;
      v_lines:=v_lines||jsonb_build_array(jsonb_build_object('itemKey',v_product.tally_item_key,'itemName',v_product.name,
        'quantity',v_qty,'unit',v_product.base_unit,'supplierName',v_supplier,'rate',v_rate));
    end loop;
    v_year:=extract(year from v_today)::integer-case when extract(month from v_today)<4 then 1 else 0 end;
    v_fy:=lpad((v_year%100)::text,2,'0')||'-'||lpad(((v_year+1)%100)::text,2,'0');
    v_result:=jsonb_build_object('purchaseOrders','[]'::jsonb);
    for v_group in select value->>'supplierName' as supplier from jsonb_array_elements(v_lines) group by 1 order by 1 loop
      insert into private.stockflow_po_sequences(financial_year,last_number) values(v_fy,1)
        on conflict(financial_year) do update set last_number=private.stockflow_po_sequences.last_number+1 returning last_number into v_number;
      insert into private.stockflow_purchase_orders(po_number,supplier_name,created_by_email)
        values('PO/'||v_fy||'/'||lpad(v_number::text,greatest(4,length(v_number::text)),'0'),v_group.supplier,v_actor) returning id into v_id;
      insert into private.stockflow_purchase_order_lines(po_id,tally_item_key,item_name,quantity,unit,rate)
        select v_id,value->>'itemKey',value->>'itemName',(value->>'quantity')::numeric,value->>'unit',(value->>'rate')::numeric
        from jsonb_array_elements(v_lines) where value->>'supplierName'=v_group.supplier;
      insert into private.stockflow_purchase_order_events(po_id,event_type,actor_email,metadata)
        values(v_id,'created',v_actor,jsonb_build_object('requestId',v_key));
      v_result:=jsonb_set(v_result,'{purchaseOrders}',v_result->'purchaseOrders'||jsonb_build_array(private.stockflow_purchase_order_json(v_id,true)));
    end loop;
  else
    v_id:=(p_payload->>'id')::uuid;
    if jsonb_typeof(p_payload->'expectedVersion') is distinct from 'number' or (p_payload->>'expectedVersion') !~ '^[1-9][0-9]*$' or v_id is null then
      raise exception 'Valid ID and expected version required' using errcode='22023'; end if;
    v_version:=(p_payload->>'expectedVersion')::integer;
    select * into v_order from private.stockflow_purchase_orders where id=v_id for update;
    if not found then raise exception 'Purchase order not found' using errcode='22023'; end if;
    if v_order.version<>v_version then raise exception 'Purchase order has changed' using errcode='PT409'; end if;
    if p_action='mark_purchase_order_shared' then
      if v_order.shared_at is null then
        update private.stockflow_purchase_orders set shared_at=now(),version=version+1,updated_at=now() where id=v_id;
      end if;
    else
      if v_order.status<>'open' then raise exception 'Open purchase order required' using errcode='22023'; end if;
      if p_action='cancel_purchase_order' then
        if jsonb_typeof(p_payload->'reason') is distinct from 'string' or char_length(btrim(p_payload->>'reason')) not between 3 and 300 then
          raise exception 'Cancellation reason must contain 3 to 300 characters' using errcode='22023'; end if;
        update private.stockflow_purchase_orders set status='cancelled',cancelled_reason=btrim(p_payload->>'reason'),version=version+1,updated_at=now() where id=v_id;
      else
        for v_entry in select value from jsonb_array_elements(p_payload->'lines') loop
          if jsonb_typeof(v_entry->'receivedQuantity') is distinct from 'number' then raise exception 'Received quantity required' using errcode='22023'; end if;
          v_qty:=(v_entry->>'receivedQuantity')::numeric;
          if v_qty<0 or not exists(select 1 from private.stockflow_purchase_order_lines where po_id=v_id and tally_item_key=v_entry->>'itemKey' and quantity>=v_qty) then
            raise exception 'Invalid received quantity or item' using errcode='22023'; end if;
          update private.stockflow_purchase_order_lines set received_quantity=v_qty where po_id=v_id and tally_item_key=v_entry->>'itemKey';
        end loop;
        update private.stockflow_purchase_orders set status=case when exists(select 1 from private.stockflow_purchase_order_lines where po_id=v_id and received_quantity<quantity) then 'open' else 'received' end,
          version=version+1,updated_at=now() where id=v_id;
      end if;
    end if;
    insert into private.stockflow_purchase_order_events(po_id,event_type,actor_email,metadata)
      values(v_id,p_action,v_actor,p_payload-'idempotencyKey');
    v_result:=private.stockflow_purchase_order_json(v_id,true);
  end if;
  perform private.finish_stockflow_command(v_actor,p_action,v_key,p_payload,v_id,v_result);
  return case when v_show_rates then v_result else private.stockflow_purchase_redact(v_result) end;
exception when invalid_text_representation or numeric_value_out_of_range or check_violation or not_null_violation then
  raise exception 'Invalid purchase order data' using errcode='22023';
end $$;

-- Patch the original reader once per anchor; preserve filtering, rounding and pagination.
do $patch$
declare f text:=replace(pg_get_functiondef('private.stockflow_to_order(integer)'::regprocedure),chr(13),''); pair text[];
begin
  foreach pair slice 1 in array array[
    array[$a$d.oldest_order_at$a$,$a$d.oldest_order_at,
      coalesce((select sum(l.quantity-l.received_quantity) from private.stockflow_purchase_order_lines l
        join private.stockflow_purchase_orders o on o.id=l.po_id where o.status='open' and l.tally_item_key=k.item_key),0) as open_po_qty$a$],
    array[$a$-coalesce(purchase_order,0) as need$a$,$a$-coalesce(purchase_order,0)-open_po_qty as need$a$],
    array[$a$'openDemand',open_demand$a$,$a$'openPoQty',open_po_qty,'lowestSupplier',(select jsonb_build_object('supplierName',supplier_name) from private.stockflow_lowest_supplier(item_key)),
      'openDemand',open_demand$a$]
  ] loop
    if (length(f)-length(replace(f,pair[1],'')))/length(pair[1])<>1 then raise exception 'To order supplier anchor changed: %',pair[1]; end if;
    f:=replace(f,pair[1],pair[2]);
  end loop;
  execute f;
end $patch$;
revoke all on function private.stockflow_supplier_options(text),private.stockflow_lowest_supplier(text),
  private.stockflow_purchase_order_json(uuid,boolean),private.stockflow_purchase_redact(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.stockflow_purchase_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_purchase_gateway(text,text,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
