create sequence private.stockflow_service_ticket_number_seq;

create table private.stockflow_service_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number text not null unique default ('ST-' || to_char(current_date, 'YYMMDD') || '-' || lpad(nextval('private.stockflow_service_ticket_number_seq')::text, 5, '0')),
  installation_id uuid not null references private.stockflow_equipment_installations(id) on delete restrict,
  order_id uuid not null references private.stockflow_orders(id) on delete restrict,
  category text not null check (category in ('breakdown','preventive_maintenance','calibration','training','other')),
  priority text not null default 'normal' check (priority in ('normal','high','urgent')),
  status text not null default 'open' check (status in ('open','resolved')),
  summary text not null check (char_length(summary) between 3 and 500),
  resolution text check (resolution is null or char_length(resolution) between 3 and 1000),
  created_by_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_by_email text,
  resolved_at timestamptz,
  version integer not null default 1 check (version > 0),
  constraint stockflow_service_ticket_resolution check (
    (status = 'open' and resolution is null and resolved_by_email is null and resolved_at is null)
    or (status = 'resolved' and resolution is not null and resolved_by_email is not null and resolved_at is not null)
  )
);

create table private.stockflow_service_ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references private.stockflow_service_tickets(id) on delete restrict,
  event_type text not null check (event_type in ('opened','resolved')),
  actor_email text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index stockflow_service_tickets_open_idx on private.stockflow_service_tickets(priority, created_at) where status = 'open';
create index stockflow_service_tickets_installation_idx on private.stockflow_service_tickets(installation_id, created_at desc);
create index stockflow_service_ticket_events_ticket_idx on private.stockflow_service_ticket_events(ticket_id, created_at);

alter table private.stockflow_service_tickets enable row level security;
alter table private.stockflow_service_ticket_events enable row level security;
revoke all on private.stockflow_service_tickets, private.stockflow_service_ticket_events from public, anon, authenticated;

create trigger stockflow_service_tickets_no_delete before delete on private.stockflow_service_tickets
for each row execute function private.prevent_business_delete();
create trigger stockflow_service_ticket_events_no_delete before delete on private.stockflow_service_ticket_events
for each row execute function private.prevent_business_delete();

create or replace function public.stockflow_service_gateway(
  p_gateway_key text, p_actor_email text, p_action text, p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private, extensions as $$
declare
  v_email text := lower(btrim(coalesce(p_actor_email, ''))); v_role text; v_hash text;
  v_installation private.stockflow_equipment_installations%rowtype;
  v_ticket private.stockflow_service_tickets%rowtype;
  v_summary text; v_resolution text; v_key text; v_replay jsonb; v_result jsonb;
begin
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name = 'orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key, ''), 'sha256'), 'hex') <> v_hash then raise exception 'Unauthorized gateway' using errcode = '42501'; end if;
  select role into v_role from public.stockflow_members where email = v_email and status = 'active';
  if v_role is null then raise exception 'Active membership required' using errcode = '42501'; end if;
  if p_action not in ('get_service_workspace','create_service_ticket','resolve_service_ticket') then raise exception 'Unsupported service action' using errcode = '22023'; end if;

  if p_action = 'get_service_workspace' then
    return jsonb_build_object(
      'assets', coalesce((select jsonb_agg(jsonb_build_object(
        'installationId', i.id, 'orderId', o.id, 'orderNumber', o.order_number,
        'customerName', o.customer_name, 'customerPhone', o.customer_phone,
        'tallyKey', i.tally_key, 'itemName', i.item_name, 'serialNumber', i.serial_number,
        'installedAt', i.completed_at, 'siteContact', i.site_contact,
        'engineerEmail', i.engineer_email, 'commissioningNotes', i.commissioning_notes
      ) order by i.completed_at desc) from private.stockflow_equipment_installations i
        join private.stockflow_orders o on o.id=i.order_id where i.status='completed'), '[]'::jsonb),
      'tickets', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id, 'ticketNumber', t.ticket_number, 'installationId', t.installation_id,
        'category', t.category, 'priority', t.priority, 'status', t.status,
        'summary', t.summary, 'resolution', t.resolution, 'createdBy', t.created_by_email,
        'createdAt', t.created_at, 'resolvedBy', t.resolved_by_email, 'resolvedAt', t.resolved_at,
        'version', t.version, 'events', coalesce((select jsonb_agg(jsonb_build_object(
          'id', e.id, 'eventType', e.event_type, 'actorEmail', e.actor_email, 'createdAt', e.created_at
        ) order by e.created_at) from private.stockflow_service_ticket_events e where e.ticket_id=t.id), '[]'::jsonb)
      ) order by (t.status='open') desc, t.created_at desc) from private.stockflow_service_tickets t), '[]'::jsonb)
    );
  end if;

  v_key := p_payload->>'idempotencyKey';
  v_replay := private.begin_stockflow_command(v_email, p_action, v_key, p_payload);
  if v_replay is not null then return v_replay; end if;

  if p_action = 'create_service_ticket' then
    if v_role not in ('administrator','operations','sales','management') then raise exception 'Role cannot create service tickets' using errcode = '42501'; end if;
    select * into v_installation from private.stockflow_equipment_installations where id=(p_payload->>'installationId')::uuid and status='completed';
    if not found then raise exception 'Installed equipment was not found' using errcode = '22023'; end if;
    v_summary := btrim(coalesce(p_payload->>'summary',''));
    if char_length(v_summary) not between 3 and 500 then raise exception 'Service summary must be 3 to 500 characters' using errcode = '22023'; end if;
    if coalesce(p_payload->>'category','') not in ('breakdown','preventive_maintenance','calibration','training','other') or coalesce(p_payload->>'priority','') not in ('normal','high','urgent') then raise exception 'Invalid service category or priority' using errcode = '22023'; end if;
    insert into private.stockflow_service_tickets(installation_id,order_id,category,priority,summary,created_by_email)
    values(v_installation.id,v_installation.order_id,p_payload->>'category',p_payload->>'priority',v_summary,v_email) returning * into v_ticket;
    insert into private.stockflow_service_ticket_events(ticket_id,event_type,actor_email,metadata)
    values(v_ticket.id,'opened',v_email,jsonb_build_object('summary',v_summary,'priority',v_ticket.priority,'requestId',v_key));
  else
    if v_role not in ('administrator','operations','management') then raise exception 'Role cannot resolve service tickets' using errcode = '42501'; end if;
    v_resolution := btrim(coalesce(p_payload->>'resolution',''));
    if char_length(v_resolution) not between 3 and 1000 then raise exception 'Resolution must be 3 to 1000 characters' using errcode = '22023'; end if;
    select * into v_ticket from private.stockflow_service_tickets where id=(p_payload->>'ticketId')::uuid for update;
    if not found then raise exception 'Service ticket was not found' using errcode = '22023'; end if;
    if v_ticket.version <> (p_payload->>'expectedVersion')::integer then raise exception 'Service ticket has changed; refresh before trying again' using errcode = '40001'; end if;
    if v_ticket.status <> 'open' then raise exception 'Service ticket is already resolved' using errcode = '22023'; end if;
    update private.stockflow_service_tickets set status='resolved',resolution=v_resolution,resolved_by_email=v_email,resolved_at=now(),updated_at=now(),version=version+1 where id=v_ticket.id returning * into v_ticket;
    insert into private.stockflow_service_ticket_events(ticket_id,event_type,actor_email,metadata)
    values(v_ticket.id,'resolved',v_email,jsonb_build_object('resolution',v_resolution,'requestId',v_key));
  end if;
  v_result := jsonb_build_object('ok',true,'ticketId',v_ticket.id,'ticketNumber',v_ticket.ticket_number,'status',v_ticket.status,'version',v_ticket.version);
  perform private.finish_stockflow_command(v_email,p_action,v_key,p_payload,v_ticket.id,v_result);
  return v_result;
end $$;

revoke all on function public.stockflow_service_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_service_gateway(text,text,text,jsonb) to service_role;
