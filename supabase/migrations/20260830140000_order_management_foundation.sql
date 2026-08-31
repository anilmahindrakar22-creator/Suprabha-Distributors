create schema if not exists private;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to postgres, service_role;

create table private.stockflow_gateway_config (
  name text primary key,
  secret_sha256 text not null check (length(secret_sha256) = 64),
  created_at timestamptz not null default now(),
  rotated_at timestamptz not null default now()
);

insert into private.stockflow_gateway_config (name, secret_sha256)
values ('orders', 'd3494b6bd372c2244ae419e9cd866d5349f17e56b4387d93aa61eb1a303e6e24')
on conflict (name) do update
set secret_sha256 = excluded.secret_sha256, rotated_at = now();

create table private.stockflow_customers (
  id uuid primary key default extensions.gen_random_uuid(),
  tally_key text unique,
  name text not null check (char_length(btrim(name)) between 2 and 160),
  phone text,
  city text,
  active boolean not null default true,
  created_by_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.stockflow_orders (
  id uuid primary key default extensions.gen_random_uuid(),
  order_seq bigint generated always as identity unique,
  order_number text unique,
  customer_id uuid references private.stockflow_customers(id),
  customer_name text not null check (char_length(btrim(customer_name)) between 2 and 160),
  customer_phone text,
  source text not null default 'phone' check (source in ('phone', 'email', 'whatsapp', 'walk_in')),
  status text not null default 'phone_order_received' check (status in (
    'draft', 'phone_order_received', 'awaiting_confirmation', 'awaiting_approval',
    'confirmed', 'partially_reserved', 'fully_reserved', 'ready_for_picking',
    'picked', 'packed', 'awaiting_tally_billing', 'billed_in_tally',
    'ready_for_dispatch', 'dispatched', 'delivered', 'cancelled'
  )),
  notes text check (notes is null or char_length(notes) <= 2000),
  tally_invoice_number text unique,
  version integer not null default 1 check (version > 0),
  idempotency_key text not null,
  created_by_email text not null,
  updated_by_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (created_by_email, idempotency_key)
);

create table private.stockflow_order_lines (
  id uuid primary key default extensions.gen_random_uuid(),
  order_id uuid not null references private.stockflow_orders(id) on delete restrict,
  tally_item_key text not null,
  item_name text not null,
  item_group text,
  base_unit text,
  quantity numeric(14,3) not null check (quantity > 0 and quantity <= 1000000),
  snapshot_closing numeric(14,3) not null default 0,
  reserved_quantity numeric(14,3) not null default 0
    check (reserved_quantity >= 0 and reserved_quantity <= quantity),
  created_at timestamptz not null default now(),
  unique (order_id, tally_item_key)
);

create table private.stockflow_reservations (
  id uuid primary key default extensions.gen_random_uuid(),
  order_line_id uuid not null unique references private.stockflow_order_lines(id) on delete restrict,
  order_id uuid not null references private.stockflow_orders(id) on delete restrict,
  tally_item_key text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  released_at timestamptz,
  released_reason text
);

create table private.stockflow_order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references private.stockflow_orders(id) on delete restrict,
  event_type text not null,
  from_status text,
  to_status text,
  reason text,
  actor_email text not null,
  actor_role text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table private.stockflow_outbox (
  id bigint generated always as identity primary key,
  topic text not null,
  aggregate_id uuid not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0)
);

create table private.stockflow_request_log (
  id bigint generated always as identity primary key,
  actor_email text not null,
  action text not null,
  created_at timestamptz not null default now()
);

create index stockflow_orders_status_created_idx on private.stockflow_orders (status, created_at desc);
create index stockflow_orders_customer_created_idx on private.stockflow_orders (customer_id, created_at desc);
create index stockflow_order_lines_order_idx on private.stockflow_order_lines (order_id);
create index stockflow_reservations_item_active_idx on private.stockflow_reservations (tally_item_key) where active;
create index stockflow_events_order_created_idx on private.stockflow_order_events (order_id, created_at);
create index stockflow_outbox_pending_idx on private.stockflow_outbox (created_at) where processed_at is null;
create index stockflow_request_log_actor_created_idx on private.stockflow_request_log (actor_email, created_at desc);

alter table private.stockflow_customers enable row level security;
alter table private.stockflow_orders enable row level security;
alter table private.stockflow_order_lines enable row level security;
alter table private.stockflow_reservations enable row level security;
alter table private.stockflow_order_events enable row level security;
alter table private.stockflow_outbox enable row level security;
alter table private.stockflow_request_log enable row level security;

create or replace function private.prevent_order_event_mutation()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  raise exception 'Order audit events are immutable' using errcode = '42501';
end;
$$;

create trigger stockflow_order_events_immutable
before update or delete on private.stockflow_order_events
for each row execute function private.prevent_order_event_mutation();

create or replace function public.stockflow_order_gateway(
  p_gateway_key text,
  p_actor_email text,
  p_action text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_actor_email text := lower(btrim(coalesce(p_actor_email, '')));
  v_role text;
  v_expected_hash text;
  v_order_id uuid;
  v_existing_id uuid;
  v_customer_id uuid;
  v_order_seq bigint;
  v_order_number text;
  v_order private.stockflow_orders%rowtype;
  v_line jsonb;
  v_catalog_item jsonb;
  v_snapshot jsonb;
  v_line_id uuid;
  v_requested numeric(14,3);
  v_physical numeric(14,3);
  v_other_reserved numeric(14,3);
  v_allocate numeric(14,3);
  v_total_lines integer;
  v_fully_reserved integer;
  v_from_status text;
  v_to_status text;
  v_reason text;
  v_expected_version integer;
  v_invoice text;
begin
  select secret_sha256 into v_expected_hash
  from private.stockflow_gateway_config where name = 'orders';

  if v_expected_hash is null
     or encode(extensions.digest(coalesce(p_gateway_key, ''), 'sha256'), 'hex') <> v_expected_hash then
    raise exception 'Unauthorized gateway' using errcode = '42501';
  end if;

  select role into v_role
  from public.stockflow_members
  where email = v_actor_email and status = 'active';
  if v_role is null then
    raise exception 'StockFlow membership is not active' using errcode = '42501';
  end if;

  if p_action not in ('bootstrap', 'create_order', 'transition_order', 'reserve_order') then
    raise exception 'Unsupported order action' using errcode = '22023';
  end if;

  if p_action <> 'bootstrap' then
    if (select count(*) from private.stockflow_request_log
        where actor_email = v_actor_email
          and created_at >= now() - interval '1 minute') >= 30 then
      raise exception 'Too many order requests' using errcode = '54000';
    end if;
    insert into private.stockflow_request_log(actor_email, action)
    values (v_actor_email, p_action);
  end if;

  if p_action = 'bootstrap' then
    select payload into v_snapshot from public.stockflow_snapshots where id = 'suprabha';
    return jsonb_build_object(
      'actor', jsonb_build_object('email', v_actor_email, 'role', v_role),
      'snapshot', jsonb_build_object(
        'company', coalesce(v_snapshot->>'company', ''),
        'fetchedAt', coalesce(v_snapshot->>'fetchedAt', ''),
        'catalog', coalesce(v_snapshot->'catalog', '[]'::jsonb)
      ),
      'customers', coalesce((
        select jsonb_agg(to_jsonb(c) order by c.name)
        from (
          select id, name, phone, city, tally_key as "tallyKey"
          from private.stockflow_customers where active order by name limit 200
        ) c
      ), '[]'::jsonb),
      'orders', coalesce((
        select jsonb_agg(to_jsonb(o) order by o."createdAt" desc)
        from (
          select x.id, x.order_number as "orderNumber",
            x.customer_name as "customerName", x.customer_phone as "customerPhone",
            x.status, x.source, x.notes, x.version,
            x.created_at as "createdAt", x.updated_at as "updatedAt",
            count(l.id)::integer as "lineCount",
            coalesce(sum(l.quantity), 0) as "totalQuantity",
            coalesce(sum(l.reserved_quantity), 0) as "reservedQuantity"
          from private.stockflow_orders x
          left join private.stockflow_order_lines l on l.order_id = x.id
          group by x.id order by x.created_at desc limit 100
        ) o
      ), '[]'::jsonb),
      'operations', jsonb_build_object(
        'phoneOrdersToday', (select count(*) from private.stockflow_orders where created_at >= date_trunc('day', now()) and source = 'phone'),
        'awaitingConfirmation', (select count(*) from private.stockflow_orders where status = 'awaiting_confirmation'),
        'awaitingApproval', (select count(*) from private.stockflow_orders where status = 'awaiting_approval'),
        'awaitingStock', (select count(*) from private.stockflow_orders where status = 'partially_reserved'),
        'readyForPicking', (select count(*) from private.stockflow_orders where status in ('fully_reserved', 'ready_for_picking')),
        'packed', (select count(*) from private.stockflow_orders where status = 'packed'),
        'awaitingTallyBilling', (select count(*) from private.stockflow_orders where status = 'awaiting_tally_billing'),
        'billedNotDispatched', (select count(*) from private.stockflow_orders where status in ('billed_in_tally', 'ready_for_dispatch')),
        'dispatchedToday', (select count(*) from private.stockflow_order_events where to_status = 'dispatched' and created_at >= date_trunc('day', now())),
        'urgentExceptions', (select count(*) from private.stockflow_orders where status in ('awaiting_approval', 'partially_reserved') and updated_at < now() - interval '24 hours')
      )
    );
  end if;

  if p_action = 'create_order' then
    if v_role not in ('administrator', 'sales', 'operations', 'management') then
      raise exception 'Role cannot create orders' using errcode = '42501';
    end if;
    if char_length(btrim(coalesce(p_payload->>'idempotencyKey', ''))) < 16 then
      raise exception 'A valid idempotency key is required' using errcode = '22023';
    end if;
    if char_length(btrim(coalesce(p_payload->>'customerName', ''))) not between 2 and 160 then
      raise exception 'Customer name is required' using errcode = '22023';
    end if;
    if jsonb_typeof(p_payload->'lines') <> 'array'
       or jsonb_array_length(p_payload->'lines') < 1
       or jsonb_array_length(p_payload->'lines') > 50 then
      raise exception 'Order must contain between 1 and 50 lines' using errcode = '22023';
    end if;

    select id into v_existing_id from private.stockflow_orders
    where created_by_email = v_actor_email and idempotency_key = p_payload->>'idempotencyKey';
    if v_existing_id is not null then
      return jsonb_build_object('ok', true, 'duplicate', true, 'orderId', v_existing_id);
    end if;

    if nullif(p_payload->>'customerId', '') is not null then
      select id into v_customer_id from private.stockflow_customers
      where id = (p_payload->>'customerId')::uuid and active;
      if v_customer_id is null then
        raise exception 'Customer was not found' using errcode = '22023';
      end if;
    else
      if nullif(btrim(coalesce(p_payload->>'customerPhone', '')), '') is not null then
        select id into v_customer_id from private.stockflow_customers
        where phone = btrim(p_payload->>'customerPhone') and active
        order by created_at limit 1;
      end if;
      if v_customer_id is null then
        insert into private.stockflow_customers(name, phone, city, created_by_email)
        values (
          btrim(p_payload->>'customerName'),
          nullif(btrim(coalesce(p_payload->>'customerPhone', '')), ''),
          nullif(btrim(coalesce(p_payload->>'customerCity', '')), ''),
          v_actor_email
        ) returning id into v_customer_id;
      end if;
    end if;

    insert into private.stockflow_orders(
      customer_id, customer_name, customer_phone, source, notes,
      idempotency_key, created_by_email, updated_by_email
    ) values (
      v_customer_id, btrim(p_payload->>'customerName'),
      nullif(btrim(coalesce(p_payload->>'customerPhone', '')), ''),
      coalesce(nullif(p_payload->>'source', ''), 'phone'),
      nullif(btrim(coalesce(p_payload->>'notes', '')), ''),
      p_payload->>'idempotencyKey', v_actor_email, v_actor_email
    ) returning id, order_seq into v_order_id, v_order_seq;

    v_order_number := 'SF-' || to_char(now(), 'YYMMDD') || '-' || lpad(v_order_seq::text, 5, '0');
    update private.stockflow_orders set order_number = v_order_number where id = v_order_id;
    select payload into v_snapshot from public.stockflow_snapshots where id = 'suprabha';

    for v_line in select value from jsonb_array_elements(p_payload->'lines')
    loop
      v_requested := nullif(v_line->>'quantity', '')::numeric;
      if v_requested is null or v_requested <= 0 or v_requested > 1000000 then
        raise exception 'Every line requires a positive quantity' using errcode = '22023';
      end if;
      select item into v_catalog_item
      from jsonb_array_elements(coalesce(v_snapshot->'catalog', '[]'::jsonb)) item
      where item->>'tallyKey' = v_line->>'tallyKey'
        and coalesce((item->>'active')::boolean, true)
      limit 1;
      if v_catalog_item is null then
        raise exception 'An order item is missing from the active Tally catalog' using errcode = '22023';
      end if;
      insert into private.stockflow_order_lines(
        order_id, tally_item_key, item_name, item_group, base_unit, quantity, snapshot_closing
      ) values (
        v_order_id, v_catalog_item->>'tallyKey', v_catalog_item->>'item',
        v_catalog_item->>'group', v_catalog_item->>'baseUnit', v_requested,
        coalesce(nullif(v_catalog_item->>'closing', '')::numeric, 0)
      );
      v_catalog_item := null;
    end loop;

    insert into private.stockflow_order_events(
      order_id, event_type, to_status, actor_email, actor_role, metadata
    ) values (
      v_order_id, 'order_created', 'phone_order_received', v_actor_email, v_role,
      jsonb_build_object('source', coalesce(p_payload->>'source', 'phone'))
    );
    insert into private.stockflow_outbox(topic, aggregate_id, payload)
    values ('order.created', v_order_id, jsonb_build_object('orderNumber', v_order_number));
    return jsonb_build_object(
      'ok', true, 'duplicate', false, 'orderId', v_order_id,
      'orderNumber', v_order_number, 'status', 'phone_order_received'
    );
  end if;

  v_order_id := (p_payload->>'orderId')::uuid;
  select * into v_order from private.stockflow_orders where id = v_order_id for update;
  if not found then raise exception 'Order was not found' using errcode = '22023'; end if;

  v_expected_version := nullif(p_payload->>'expectedVersion', '')::integer;
  if v_expected_version is null or v_expected_version <> v_order.version then
    raise exception 'Order has changed; refresh before trying again' using errcode = '40001';
  end if;

  if p_action = 'reserve_order' then
    if v_role not in ('administrator', 'operations', 'warehouse') then
      raise exception 'Role cannot reserve stock' using errcode = '42501';
    end if;
    if v_order.status not in ('confirmed', 'partially_reserved', 'fully_reserved') then
      raise exception 'Only confirmed orders can reserve stock' using errcode = '22023';
    end if;
    select payload into v_snapshot from public.stockflow_snapshots where id = 'suprabha';

    for v_line_id, v_catalog_item, v_requested in
      select l.id,
        coalesce((
          select item from jsonb_array_elements(coalesce(v_snapshot->'catalog', '[]'::jsonb)) item
          where item->>'tallyKey' = l.tally_item_key limit 1
        ), jsonb_build_object('tallyKey', l.tally_item_key, 'closing', 0)),
        l.quantity
      from private.stockflow_order_lines l
      where l.order_id = v_order_id order by l.tally_item_key
    loop
      perform pg_advisory_xact_lock(hashtextextended(v_catalog_item->>'tallyKey', 0));
      v_physical := coalesce(nullif(v_catalog_item->>'closing', '')::numeric, 0);
      select coalesce(sum(r.quantity), 0) into v_other_reserved
      from private.stockflow_reservations r
      where r.tally_item_key = v_catalog_item->>'tallyKey'
        and r.active and r.order_line_id <> v_line_id;
      v_allocate := greatest(least(v_requested, v_physical - v_other_reserved), 0);

      if v_allocate > 0 then
        insert into private.stockflow_reservations(
          order_line_id, order_id, tally_item_key, quantity, active
        ) values (
          v_line_id, v_order_id, v_catalog_item->>'tallyKey', v_allocate, true
        )
        on conflict (order_line_id) do update
        set quantity = excluded.quantity, active = true, released_at = null, released_reason = null;
      else
        update private.stockflow_reservations
        set active = false, released_at = now(), released_reason = 'No availability'
        where order_line_id = v_line_id and active;
      end if;
      update private.stockflow_order_lines set reserved_quantity = v_allocate where id = v_line_id;
    end loop;

    select count(*), count(*) filter (where reserved_quantity >= quantity)
    into v_total_lines, v_fully_reserved
    from private.stockflow_order_lines where order_id = v_order_id;
    v_to_status := case when v_total_lines = v_fully_reserved then 'fully_reserved' else 'partially_reserved' end;

    update private.stockflow_orders
    set status = v_to_status, version = version + 1,
        updated_by_email = v_actor_email, updated_at = now()
    where id = v_order_id;
    insert into private.stockflow_order_events(
      order_id, event_type, from_status, to_status, actor_email, actor_role
    ) values (v_order_id, 'stock_reserved', v_order.status, v_to_status, v_actor_email, v_role);
    return jsonb_build_object('ok', true, 'orderId', v_order_id, 'status', v_to_status, 'version', v_order.version + 1);
  end if;

  v_from_status := v_order.status;
  v_to_status := p_payload->>'toStatus';
  v_reason := nullif(btrim(coalesce(p_payload->>'reason', '')), '');
  v_invoice := nullif(btrim(coalesce(p_payload->>'tallyInvoiceNumber', '')), '');

  if v_role <> 'administrator' then
    if v_role = 'sales' and v_to_status not in ('awaiting_confirmation', 'awaiting_approval', 'confirmed', 'cancelled') then
      raise exception 'Sales role cannot make this transition' using errcode = '42501';
    elsif v_role = 'warehouse' and v_to_status not in ('ready_for_picking', 'picked', 'packed') then
      raise exception 'Warehouse role cannot make this transition' using errcode = '42501';
    elsif v_role = 'accounts' and v_to_status not in ('awaiting_tally_billing', 'billed_in_tally') then
      raise exception 'Accounts role cannot make this transition' using errcode = '42501';
    elsif v_role = 'management' and v_to_status not in ('confirmed', 'cancelled') then
      raise exception 'Management role cannot make this transition' using errcode = '42501';
    elsif v_role not in ('sales', 'warehouse', 'accounts', 'management', 'operations') then
      raise exception 'Role cannot change order status' using errcode = '42501';
    end if;
  end if;

  if not (
    (v_from_status = 'phone_order_received' and v_to_status in ('awaiting_confirmation', 'cancelled')) or
    (v_from_status = 'awaiting_confirmation' and v_to_status in ('awaiting_approval', 'confirmed', 'cancelled')) or
    (v_from_status = 'awaiting_approval' and v_to_status in ('confirmed', 'cancelled')) or
    (v_from_status in ('fully_reserved', 'partially_reserved') and v_to_status in ('ready_for_picking', 'cancelled')) or
    (v_from_status = 'ready_for_picking' and v_to_status in ('picked', 'cancelled')) or
    (v_from_status = 'picked' and v_to_status in ('packed', 'cancelled')) or
    (v_from_status = 'packed' and v_to_status in ('awaiting_tally_billing', 'cancelled')) or
    (v_from_status = 'awaiting_tally_billing' and v_to_status in ('billed_in_tally', 'cancelled')) or
    (v_from_status = 'billed_in_tally' and v_to_status in ('ready_for_dispatch', 'cancelled')) or
    (v_from_status = 'ready_for_dispatch' and v_to_status in ('dispatched', 'cancelled')) or
    (v_from_status = 'dispatched' and v_to_status = 'delivered')
  ) then raise exception 'Invalid order status transition' using errcode = '22023'; end if;

  if v_to_status = 'cancelled' and v_reason is null then
    raise exception 'Cancellation reason is required' using errcode = '22023';
  end if;
  if v_to_status = 'billed_in_tally' and v_invoice is null then
    raise exception 'Tally invoice number is required' using errcode = '22023';
  end if;

  if v_to_status = 'cancelled' then
    update private.stockflow_reservations
    set active = false, released_at = now(), released_reason = v_reason
    where order_id = v_order_id and active;
    update private.stockflow_order_lines set reserved_quantity = 0 where order_id = v_order_id;
  end if;

  update private.stockflow_orders
  set status = v_to_status,
      tally_invoice_number = case when v_to_status = 'billed_in_tally' then v_invoice else tally_invoice_number end,
      version = version + 1, updated_by_email = v_actor_email, updated_at = now()
  where id = v_order_id;
  insert into private.stockflow_order_events(
    order_id, event_type, from_status, to_status, reason, actor_email, actor_role, metadata
  ) values (
    v_order_id, 'status_changed', v_from_status, v_to_status, v_reason, v_actor_email, v_role,
    case when v_invoice is null then '{}'::jsonb else jsonb_build_object('tallyInvoiceNumber', v_invoice) end
  );
  insert into private.stockflow_outbox(topic, aggregate_id, payload)
  values ('order.status_changed', v_order_id, jsonb_build_object('from', v_from_status, 'to', v_to_status));
  return jsonb_build_object('ok', true, 'orderId', v_order_id, 'status', v_to_status, 'version', v_order.version + 1);
end;
$$;

revoke all on function public.stockflow_order_gateway(text, text, text, jsonb) from public;
grant execute on function public.stockflow_order_gateway(text, text, text, jsonb) to anon, authenticated, service_role;

update public.stockflow_members set status = 'active', updated_at = now()
where email in ('anil.mahindrakar22@gmail.com', 'nikitesh.am@gmail.com');

comment on schema private is 'Private StockFlow transactional domain; not exposed through the Data API.';
comment on function public.stockflow_order_gateway(text, text, text, jsonb)
is 'Authenticated server-to-server gateway for ACID StockFlow order operations.';
