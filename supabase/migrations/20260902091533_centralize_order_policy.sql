create table private.stockflow_role_permissions (
  role text not null check (role in ('administrator','sales','operations','warehouse','accounts','management','viewer')),
  permission text not null check (permission in ('orders.create','orders.transition')),
  primary key (role, permission)
);

create table private.stockflow_order_states (
  status text primary key,
  terminal boolean not null default false
);

create table private.stockflow_order_transition_rules (
  from_status text not null references private.stockflow_order_states(status),
  to_status text not null references private.stockflow_order_states(status),
  allowed_roles text[] not null check (cardinality(allowed_roles) > 0),
  requires_reason boolean not null default false,
  requires_tally_invoice boolean not null default false,
  primary key (from_status, to_status)
);

alter table private.stockflow_role_permissions enable row level security;
alter table private.stockflow_order_states enable row level security;
alter table private.stockflow_order_transition_rules enable row level security;

insert into private.stockflow_role_permissions(role, permission) values
  ('administrator','orders.create'), ('administrator','orders.transition'),
  ('sales','orders.create'), ('sales','orders.transition'),
  ('operations','orders.create'), ('operations','orders.transition'),
  ('warehouse','orders.transition'),
  ('accounts','orders.transition'),
  ('management','orders.create'), ('management','orders.transition');

insert into private.stockflow_order_states(status, terminal) values
  ('phone_order_received',false), ('awaiting_confirmation',false),
  ('awaiting_approval',false), ('confirmed',false),
  ('partially_reserved',false), ('fully_reserved',false),
  ('ready_for_picking',false), ('picked',false), ('packed',false),
  ('awaiting_tally_billing',false), ('billed_in_tally',false),
  ('ready_for_dispatch',false), ('dispatched',false),
  ('delivered',true), ('cancelled',true);

insert into private.stockflow_order_transition_rules(
  from_status, to_status, allowed_roles, requires_reason, requires_tally_invoice
) values
  ('phone_order_received','awaiting_confirmation',array['administrator','operations','sales'],false,false),
  ('phone_order_received','cancelled',array['administrator'],true,false),
  ('awaiting_confirmation','awaiting_approval',array['administrator','operations','sales'],false,false),
  ('awaiting_confirmation','confirmed',array['administrator','operations','sales','management'],false,false),
  ('awaiting_confirmation','cancelled',array['administrator'],true,false),
  ('awaiting_approval','confirmed',array['administrator','operations','sales','management'],false,false),
  ('awaiting_approval','cancelled',array['administrator'],true,false),
  ('confirmed','packed',array['administrator','operations','warehouse'],false,false),
  ('confirmed','cancelled',array['administrator'],true,false),
  ('fully_reserved','ready_for_picking',array['administrator','operations','warehouse'],false,false),
  ('fully_reserved','packed',array['administrator','operations','warehouse'],false,false),
  ('fully_reserved','cancelled',array['administrator'],true,false),
  ('partially_reserved','ready_for_picking',array['administrator','operations','warehouse'],false,false),
  ('partially_reserved','cancelled',array['administrator'],true,false),
  ('ready_for_picking','picked',array['administrator','operations','warehouse'],false,false),
  ('ready_for_picking','packed',array['administrator','operations','warehouse'],false,false),
  ('ready_for_picking','cancelled',array['administrator'],true,false),
  ('picked','packed',array['administrator','operations','warehouse'],false,false),
  ('picked','cancelled',array['administrator'],true,false),
  ('packed','awaiting_tally_billing',array['administrator','operations','accounts'],false,false),
  ('packed','cancelled',array['administrator'],true,false),
  ('awaiting_tally_billing','billed_in_tally',array['administrator','operations','accounts'],false,true),
  ('awaiting_tally_billing','cancelled',array['administrator'],true,false),
  ('billed_in_tally','ready_for_dispatch',array['administrator','operations'],false,false),
  ('billed_in_tally','cancelled',array['administrator'],true,false),
  ('ready_for_dispatch','dispatched',array['administrator','operations'],false,false),
  ('ready_for_dispatch','cancelled',array['administrator'],true,false),
  ('dispatched','delivered',array['administrator','operations'],false,false);

create or replace function private.assert_stockflow_permission(p_role text, p_permission text)
returns void
language plpgsql
set search_path = pg_catalog, private
as $$
begin
  if not exists (
    select 1 from private.stockflow_role_permissions
    where role = p_role and permission = p_permission
  ) then
    raise exception 'Role is not permitted to perform this order action' using errcode = '42501';
  end if;
end;
$$;

create or replace function private.assert_stockflow_order_transition(
  p_role text, p_from_status text, p_to_status text,
  p_reason text default null, p_tally_invoice text default null
) returns void
language plpgsql
set search_path = pg_catalog, private
as $$
declare
  v_rule private.stockflow_order_transition_rules%rowtype;
begin
  perform private.assert_stockflow_permission(p_role, 'orders.transition');

  select * into v_rule
  from private.stockflow_order_transition_rules
  where from_status = p_from_status and to_status = p_to_status;

  if not found then
    raise exception 'Invalid order status transition' using errcode = '22023';
  end if;
  if not (p_role = any(v_rule.allowed_roles)) then
    raise exception 'Role cannot make this order transition' using errcode = '42501';
  end if;
  if v_rule.requires_reason and nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Cancellation reason is required' using errcode = '22023';
  end if;
  if v_rule.requires_tally_invoice and nullif(btrim(coalesce(p_tally_invoice, '')), '') is null then
    raise exception 'Tally invoice number is required' using errcode = '22023';
  end if;
end;
$$;

revoke all on function private.assert_stockflow_permission(text,text) from public, anon, authenticated;
revoke all on function private.assert_stockflow_order_transition(text,text,text,text,text) from public, anon, authenticated;

do $$
declare
  f text;
  old_create text := $old$    if v_role not in ('administrator', 'sales', 'operations', 'management') then
      raise exception 'Role cannot create orders' using errcode = '42501';
    end if;$old$;
  old_transition text := $old$  if v_to_status = 'cancelled' and v_role <> 'administrator' then
    raise exception 'Only an administrator can cancel an order';
  end if;

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
    (v_from_status = 'confirmed' and v_to_status in ('packed', 'cancelled')) or
    (v_from_status = 'fully_reserved' and v_to_status in ('ready_for_picking', 'packed', 'cancelled')) or
    (v_from_status = 'partially_reserved' and v_to_status in ('ready_for_picking', 'cancelled')) or
    (v_from_status = 'ready_for_picking' and v_to_status in ('picked', 'packed', 'cancelled')) or
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
  end if;$old$;
begin
  select pg_get_functiondef('public.stockflow_order_gateway(text,text,text,jsonb)'::regprocedure) into f;
  if position(old_create in f) = 0 or position(old_transition in f) = 0 then
    raise exception 'Expected order authorization blocks were not found';
  end if;
  f := replace(f, old_create, $new$    perform private.assert_stockflow_permission(v_role, 'orders.create');$new$);
  f := replace(f, old_transition, $new$  perform private.assert_stockflow_order_transition(
    v_role, v_from_status, v_to_status, v_reason, v_invoice
  );$new$);
  execute f;
end;
$$;

revoke all on function public.stockflow_order_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_order_gateway(text,text,text,jsonb) to service_role;
