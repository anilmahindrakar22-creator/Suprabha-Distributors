begin;

create table private.stockflow_territories (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null check (name=btrim(name) and char_length(name) between 2 and 80),
  active boolean not null default true,
  created_by text not null,
  created_at timestamptz not null default now()
);
create unique index stockflow_territories_name_idx on private.stockflow_territories(lower(name));

create table private.stockflow_customer_assignments (
  id uuid primary key default extensions.gen_random_uuid(),
  customer_id uuid not null references private.stockflow_customers(id),
  owner_email text not null,
  territory_id uuid not null references private.stockflow_territories(id),
  effective_from date not null,
  effective_to date check (effective_to is null or effective_to>=effective_from),
  version integer not null check (version>0),
  created_by text not null,
  created_at timestamptz not null default now()
);
create unique index stockflow_customer_assignments_open_idx on private.stockflow_customer_assignments(customer_id) where effective_to is null;
create index stockflow_customer_assignments_owner_idx on private.stockflow_customer_assignments(owner_email,customer_id) where effective_to is null;
create index stockflow_customer_assignments_territory_idx on private.stockflow_customer_assignments(territory_id,customer_id) where effective_to is null;

create function private.close_stockflow_customer_assignment() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if old.effective_to is not null or new.effective_to is null
    or (to_jsonb(new)-'effective_to') is distinct from (to_jsonb(old)-'effective_to') then
    raise exception 'Assignment history can only be closed once' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function private.close_stockflow_customer_assignment() from public,anon,authenticated;
create trigger stockflow_customer_assignments_close_only before update on private.stockflow_customer_assignments
  for each row execute function private.close_stockflow_customer_assignment();

create table private.stockflow_customer_locations (
  id uuid primary key default extensions.gen_random_uuid(),
  customer_id uuid not null unique references private.stockflow_customers(id),
  precision text not null check (precision in ('pin','town')),
  latitude numeric(9,6), longitude numeric(9,6), town text,
  source text not null check (source in ('manual_pin','pasted_link','town')),
  verified_by text not null,
  verified_at timestamptz not null default now(),
  version integer not null default 1 check (version>0),
  check ((precision='pin' and latitude is not null and longitude is not null
      and latitude between -90 and 90 and longitude between -180 and 180 and not (latitude=0 and longitude=0)
      and town is null and source in ('manual_pin','pasted_link'))
    or (precision='town' and town is not null and town=btrim(town) and char_length(town) between 2 and 80
      and latitude is null and longitude is null and source='town'))
);
create table private.stockflow_customer_location_events (
  id uuid primary key default extensions.gen_random_uuid(),
  location_id uuid not null references private.stockflow_customer_locations(id),
  customer_id uuid not null references private.stockflow_customers(id),
  event_type text not null check (event_type in ('placed','moved')),
  old_values jsonb,
  new_values jsonb not null,
  actor_email text not null,
  request_id text not null,
  created_at timestamptz not null default now()
);
create index stockflow_customer_location_events_customer_idx on private.stockflow_customer_location_events(customer_id,created_at desc);

create table private.stockflow_customer_visits (
  id uuid primary key default extensions.gen_random_uuid(),
  customer_id uuid not null references private.stockflow_customers(id),
  visited_on date not null,
  visited_by text not null,
  outcome text not null check (outcome in ('met','not_available','order_taken','issue_raised','other')),
  note text check (note is null or char_length(note)<=500),
  next_visit_on date check (next_visit_on is null or next_visit_on>visited_on),
  request_id text not null,
  created_at timestamptz not null default now()
);
create index stockflow_customer_visits_customer_idx on private.stockflow_customer_visits(customer_id,visited_on desc,created_at desc,id desc);
-- This index already exists on current installations; keep clean installs safe.
create index if not exists stockflow_orders_customer_created_idx on private.stockflow_orders(customer_id,created_at desc);

alter table private.stockflow_territories enable row level security;
alter table private.stockflow_customer_assignments enable row level security;
alter table private.stockflow_customer_locations enable row level security;
alter table private.stockflow_customer_location_events enable row level security;
alter table private.stockflow_customer_visits enable row level security;
revoke all on private.stockflow_territories,private.stockflow_customer_assignments,private.stockflow_customer_locations,
  private.stockflow_customer_location_events,private.stockflow_customer_visits from public,anon,authenticated;
create trigger stockflow_territories_no_delete before delete on private.stockflow_territories for each row execute function private.prevent_business_delete();
create trigger stockflow_customer_assignments_no_delete before delete on private.stockflow_customer_assignments for each row execute function private.prevent_business_delete();
create trigger stockflow_customer_locations_no_delete before delete on private.stockflow_customer_locations for each row execute function private.prevent_business_delete();
create trigger stockflow_customer_location_events_no_delete before delete on private.stockflow_customer_location_events for each row execute function private.prevent_business_delete();
create trigger stockflow_customer_visits_no_delete before delete on private.stockflow_customer_visits for each row execute function private.prevent_business_delete();
create trigger stockflow_customer_location_events_immutable before update or delete on private.stockflow_customer_location_events for each row execute function private.prevent_order_event_mutation();
create trigger stockflow_customer_visits_immutable before update or delete on private.stockflow_customer_visits for each row execute function private.prevent_order_event_mutation();

create function public.stockflow_accounts_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,extensions as $$
declare
  v_email text:=lower(btrim(coalesce(p_actor_email,''))); v_role text; v_roles text[]; v_hash text;
  v_today date:=(now() at time zone 'Asia/Kolkata')::date;
  v_uuid_pattern constant text:='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_search text; v_scope text; v_owner text; v_territory uuid; v_page integer:=1;
  v_key text; v_replay jsonb; v_result jsonb; v_id uuid; v_customer uuid; v_expected integer;
  v_name text; v_precision text; v_source text; v_town text; v_latitude numeric(9,6); v_longitude numeric(9,6);
  v_assignment private.stockflow_customer_assignments%rowtype;
  v_location private.stockflow_customer_locations%rowtype; v_old_values jsonb;
  v_visited date; v_next date; v_outcome text; v_note text;
begin
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_hash then
    raise exception 'Unauthorized gateway' using errcode='42501';
  end if;
  select role,roles into v_role,v_roles from public.stockflow_members where email=v_email and status='active';
  if not coalesce(private.stockflow_valid_roles(v_roles),false)
    or not coalesce(v_roles && array['administrator','management','sales','operations']::text[],false) then
    raise exception 'Accounts access required' using errcode='42501';
  end if;
  if p_action is null or p_action not in ('get_accounts','create_territory','assign_account','set_location','log_visit') then
    raise exception 'Unsupported accounts action' using errcode='22023';
  end if;
  if p_action in ('create_territory','assign_account') and not (v_roles && array['administrator','management']::text[]) then
    raise exception 'Management approval required' using errcode='42501';
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid accounts payload' using errcode='22023'; end if;

  if p_action='get_accounts' then
    if (p_payload ? 'search' and jsonb_typeof(p_payload->'search') is distinct from 'string')
      or char_length(coalesce(p_payload->>'search',''))>120 then raise exception 'Invalid accounts search' using errcode='22023'; end if;
    v_search:=lower(coalesce(p_payload->>'search',''));
    v_scope:=coalesce(p_payload->>'scope','all');
    if (p_payload ? 'scope' and jsonb_typeof(p_payload->'scope') is distinct from 'string') or v_scope not in ('mine','all') then
      raise exception 'Invalid accounts scope' using errcode='22023'; end if;
    if p_payload ? 'ownerEmail' then
      if jsonb_typeof(p_payload->'ownerEmail') is distinct from 'string' or char_length(p_payload->>'ownerEmail')>254
        or btrim(p_payload->>'ownerEmail') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
        raise exception 'Invalid owner email' using errcode='22023'; end if;
      v_owner:=lower(btrim(p_payload->>'ownerEmail'));
    end if;
    if p_payload ? 'territoryId' then
      if jsonb_typeof(p_payload->'territoryId') is distinct from 'string' or (p_payload->>'territoryId') !~* v_uuid_pattern then
        raise exception 'Invalid territory' using errcode='22023'; end if;
      v_territory:=(p_payload->>'territoryId')::uuid;
    end if;
    if p_payload ? 'page' then
      if jsonb_typeof(p_payload->'page') is distinct from 'number' or (p_payload->>'page') !~ '^[0-9]+$' then
        raise exception 'Invalid accounts page' using errcode='22023'; end if;
      begin v_page:=(p_payload->>'page')::integer;
      exception when numeric_value_out_of_range then raise exception 'Invalid accounts page' using errcode='22023'; end;
      if v_page<1 then raise exception 'Invalid accounts page' using errcode='22023'; end if;
    end if;
    -- Only latest-visit sort keys are needed before pagination. Detail/order
    -- lateral lookups below run for the selected page, never the whole book.
    with filtered as materialized (
      select c.id,c.name,c.city,a.owner_email,a.territory_id,a.effective_from,a.version as assignment_version
      from private.stockflow_customers c
      left join private.stockflow_customer_assignments a on a.customer_id=c.id and a.effective_to is null
      where c.active and (strpos(lower(c.name),v_search)>0 or strpos(lower(coalesce(c.city,'')),v_search)>0)
        and (v_scope<>'mine' or a.owner_email=v_email)
        and (v_owner is null or a.owner_email=v_owner) and (v_territory is null or a.territory_id=v_territory)
    ), latest as (
      select distinct on (v.customer_id) v.customer_id,v.visited_on,v.next_visit_on
      from private.stockflow_customer_visits v join filtered f on f.id=v.customer_id
      order by v.customer_id,v.visited_on desc,v.created_at desc,v.id desc
    ), selected as materialized (
      select f.*,l.visited_on as last_visited_on,l.next_visit_on,
        case when l.next_visit_on<=v_today then l.next_visit_on end as due_on
      from filtered f left join latest l on l.customer_id=f.id
      order by (case when l.next_visit_on<=v_today then l.next_visit_on end) asc nulls last,
        l.visited_on asc nulls first,f.name,f.id
      limit 50 offset (v_page::bigint-1)*50
    )
    select jsonb_build_object('accounts',coalesce((
      select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'city',s.city,
        'owner',case when s.owner_email is null then null else jsonb_build_object('email',s.owner_email,
          'territoryId',s.territory_id,'territoryName',t.name,'since',s.effective_from,'version',s.assignment_version) end,
        'location',case when loc.id is null then null else jsonb_build_object('precision',loc.precision,
          'latitude',loc.latitude::text,'longitude',loc.longitude::text,'town',loc.town,
          'verifiedBy',loc.verified_by,'verifiedAt',loc.verified_at,'version',loc.version) end,
        'lastVisit',case when visit.id is null then null else jsonb_build_object('visitedOn',visit.visited_on,
          'outcome',visit.outcome,'visitedBy',visit.visited_by,'note',visit.note) end,
        'nextVisitOn',s.next_visit_on,'lastOrderOn',ord.last_order_on)
        order by s.due_on asc nulls last,s.last_visited_on asc nulls first,s.name,s.id)
      from selected s left join private.stockflow_territories t on t.id=s.territory_id
      left join private.stockflow_customer_locations loc on loc.customer_id=s.id
      left join lateral (select v.id,v.visited_on,v.outcome,v.visited_by,v.note
        from private.stockflow_customer_visits v where v.customer_id=s.id
        order by v.visited_on desc,v.created_at desc,v.id desc limit 1) visit on true
      left join lateral (select (o.created_at at time zone 'Asia/Kolkata')::date as last_order_on
        from private.stockflow_orders o where o.customer_id=s.id order by o.created_at desc limit 1) ord on true
    ),'[]'::jsonb),'page',jsonb_build_object('page',v_page,'pageSize',50,'total',(select count(*) from filtered)),
      'owners',coalesce((select jsonb_agg(jsonb_build_object('email',m.email,'name',null) order by m.email)
        from public.stockflow_members m where m.status='active' and private.stockflow_valid_roles(m.roles)
          and m.roles && array['sales','management','administrator']::text[]),'[]'::jsonb),
      'territories',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name) order by t.name,t.id)
        from private.stockflow_territories t where t.active),'[]'::jsonb),'today',v_today) into v_result;
    return v_result;
  end if;

  v_key:=p_payload->>'idempotencyKey';
  if jsonb_typeof(p_payload->'idempotencyKey') is distinct from 'string' or char_length(btrim(v_key))<16 or char_length(v_key)>200 then
    raise exception 'A valid idempotency key is required' using errcode='22023'; end if;
  v_replay:=private.begin_stockflow_command(v_email,p_action,v_key,p_payload);
  if v_replay is not null then return v_replay; end if;

  if p_action='create_territory' then
    if jsonb_typeof(p_payload->'name') is distinct from 'string' or char_length(btrim(p_payload->>'name')) not between 2 and 80 then
      raise exception 'Territory name must have 2 to 80 characters' using errcode='22023'; end if;
    v_name:=btrim(p_payload->>'name');
    begin
      insert into private.stockflow_territories(name,created_by) values(v_name,v_email) returning id into v_id;
    exception when unique_violation then raise exception 'Territory already exists' using errcode='PT409'; end;
    v_result:=jsonb_build_object('ok',true,'territory',jsonb_build_object('id',v_id,'name',v_name));
  else
    if jsonb_typeof(p_payload->'customerId') is distinct from 'string' or (p_payload->>'customerId') !~* v_uuid_pattern then
      raise exception 'Active customer required' using errcode='22023'; end if;
    v_customer:=(p_payload->>'customerId')::uuid;
    -- Also serializes first assignment/location writes, where no child row exists.
    perform 1 from private.stockflow_customers where id=v_customer and active for update;
    if not found then raise exception 'Active customer required' using errcode='22023'; end if;
    if p_action in ('assign_account','set_location') then
      if not (p_payload ? 'expectedVersion') then raise exception 'Expected version is required' using errcode='22023'; end if;
      if p_payload->'expectedVersion'<>'null'::jsonb then
        if jsonb_typeof(p_payload->'expectedVersion') is distinct from 'number' or (p_payload->>'expectedVersion') !~ '^[0-9]+$' then
          raise exception 'Invalid expected version' using errcode='22023'; end if;
        begin v_expected:=(p_payload->>'expectedVersion')::integer;
        exception when numeric_value_out_of_range then raise exception 'Invalid expected version' using errcode='22023'; end;
        if v_expected<1 then raise exception 'Invalid expected version' using errcode='22023'; end if;
      end if;
    end if;

    if p_action='assign_account' then
      if jsonb_typeof(p_payload->'ownerEmail') is distinct from 'string' or char_length(p_payload->>'ownerEmail')>254 then
        raise exception 'Active eligible owner required' using errcode='22023'; end if;
      v_owner:=lower(btrim(p_payload->>'ownerEmail'));
      perform 1 from public.stockflow_members m where m.email=v_owner and m.status='active'
        and private.stockflow_valid_roles(m.roles) and m.roles && array['sales','management','administrator']::text[] for share;
      if not found then raise exception 'Active eligible owner required' using errcode='22023'; end if;
      if jsonb_typeof(p_payload->'territoryId') is distinct from 'string' or (p_payload->>'territoryId') !~* v_uuid_pattern then
        raise exception 'Active territory required' using errcode='22023'; end if;
      v_territory:=(p_payload->>'territoryId')::uuid;
      perform 1 from private.stockflow_territories where id=v_territory and active for share;
      if not found then raise exception 'Active territory required' using errcode='22023'; end if;
      select * into v_assignment from private.stockflow_customer_assignments where customer_id=v_customer and effective_to is null for update;
      if v_expected is distinct from v_assignment.version then raise exception 'Owner changed; refresh and try again' using errcode='PT409'; end if;
      if v_assignment.id is not null then
        update private.stockflow_customer_assignments set effective_to=v_today where id=v_assignment.id;
      end if;
      insert into private.stockflow_customer_assignments(customer_id,owner_email,territory_id,effective_from,version,created_by)
        values(v_customer,v_owner,v_territory,v_today,coalesce(v_assignment.version,0)+1,v_email) returning * into v_assignment;
      v_id:=v_assignment.id;
      v_result:=jsonb_build_object('ok',true,'customerId',v_customer,'owner',jsonb_build_object('email',v_owner,
        'territoryId',v_territory,'territoryName',(select name from private.stockflow_territories where id=v_territory),
        'since',v_today,'version',v_assignment.version));
    elsif p_action='set_location' then
      v_precision:=p_payload->>'precision'; v_source:=p_payload->>'source';
      if v_precision is null or v_precision not in ('pin','town') then raise exception 'Choose pin or town precision' using errcode='22023'; end if;
      if v_precision='pin' then
        if jsonb_typeof(p_payload->'latitude') is distinct from 'string' or jsonb_typeof(p_payload->'longitude') is distinct from 'string'
          or (p_payload->>'latitude') !~ '^-?[0-9]{1,3}(\.[0-9]{1,6})?$' or (p_payload->>'longitude') !~ '^-?[0-9]{1,3}(\.[0-9]{1,6})?$' then
          raise exception 'Invalid coordinates' using errcode='22023'; end if;
        v_latitude:=(p_payload->>'latitude')::numeric; v_longitude:=(p_payload->>'longitude')::numeric;
        if v_latitude not between -90 and 90 or v_longitude not between -180 and 180 or (v_latitude=0 and v_longitude=0)
          or v_source is null or v_source not in ('manual_pin','pasted_link') or (p_payload->>'town') is not null then
          raise exception 'Invalid pin location' using errcode='22023'; end if;
      else
        if jsonb_typeof(p_payload->'town') is distinct from 'string' or char_length(btrim(p_payload->>'town')) not between 2 and 80
          or (p_payload->>'latitude') is not null or (p_payload->>'longitude') is not null or v_source is distinct from 'town' then
          raise exception 'Town requires 2 to 80 characters and no coordinates' using errcode='22023'; end if;
        v_town:=btrim(p_payload->>'town');
      end if;
      select * into v_location from private.stockflow_customer_locations where customer_id=v_customer for update;
      if v_expected is distinct from v_location.version then raise exception 'Location changed; refresh and try again' using errcode='PT409'; end if;
      if v_location.id is null then
        insert into private.stockflow_customer_locations(customer_id,precision,latitude,longitude,town,source,verified_by)
          values(v_customer,v_precision,v_latitude,v_longitude,v_town,v_source,v_email) returning * into v_location;
      else
        v_old_values:=to_jsonb(v_location);
        update private.stockflow_customer_locations set precision=v_precision,latitude=v_latitude,longitude=v_longitude,
          town=v_town,source=v_source,verified_by=v_email,verified_at=now(),version=version+1
          where id=v_location.id returning * into v_location;
      end if;
      insert into private.stockflow_customer_location_events(location_id,customer_id,event_type,old_values,new_values,actor_email,request_id)
        values(v_location.id,v_customer,case when v_old_values is null then 'placed' else 'moved' end,v_old_values,to_jsonb(v_location),v_email,v_key);
      v_id:=v_location.id;
      v_result:=jsonb_build_object('ok',true,'customerId',v_customer,'location',jsonb_build_object('precision',v_location.precision,
        'latitude',v_location.latitude::text,'longitude',v_location.longitude::text,'town',v_location.town,
        'verifiedBy',v_location.verified_by,'verifiedAt',v_location.verified_at,'version',v_location.version));
    else
      if jsonb_typeof(p_payload->'visitedOn') is distinct from 'string' or (p_payload->>'visitedOn') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'Invalid visit date' using errcode='22023'; end if;
      begin v_visited:=(p_payload->>'visitedOn')::date;
      exception when datetime_field_overflow or invalid_datetime_format then raise exception 'Invalid visit date' using errcode='22023'; end;
      if v_visited not between v_today-30 and v_today then raise exception 'Visit must be within the last 30 days' using errcode='22023'; end if;
      if p_payload ? 'nextVisitOn' and p_payload->'nextVisitOn'<>'null'::jsonb then
        if jsonb_typeof(p_payload->'nextVisitOn') is distinct from 'string' or (p_payload->>'nextVisitOn') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
          raise exception 'Invalid next visit date' using errcode='22023'; end if;
        begin v_next:=(p_payload->>'nextVisitOn')::date;
        exception when datetime_field_overflow or invalid_datetime_format then raise exception 'Invalid next visit date' using errcode='22023'; end;
        if v_next<=v_visited or v_next>v_today+180 then raise exception 'Next visit must follow the visit and be within 180 days' using errcode='22023'; end if;
      end if;
      v_outcome:=p_payload->>'outcome';
      if v_outcome is null or v_outcome not in ('met','not_available','order_taken','issue_raised','other') then
        raise exception 'Invalid visit outcome' using errcode='22023'; end if;
      if p_payload ? 'note' and p_payload->'note'<>'null'::jsonb and (jsonb_typeof(p_payload->'note') is distinct from 'string' or char_length(p_payload->>'note')>500) then
        raise exception 'Visit note must have at most 500 characters' using errcode='22023'; end if;
      v_note:=p_payload->>'note';
      insert into private.stockflow_customer_visits(customer_id,visited_on,visited_by,outcome,note,next_visit_on,request_id)
        values(v_customer,v_visited,v_email,v_outcome,v_note,v_next,v_key) returning id into v_id;
      v_result:=jsonb_build_object('ok',true,'customerId',v_customer,'visitId',v_id);
    end if;
  end if;
  perform private.finish_stockflow_command(v_email,p_action,v_key,p_payload,v_id,v_result);
  return v_result;
exception when unique_violation then
  raise exception 'Account changed; refresh and try again' using errcode='PT409';
end $$;
revoke all on function public.stockflow_accounts_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_accounts_gateway(text,text,text,jsonb) to service_role;

commit;
