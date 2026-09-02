create table private.stockflow_products (
  id uuid primary key default gen_random_uuid(),
  tally_item_key text not null unique check (btrim(tally_item_key) <> ''),
  name text not null check (btrim(name) <> ''),
  item_group text not null default '',
  base_unit text not null default '',
  tracking_mode text not null default 'none' check (tracking_mode in ('none','batch','expiry')),
  active boolean not null default true,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.stockflow_warehouses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (btrim(code) <> ''),
  name text not null check (btrim(name) <> ''),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table private.stockflow_locations (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references private.stockflow_warehouses(id),
  code text not null check (btrim(code) <> ''),
  name text not null check (btrim(name) <> ''),
  location_type text not null default 'available' check (location_type in ('available','quarantine','damaged')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (warehouse_id, code),
  unique (id, warehouse_id)
);

create table private.stockflow_batches (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references private.stockflow_products(id),
  lot_number text not null check (btrim(lot_number) <> ''),
  manufactured_date date,
  expiry_date date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (manufactured_date is null or expiry_date is null or expiry_date > manufactured_date),
  unique (product_id, lot_number),
  unique (id, product_id)
);

create table private.stockflow_inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references private.stockflow_products(id),
  batch_id uuid not null,
  location_id uuid not null references private.stockflow_locations(id),
  order_id uuid references private.stockflow_orders(id),
  order_line_id uuid references private.stockflow_order_lines(id),
  movement_type text not null check (movement_type in (
    'goods_receipt','adjustment_in','adjustment_out','reservation','reservation_release',
    'dispatch','quarantine','quarantine_release','damage','expiry'
  )),
  on_hand_delta numeric(14,3) not null default 0,
  reserved_delta numeric(14,3) not null default 0,
  quarantine_delta numeric(14,3) not null default 0,
  damaged_delta numeric(14,3) not null default 0,
  source_document text,
  reason text,
  actor_email text not null check (btrim(actor_email) <> ''),
  actor_role text not null,
  request_id text not null check (char_length(request_id) >= 16),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (batch_id, product_id) references private.stockflow_batches(id, product_id),
  check (on_hand_delta <> 0 or reserved_delta <> 0 or quarantine_delta <> 0 or damaged_delta <> 0),
  unique (actor_email, request_id, movement_type, batch_id, location_id)
);

create index stockflow_inventory_movements_balance_idx
on private.stockflow_inventory_movements(product_id, batch_id, location_id, created_at);
create index stockflow_batches_expiry_idx
on private.stockflow_batches(expiry_date) where active and expiry_date is not null;

alter table private.stockflow_products enable row level security;
alter table private.stockflow_warehouses enable row level security;
alter table private.stockflow_locations enable row level security;
alter table private.stockflow_batches enable row level security;
alter table private.stockflow_inventory_movements enable row level security;

create trigger stockflow_products_no_delete before delete on private.stockflow_products
for each row execute function private.prevent_business_delete();
create trigger stockflow_warehouses_no_delete before delete on private.stockflow_warehouses
for each row execute function private.prevent_business_delete();
create trigger stockflow_locations_no_delete before delete on private.stockflow_locations
for each row execute function private.prevent_business_delete();
create trigger stockflow_batches_no_delete before delete on private.stockflow_batches
for each row execute function private.prevent_business_delete();
create trigger stockflow_inventory_movements_immutable
before update or delete on private.stockflow_inventory_movements
for each row execute function private.prevent_order_event_mutation();

insert into private.stockflow_warehouses(code,name) values ('SUPRABHA','Suprabha Main Warehouse');
insert into private.stockflow_locations(warehouse_id,code,name,location_type)
select id,'MAIN','Main available stock','available' from private.stockflow_warehouses where code='SUPRABHA';

create or replace function private.stockflow_sync_inventory_products()
returns trigger
language plpgsql
set search_path = pg_catalog, private
as $$
begin
  insert into private.stockflow_products(tally_item_key,name,item_group,base_unit,active)
  select btrim(item->>'tallyKey'), btrim(item->>'item'), coalesce(item->>'group',''), coalesce(item->>'baseUnit',''), true
  from jsonb_array_elements(coalesce(new.payload->'catalog','[]'::jsonb)) item
  where nullif(btrim(item->>'tallyKey'),'') is not null and nullif(btrim(item->>'item'),'') is not null
  on conflict (tally_item_key) do update set
    name=excluded.name, item_group=excluded.item_group, base_unit=excluded.base_unit,
    active=true, version=private.stockflow_products.version+1, updated_at=now();

  update private.stockflow_products p set active=false, version=version+1, updated_at=now()
  where p.active
    and jsonb_array_length(coalesce(new.payload->'catalog','[]'::jsonb)) > 0
    and not exists (
    select 1 from jsonb_array_elements(coalesce(new.payload->'catalog','[]'::jsonb)) item
    where nullif(btrim(item->>'tallyKey'),'')=p.tally_item_key
  );
  return new;
end;
$$;

revoke all on function private.stockflow_sync_inventory_products() from public, anon, authenticated;
create trigger stockflow_sync_inventory_products
after insert or update of payload on public.stockflow_snapshots
for each row when (new.id='suprabha') execute function private.stockflow_sync_inventory_products();

insert into private.stockflow_products(tally_item_key,name,item_group,base_unit)
select btrim(item->>'tallyKey'), btrim(item->>'item'), coalesce(item->>'group',''), coalesce(item->>'baseUnit','')
from public.stockflow_snapshots s,
lateral jsonb_array_elements(coalesce(s.payload->'catalog','[]'::jsonb)) item
where s.id='suprabha' and nullif(btrim(item->>'tallyKey'),'') is not null and nullif(btrim(item->>'item'),'') is not null
on conflict (tally_item_key) do nothing;

create view private.stockflow_inventory_balances as
with totals as (
  select p.id product_id, p.tally_item_key, p.name product_name, p.item_group, p.base_unit,
    p.tracking_mode, b.id batch_id, b.lot_number, b.expiry_date,
    l.id location_id, l.code location_code, w.code warehouse_code,
    coalesce(sum(m.on_hand_delta),0)::numeric(14,3) on_hand,
    coalesce(sum(m.reserved_delta),0)::numeric(14,3) reserved,
    coalesce(sum(m.quarantine_delta),0)::numeric(14,3) quarantined,
    coalesce(sum(m.damaged_delta),0)::numeric(14,3) damaged
  from private.stockflow_inventory_movements m
  join private.stockflow_products p on p.id=m.product_id
  join private.stockflow_batches b on b.id=m.batch_id
  join private.stockflow_locations l on l.id=m.location_id
  join private.stockflow_warehouses w on w.id=l.warehouse_id
  group by p.id,p.tally_item_key,p.name,p.item_group,p.base_unit,p.tracking_mode,
    b.id,b.lot_number,b.expiry_date,l.id,l.code,w.code
)
select *, case
  when expiry_date is not null and expiry_date < current_date then 0
  else greatest(on_hand - reserved - quarantined - damaged,0)
end::numeric(14,3) available
from totals;

revoke all on private.stockflow_inventory_balances from public, anon, authenticated;

create view private.stockflow_inventory_reconciliation as
with tally as (
  select item->>'tallyKey' tally_item_key,
    coalesce(nullif(item->>'closing','')::numeric,0)::numeric(14,3) tally_on_hand,
    s.payload->>'fetchedAt' tally_fetched_at
  from public.stockflow_snapshots s,
  lateral jsonb_array_elements(coalesce(s.payload->'catalog','[]'::jsonb)) item
  where s.id='suprabha'
), ledger as (
  select tally_item_key,coalesce(sum(on_hand),0)::numeric(14,3) ledger_on_hand
  from private.stockflow_inventory_balances group by tally_item_key
)
select p.tally_item_key,p.name,p.base_unit,coalesce(t.tally_on_hand,0)::numeric(14,3) tally_on_hand,
  coalesce(l.ledger_on_hand,0)::numeric(14,3) ledger_on_hand,
  (coalesce(t.tally_on_hand,0)-coalesce(l.ledger_on_hand,0))::numeric(14,3) variance,
  t.tally_fetched_at
from private.stockflow_products p
left join tally t on t.tally_item_key=p.tally_item_key
left join ledger l on l.tally_item_key=p.tally_item_key
where p.active;

revoke all on private.stockflow_inventory_reconciliation from public, anon, authenticated;

alter table private.stockflow_role_permissions
drop constraint stockflow_role_permissions_permission_check;
alter table private.stockflow_role_permissions
add constraint stockflow_role_permissions_permission_check check (permission in (
  'orders.create','orders.transition','inventory.view','inventory.receive','inventory.adjust'
));
insert into private.stockflow_role_permissions(role,permission) values
  ('administrator','inventory.view'),('administrator','inventory.receive'),('administrator','inventory.adjust'),
  ('operations','inventory.view'),('operations','inventory.receive'),
  ('warehouse','inventory.view'),('warehouse','inventory.receive'),('warehouse','inventory.adjust'),
  ('management','inventory.view')
on conflict do nothing;

create or replace function public.stockflow_inventory_gateway(
  p_gateway_key text, p_actor_email text, p_action text, p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_email text := lower(btrim(coalesce(p_actor_email,'')));
  v_role text; v_hash text; v_permission text;
  v_idempotency_key text; v_replayed jsonb; v_result jsonb;
  v_product private.stockflow_products%rowtype;
  v_batch private.stockflow_batches%rowtype;
  v_location private.stockflow_locations%rowtype;
  v_quantity numeric(14,3); v_before numeric(14,3); v_after numeric(14,3);
  v_lot text; v_expiry date; v_reason text; v_movement text;
begin
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_hash then
    raise exception 'Unauthorized gateway' using errcode='42501';
  end if;
  select role into v_role from public.stockflow_members where email=v_email and status='active';
  if v_role is null then raise exception 'Active membership required' using errcode='42501'; end if;
  if p_action not in ('bootstrap_inventory','receive_stock','adjust_stock') then
    raise exception 'Unsupported inventory action' using errcode='22023';
  end if;

  v_permission := case p_action when 'bootstrap_inventory' then 'inventory.view' when 'receive_stock' then 'inventory.receive' else 'inventory.adjust' end;
  perform private.assert_stockflow_permission(v_role,v_permission);

  if p_action='bootstrap_inventory' then
    return jsonb_build_object(
      'products',coalesce((select jsonb_agg(jsonb_build_object(
        'tallyKey',p.tally_item_key,'name',p.name,'group',p.item_group,'baseUnit',p.base_unit,
        'trackingMode',p.tracking_mode,'active',p.active
      ) order by p.name) from private.stockflow_products p where p.active),'[]'::jsonb),
      'balances',coalesce((select jsonb_agg(jsonb_build_object(
        'tallyKey',b.tally_item_key,'name',b.product_name,'batchNumber',b.lot_number,
        'expiryDate',b.expiry_date,'locationCode',b.location_code,'onHand',b.on_hand,
        'reserved',b.reserved,'available',b.available
      ) order by b.product_name,b.expiry_date nulls last,b.lot_number) from private.stockflow_inventory_balances b),'[]'::jsonb),
      'reconciliation',coalesce((select jsonb_agg(jsonb_build_object(
        'tallyKey',r.tally_item_key,'name',r.name,'baseUnit',r.base_unit,
        'tallyOnHand',r.tally_on_hand,'ledgerOnHand',r.ledger_on_hand,
        'variance',r.variance,'tallyFetchedAt',r.tally_fetched_at
      ) order by abs(r.variance) desc,r.name) from private.stockflow_inventory_reconciliation r),'[]'::jsonb)
    );
  end if;

  v_idempotency_key := p_payload->>'idempotencyKey';
  v_replayed := private.begin_stockflow_command(v_email,p_action,v_idempotency_key,p_payload);
  if v_replayed is not null then return v_replayed; end if;
  select * into v_product from private.stockflow_products where tally_item_key=btrim(p_payload->>'tallyKey') and active;
  if not found then raise exception 'Product is not in the active Tally catalog' using errcode='22023'; end if;
  v_lot := nullif(btrim(coalesce(p_payload->>'batchNumber','')),'');
  if v_lot is null then raise exception 'Batch number is required' using errcode='22023'; end if;
  select l.* into v_location from private.stockflow_locations l
  join private.stockflow_warehouses w on w.id=l.warehouse_id
  where l.code=coalesce(nullif(btrim(p_payload->>'locationCode'),''),'MAIN') and w.code='SUPRABHA' and l.active;
  if not found then raise exception 'Inventory location was not found' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_product.id::text||':'||v_lot||':'||v_location.id::text,0));

  if p_action='receive_stock' then
    v_quantity := nullif(p_payload->>'quantity','')::numeric;
    v_expiry := nullif(p_payload->>'expiryDate','')::date;
    if v_quantity is null or v_quantity<=0 then raise exception 'Receipt quantity must be positive' using errcode='22023'; end if;
    if v_product.tracking_mode='expiry' and v_expiry is null then raise exception 'Expiry date is required for this product' using errcode='22023'; end if;
    insert into private.stockflow_batches(product_id,lot_number,expiry_date)
    values(v_product.id,v_lot,v_expiry) on conflict(product_id,lot_number) do nothing;
    select * into v_batch from private.stockflow_batches where product_id=v_product.id and lot_number=v_lot;
    if v_batch.expiry_date is distinct from v_expiry then
      raise exception 'Batch already exists with a different expiry date' using errcode='22023';
    end if;
    select coalesce(on_hand,0) into v_before from private.stockflow_inventory_balances
    where batch_id=v_batch.id and location_id=v_location.id;
    v_before := coalesce(v_before,0); v_after := v_before+v_quantity;
    insert into private.stockflow_inventory_movements(
      product_id,batch_id,location_id,movement_type,on_hand_delta,source_document,
      actor_email,actor_role,request_id,metadata
    ) values(v_product.id,v_batch.id,v_location.id,'goods_receipt',v_quantity,
      nullif(btrim(coalesce(p_payload->>'sourceDocument','')),''),v_email,v_role,v_idempotency_key,
      jsonb_build_object('before',v_before,'after',v_after));
  else
    select * into v_batch from private.stockflow_batches where product_id=v_product.id and lot_number=v_lot;
    if not found then raise exception 'Inventory batch was not found' using errcode='22023'; end if;
    v_quantity := nullif(p_payload->>'quantityDelta','')::numeric;
    v_reason := nullif(btrim(coalesce(p_payload->>'reason','')),'');
    if v_quantity is null or v_quantity=0 then raise exception 'Adjustment quantity cannot be zero' using errcode='22023'; end if;
    if v_reason is null then raise exception 'Adjustment reason is required' using errcode='22023'; end if;
    select coalesce(on_hand,0) into v_before from private.stockflow_inventory_balances
    where batch_id=v_batch.id and location_id=v_location.id;
    v_before:=coalesce(v_before,0); v_after:=v_before+v_quantity;
    if v_after<0 then raise exception 'Inventory adjustment would make physical stock negative' using errcode='22023'; end if;
    v_movement:=case when v_quantity>0 then 'adjustment_in' else 'adjustment_out' end;
    insert into private.stockflow_inventory_movements(
      product_id,batch_id,location_id,movement_type,on_hand_delta,reason,
      actor_email,actor_role,request_id,metadata
    ) values(v_product.id,v_batch.id,v_location.id,v_movement,v_quantity,v_reason,
      v_email,v_role,v_idempotency_key,jsonb_build_object('before',v_before,'after',v_after));
  end if;

  v_result:=jsonb_build_object('ok',true,'tallyKey',v_product.tally_item_key,'batchNumber',v_lot,
    'locationCode',v_location.code,'before',v_before,'after',v_after,'requestId',v_idempotency_key);
  perform private.finish_stockflow_command(v_email,p_action,v_idempotency_key,p_payload,v_batch.id,v_result);
  return v_result;
end;
$$;

revoke all on function public.stockflow_inventory_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_inventory_gateway(text,text,text,jsonb) to service_role;
