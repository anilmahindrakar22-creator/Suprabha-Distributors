create table private.stockflow_equipment_installations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references private.stockflow_orders(id) on delete restrict,
  tally_key text not null,
  item_name text not null,
  status text not null default 'scheduled' check (status in ('scheduled','completed')),
  scheduled_date date not null,
  engineer_email text,
  site_contact text check (site_contact is null or char_length(site_contact) <= 200),
  serial_number text check (serial_number is null or char_length(serial_number) between 2 and 100),
  commissioning_notes text check (commissioning_notes is null or char_length(commissioning_notes) between 3 and 1000),
  created_by_email text not null,
  completed_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index stockflow_equipment_installations_one_open_item
  on private.stockflow_equipment_installations(order_id, tally_key) where status = 'scheduled';
create index stockflow_equipment_installations_schedule_idx
  on private.stockflow_equipment_installations(scheduled_date, order_id) where status = 'scheduled';

alter table private.stockflow_equipment_installations enable row level security;
revoke all on private.stockflow_equipment_installations from public, anon, authenticated;

create or replace function public.stockflow_installation_gateway(
  p_gateway_key text, p_actor_email text, p_action text, p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private, extensions as $$
declare
  v_email text := lower(btrim(coalesce(p_actor_email, ''))); v_role text; v_hash text;
  v_order private.stockflow_orders%rowtype; v_installation private.stockflow_equipment_installations%rowtype;
  v_line private.stockflow_order_lines%rowtype; v_engineer text; v_site text; v_serial text; v_notes text;
begin
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name = 'orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key, ''), 'sha256'), 'hex') <> v_hash then raise exception 'Unauthorized gateway' using errcode = '42501'; end if;
  select role into v_role from public.stockflow_members where email = v_email and status = 'active';
  if v_role not in ('administrator','operations','sales','warehouse','management') then raise exception 'Role cannot manage installations' using errcode = '42501'; end if;
  if p_action not in ('schedule_installation','complete_installation') then raise exception 'Unsupported installation action' using errcode = '22023'; end if;

  select * into v_order from private.stockflow_orders where id=(p_payload->>'orderId')::uuid for update;
  if not found then raise exception 'Order was not found' using errcode = '22023'; end if;
  if v_order.version <> (p_payload->>'expectedVersion')::integer then raise exception 'Order has changed; refresh before trying again' using errcode = '40001'; end if;
  if v_order.status = 'cancelled' then raise exception 'Cancelled orders cannot have installations' using errcode = '22023'; end if;

  if p_action = 'schedule_installation' then
    select * into v_line from private.stockflow_order_lines where order_id=v_order.id and tally_key=p_payload->>'tallyKey';
    if not found then raise exception 'Equipment item was not found in this order' using errcode = '22023'; end if;
    v_engineer := lower(nullif(btrim(coalesce(p_payload->>'engineerEmail','')), ''));
    v_site := nullif(btrim(coalesce(p_payload->>'siteContact','')), '');
    if v_engineer is not null and not exists(select 1 from public.stockflow_members where email=v_engineer and status='active') then raise exception 'Engineer must be an active user' using errcode = '22023'; end if;
    if char_length(coalesce(v_site,'')) > 200 then raise exception 'Site contact is too long' using errcode = '22023'; end if;
    insert into private.stockflow_equipment_installations(order_id,tally_key,item_name,scheduled_date,engineer_email,site_contact,created_by_email)
    values(v_order.id,v_line.tally_key,v_line.item_name,(p_payload->>'scheduledDate')::date,v_engineer,v_site,v_email) returning * into v_installation;
    insert into private.stockflow_order_events(order_id,event_type,from_status,to_status,reason,actor_email,actor_role,metadata)
    values(v_order.id,'installation_scheduled',v_order.status,v_order.status,'Installation scheduled',v_email,v_role,jsonb_build_object('installationId',v_installation.id,'tallyKey',v_line.tally_key,'scheduledDate',v_installation.scheduled_date,'engineerEmail',v_engineer));
  else
    v_serial := btrim(coalesce(p_payload->>'serialNumber','')); v_notes := btrim(coalesce(p_payload->>'commissioningNotes',''));
    if char_length(v_serial) not between 2 and 100 or char_length(v_notes) not between 3 and 1000 then raise exception 'Serial number and commissioning notes are required' using errcode = '22023'; end if;
    select * into v_installation from private.stockflow_equipment_installations where id=(p_payload->>'installationId')::uuid and order_id=v_order.id for update;
    if not found or v_installation.status <> 'scheduled' then raise exception 'Scheduled installation was not found' using errcode = '22023'; end if;
    update private.stockflow_equipment_installations set status='completed',serial_number=v_serial,commissioning_notes=v_notes,completed_by_email=v_email,completed_at=now(),updated_at=now() where id=v_installation.id;
    insert into private.stockflow_order_events(order_id,event_type,from_status,to_status,reason,actor_email,actor_role,metadata)
    values(v_order.id,'installation_completed',v_order.status,v_order.status,'Installation commissioned',v_email,v_role,jsonb_build_object('installationId',v_installation.id,'tallyKey',v_installation.tally_key,'serialNumber',v_serial));
  end if;
  update private.stockflow_orders set version=version+1,updated_by_email=v_email,updated_at=now() where id=v_order.id;
  return jsonb_build_object('ok',true,'orderId',v_order.id,'installationId',v_installation.id,'version',v_order.version+1);
end $$;

revoke all on function public.stockflow_installation_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_installation_gateway(text,text,text,jsonb) to service_role;

do $$
declare f text; updated text;
begin
  select pg_get_functiondef('public.stockflow_order_gateway(text,text,text,jsonb)'::regprocedure) into f;
  updated := replace(f,
    $old$), '[]'::jsonb) as exceptions
          from private.stockflow_orders x$old$,
    $new$), '[]'::jsonb) as exceptions,
            coalesce((select jsonb_agg(jsonb_build_object(
              'id', install.id, 'tallyKey', install.tally_key, 'itemName', install.item_name,
              'status', install.status, 'scheduledDate', install.scheduled_date,
              'engineerEmail', install.engineer_email, 'siteContact', install.site_contact,
              'serialNumber', install.serial_number, 'commissioningNotes', install.commissioning_notes,
              'createdBy', install.created_by_email, 'createdAt', install.created_at,
              'completedBy', install.completed_by_email, 'completedAt', install.completed_at
            ) order by install.scheduled_date, install.id)
            from private.stockflow_equipment_installations install where install.order_id=x.id), '[]'::jsonb) as installations
          from private.stockflow_orders x$new$);
  if updated = f then raise exception 'Expected delivery exception projection was not found'; end if;
  execute updated;
end $$;

revoke all on function public.stockflow_order_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_order_gateway(text,text,text,jsonb) to service_role;
