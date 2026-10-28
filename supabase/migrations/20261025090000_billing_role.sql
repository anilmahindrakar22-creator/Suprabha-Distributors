-- Billing role (owner, 25 Oct 2026): the person who punches the bill in Tally from the
-- desktop sees orders ready for billing and the APPROVED price only. They never see cost,
-- margin, price history, the price book or Economics. They may mark an order billed.

-- 1. Role universe.
alter table public.stockflow_members drop constraint stockflow_members_role_check;
alter table public.stockflow_members add constraint stockflow_members_role_check
  check (role = any (array['administrator','sales','operations','warehouse','accounts','management','viewer','billing']));

create or replace function private.stockflow_valid_roles(p_roles text[])
returns boolean
language sql
immutable
set search_path to 'pg_catalog'
as $function$
  select coalesce(
    array_ndims(p_roles) = 1 and array_lower(p_roles,1) = 1
    and cardinality(p_roles) between 1 and 8
    and array_position(p_roles,null) is null
    and p_roles <@ array['administrator','sales','operations','warehouse','accounts','management','viewer','billing']::text[]
    and cardinality(p_roles) = (select count(distinct r) from unnest(p_roles) r), false)
$function$;

alter table private.stockflow_role_permissions drop constraint stockflow_role_permissions_role_check;
alter table private.stockflow_role_permissions add constraint stockflow_role_permissions_role_check
  check (role = any (array['administrator','sales','operations','warehouse','accounts','management','viewer','billing']));
alter table private.stockflow_role_order_scopes drop constraint stockflow_role_order_scopes_role_check;
alter table private.stockflow_role_order_scopes add constraint stockflow_role_order_scopes_role_check
  check (role = any (array['administrator','sales','operations','warehouse','accounts','management','viewer','billing']));
alter table private.stockflow_order_transition_rules drop constraint stockflow_transition_roles_known;
alter table private.stockflow_order_transition_rules add constraint stockflow_transition_roles_known
  check (allowed_roles <@ array['administrator','sales','operations','warehouse','accounts','management','viewer','billing']);

-- 2. Billing reads orders (global scope like every other role) and may mark them billed.
insert into private.stockflow_role_order_scopes(role, scope) values ('billing', 'global');
insert into private.stockflow_role_permissions(role, permission) values ('billing', 'orders.transition');
update private.stockflow_order_transition_rules
set allowed_roles = array_append(allowed_roles, 'billing')
where from_status = 'awaiting_tally_billing' and to_status = 'billed_in_tally' and not ('billing' = any(allowed_roles));
do $$ begin
  if not exists(select 1 from private.stockflow_order_transition_rules
    where from_status='awaiting_tally_billing' and to_status='billed_in_tally' and 'billing'=any(allowed_roles)) then
    raise exception 'Billing transition rule missing; stop billing-role migration';
  end if;
end $$;

-- 3. Administrators can assign the role; billing staff can add order notes.
do $migration$
declare
  f text;
  piece text;
  user_old constant text := $a$if v_role not in ('administrator', 'sales', 'operations', 'warehouse', 'accounts', 'management', 'viewer') then$a$;
  note_old constant text := $a$&& array['administrator','sales','operations','warehouse','accounts','management']$a$;
begin
  f := pg_get_functiondef('public.stockflow_user_gateway(text,text,text,jsonb)'::regprocedure);
  if (length(f) - length(replace(f, user_old, ''))) / length(user_old) <> 1 then
    raise exception 'Unexpected user role validation; stop billing-role migration';
  end if;
  execute replace(f, user_old, $a$if v_role not in ('administrator', 'sales', 'operations', 'warehouse', 'accounts', 'management', 'viewer', 'billing') then$a$);

  f := pg_get_functiondef('public.stockflow_order_note_gateway(text,text,text,jsonb)'::regprocedure);
  if (length(f) - length(replace(f, note_old, ''))) / length(note_old) <> 1 then
    raise exception 'Unexpected order note roles; stop billing-role migration';
  end if;
  execute replace(f, note_old, $a$&& array['administrator','sales','operations','warehouse','accounts','management','billing']$a$);
end $migration$;

-- 4. Billing sheet: customer, items, quantities and the approved rate from the order's current
-- immutable billing snapshot. An explicit key allowlist: no cost, margin, source or history.
-- Amounts use the packed quantity (what leaves the warehouse); the ordered quantity is shown too.
-- Orders packed before packed quantities were recorded have every line at 0: those bill the
-- ordered quantity and say so (quantitySource='ordered').
create or replace function private.stockflow_order_billing_sheet(p_order_id uuid)
returns jsonb
language plpgsql
stable
set search_path to 'pg_catalog', 'private'
as $function$
declare
  o private.stockflow_orders%rowtype;
  snap jsonb;
  lines jsonb := '[]'::jsonb;
  total numeric := 0;
  l record;
  rate numeric;
  bill_quantity numeric;
  base jsonb;
  use_ordered boolean;
begin
  select * into o from private.stockflow_orders where id = p_order_id and archived_at is null;
  if not found then raise exception 'Order was not found' using errcode = '22023'; end if;
  base := jsonb_build_object('view', 'billing', 'orderId', o.id, 'orderNumber', o.order_number,
    'customerName', o.customer_name, 'status', o.status);
  if o.pricing_state <> 'approved' or o.pricing_snapshot_id is null then
    return base || jsonb_build_object('ready', false, 'reason', 'Price approval is not complete');
  end if;
  select pricing_payload into snap from private.stockflow_billing_snapshots
  where id = o.pricing_snapshot_id and order_id = o.id and invalidated_at is null;
  if snap is null or jsonb_typeof(snap) <> 'array' then
    return base || jsonb_build_object('ready', false, 'reason', 'Approved price snapshot is not current');
  end if;
  select not exists(select 1 from private.stockflow_order_lines where order_id = o.id and fulfilled_quantity > 0) into use_ordered;
  for l in select id, item_name, base_unit, quantity, fulfilled_quantity from private.stockflow_order_lines
    where order_id = o.id order by created_at, id loop
    select (e->>'approved_rate')::numeric into rate from jsonb_array_elements(snap) e
    where e->>'order_line_id' = l.id::text and e->>'state' = 'approved' and e->>'approved_rate' is not null
    limit 1;
    if rate is null then
      return base || jsonb_build_object('ready', false, 'reason', 'An item has no approved price');
    end if;
    bill_quantity := case when use_ordered then l.quantity else l.fulfilled_quantity end;
    lines := lines || jsonb_build_array(jsonb_build_object(
      'lineId', l.id, 'itemName', l.item_name, 'unit', l.base_unit,
      'orderedQuantity', l.quantity, 'packedQuantity', l.fulfilled_quantity, 'billQuantity', bill_quantity,
      'approvedRate', rate, 'amount', round(rate * bill_quantity, 2)));
    total := total + round(rate * bill_quantity, 2);
  end loop;
  return base || jsonb_build_object('ready', true, 'quantitySource', case when use_ordered then 'ordered' else 'packed' end, 'lines', lines, 'total', total);
end $function$;
revoke all on function private.stockflow_order_billing_sheet(uuid) from public, anon, authenticated;

-- 5. The pricing gateway answers get_order_pricing with view=billing for billing, accounts,
-- management and administrators; every other request goes to the unchanged gateway.
alter function public.stockflow_pricing_gateway(text,text,text,jsonb) rename to stockflow_pricing_gateway_before_billing;
revoke all on function public.stockflow_pricing_gateway_before_billing(text,text,text,jsonb) from public, anon, authenticated;

create function public.stockflow_pricing_gateway(p_gateway_key text, p_actor_email text, p_action text, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'private', 'extensions'
as $function$
declare
  actor_email text := lower(btrim(coalesce(p_actor_email, '')));
  assigned_roles text[];
  secret text;
  order_id uuid;
begin
  -- coalesce: a missing view must delegate, never fall into the billing branch (NULL is not false).
  if not (p_action = 'get_order_pricing' and coalesce(p_payload->>'view', '') = 'billing') then
    return public.stockflow_pricing_gateway_before_billing(p_gateway_key, p_actor_email, p_action, p_payload);
  end if;
  select secret_sha256 into secret from private.stockflow_gateway_config where name = 'orders';
  if secret is null or encode(extensions.digest(coalesce(p_gateway_key, ''), 'sha256'), 'hex') <> secret then
    raise exception 'Unauthorized gateway' using errcode = '42501';
  end if;
  select m.roles into assigned_roles from public.stockflow_members m where m.email = actor_email and m.status = 'active';
  if not private.stockflow_valid_roles(assigned_roles)
     or not (assigned_roles && array['administrator','management','accounts','billing']::text[]) then
    raise exception 'Billing details are restricted' using errcode = '42501';
  end if;
  begin order_id := (p_payload->>'orderId')::uuid;
  exception when invalid_text_representation then raise exception 'Valid order is required' using errcode = '22023'; end;
  if order_id is null then raise exception 'Valid order is required' using errcode = '22023'; end if;
  perform private.assert_stockflow_order_access(actor_email, assigned_roles, order_id);
  -- Billing-only staff see prices only once an order reaches billing.
  if not (assigned_roles && array['administrator','management','accounts']::text[])
     and not exists(select 1 from private.stockflow_orders where id = order_id
       and status in ('awaiting_tally_billing','billed_in_tally','ready_for_dispatch','dispatched','delivered')) then
    raise exception 'Billing details appear when the order is ready for billing' using errcode = '42501';
  end if;
  return private.stockflow_order_billing_sheet(order_id);
end $function$;
revoke all on function public.stockflow_pricing_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_pricing_gateway(text,text,text,jsonb) to service_role;

notify pgrst, 'reload schema';
