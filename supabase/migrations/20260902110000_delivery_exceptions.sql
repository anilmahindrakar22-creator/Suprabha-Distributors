create table private.stockflow_delivery_exceptions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references private.stockflow_orders(id) on delete restrict,
  category text not null check (category in ('delayed','failed_delivery','damaged','wrong_item','other')),
  status text not null default 'open' check (status in ('open','resolved')),
  summary text not null check (char_length(summary) between 3 and 500),
  owner_email text,
  resolution text check (resolution is null or char_length(resolution) between 3 and 500),
  created_by_email text not null,
  resolved_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create unique index stockflow_delivery_exceptions_one_open_category
  on private.stockflow_delivery_exceptions(order_id, category)
  where status = 'open';
create index stockflow_delivery_exceptions_open_idx
  on private.stockflow_delivery_exceptions(updated_at desc) where status = 'open';

alter table private.stockflow_delivery_exceptions enable row level security;
revoke all on private.stockflow_delivery_exceptions from public, anon, authenticated;

create or replace function public.stockflow_exception_gateway(
  p_gateway_key text, p_actor_email text, p_action text, p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private, extensions as $$
declare
  v_email text := lower(btrim(coalesce(p_actor_email, ''))); v_role text; v_hash text;
  v_order private.stockflow_orders%rowtype; v_exception private.stockflow_delivery_exceptions%rowtype;
  v_category text; v_summary text; v_owner text; v_resolution text;
begin
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name = 'orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key, ''), 'sha256'), 'hex') <> v_hash then raise exception 'Unauthorized gateway' using errcode = '42501'; end if;
  select role into v_role from public.stockflow_members where email = v_email and status = 'active';
  if v_role not in ('administrator','operations','sales','warehouse','management') then raise exception 'Role cannot manage delivery exceptions' using errcode = '42501'; end if;
  if p_action not in ('create_exception','resolve_exception') then raise exception 'Unsupported exception action' using errcode = '22023'; end if;

  select * into v_order from private.stockflow_orders where id = (p_payload->>'orderId')::uuid for update;
  if not found then raise exception 'Order was not found' using errcode = '22023'; end if;
  if v_order.version <> (p_payload->>'expectedVersion')::integer then raise exception 'Order has changed; refresh before trying again' using errcode = '40001'; end if;
  if v_order.status = 'cancelled' then raise exception 'Cancelled orders cannot receive delivery exceptions' using errcode = '22023'; end if;

  if p_action = 'create_exception' then
    v_category := p_payload->>'category';
    v_summary := btrim(coalesce(p_payload->>'summary',''));
    v_owner := lower(nullif(btrim(coalesce(p_payload->>'ownerEmail','')), ''));
    if v_category not in ('delayed','failed_delivery','damaged','wrong_item','other') or char_length(v_summary) not between 3 and 500 then raise exception 'Valid category and summary are required' using errcode = '22023'; end if;
    if v_owner is not null and not exists(select 1 from public.stockflow_members where email=v_owner and status='active') then raise exception 'Exception owner must be an active user' using errcode = '22023'; end if;
    insert into private.stockflow_delivery_exceptions(order_id,category,summary,owner_email,created_by_email)
    values(v_order.id,v_category,v_summary,v_owner,v_email) returning * into v_exception;
    insert into private.stockflow_order_events(order_id,event_type,from_status,to_status,reason,actor_email,actor_role,metadata)
    values(v_order.id,'delivery_exception_opened',v_order.status,v_order.status,v_summary,v_email,v_role,jsonb_build_object('exceptionId',v_exception.id,'category',v_category,'ownerEmail',v_owner));
  else
    v_resolution := btrim(coalesce(p_payload->>'resolution',''));
    if char_length(v_resolution) not between 3 and 500 then raise exception 'Resolution is required' using errcode = '22023'; end if;
    select * into v_exception from private.stockflow_delivery_exceptions where id=(p_payload->>'exceptionId')::uuid and order_id=v_order.id for update;
    if not found or v_exception.status <> 'open' then raise exception 'Open delivery exception was not found' using errcode = '22023'; end if;
    update private.stockflow_delivery_exceptions set status='resolved',resolution=v_resolution,resolved_by_email=v_email,resolved_at=now(),updated_at=now() where id=v_exception.id;
    insert into private.stockflow_order_events(order_id,event_type,from_status,to_status,reason,actor_email,actor_role,metadata)
    values(v_order.id,'delivery_exception_resolved',v_order.status,v_order.status,v_resolution,v_email,v_role,jsonb_build_object('exceptionId',v_exception.id,'category',v_exception.category));
  end if;
  update private.stockflow_orders set version=version+1,updated_by_email=v_email,updated_at=now() where id=v_order.id;
  return jsonb_build_object('ok',true,'orderId',v_order.id,'exceptionId',v_exception.id,'version',v_order.version+1);
end $$;

revoke all on function public.stockflow_exception_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_exception_gateway(text,text,text,jsonb) to service_role;

do $$
declare f text; updated text;
begin
  select pg_get_functiondef('public.stockflow_order_gateway(text,text,text,jsonb)'::regprocedure) into f;
  updated := replace(f,
    $old$), '[]'::jsonb) as events
          from private.stockflow_orders x$old$,
    $new$), '[]'::jsonb) as events,
            coalesce((select jsonb_agg(jsonb_build_object(
              'id', issue.id, 'category', issue.category, 'status', issue.status,
              'summary', issue.summary, 'ownerEmail', issue.owner_email,
              'resolution', issue.resolution, 'createdBy', issue.created_by_email,
              'resolvedBy', issue.resolved_by_email, 'createdAt', issue.created_at,
              'resolvedAt', issue.resolved_at
            ) order by issue.created_at, issue.id)
            from private.stockflow_delivery_exceptions issue where issue.order_id=x.id), '[]'::jsonb) as exceptions
          from private.stockflow_orders x$new$);
  if updated = f then raise exception 'Expected order event projection was not found'; end if;
  execute updated;
end $$;

revoke all on function public.stockflow_order_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_order_gateway(text,text,text,jsonb) to service_role;
