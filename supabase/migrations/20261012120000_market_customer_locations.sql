begin;

create table private.stockflow_customer_locations (
  id uuid primary key default extensions.gen_random_uuid(),
  customer_id uuid not null unique references private.stockflow_customers(id) on delete restrict,
  latitude numeric(9,6) not null check (latitude between -90 and 90),
  longitude numeric(9,6) not null check (longitude between -180 and 180),
  source text not null check (source in ('manual_pin','pasted_link')),
  version integer not null default 1 check (version > 0),
  created_by_email text not null,
  created_at timestamptz not null default now(),
  updated_by_email text not null,
  updated_at timestamptz not null default now(),
  check (not (latitude = 0 and longitude = 0))
);
create table private.stockflow_customer_location_events (
  id uuid primary key default extensions.gen_random_uuid(),
  location_id uuid not null references private.stockflow_customer_locations(id) on delete restrict,
  customer_id uuid not null,
  event_type text not null check (event_type in ('placed','moved')),
  old_latitude numeric(9,6),
  old_longitude numeric(9,6),
  new_latitude numeric(9,6) not null,
  new_longitude numeric(9,6) not null,
  source text not null,
  actor_email text not null,
  request_id text not null,
  created_at timestamptz not null default now()
);
create index stockflow_customer_location_events_customer_idx on private.stockflow_customer_location_events(customer_id,created_at desc);
alter table private.stockflow_customer_locations enable row level security;
alter table private.stockflow_customer_location_events enable row level security;
revoke all on private.stockflow_customer_locations,private.stockflow_customer_location_events from public,anon,authenticated;
create trigger stockflow_customer_locations_no_delete before delete on private.stockflow_customer_locations for each row execute function private.prevent_business_delete();
create trigger stockflow_customer_location_events_immutable before update or delete on private.stockflow_customer_location_events for each row execute function private.prevent_order_event_mutation();

create function public.stockflow_market_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, private, extensions as $$
declare
  v_email text := lower(btrim(coalesce(p_actor_email,''))); v_role text; v_roles text[]; v_hash text;
  v_location private.stockflow_customer_locations%rowtype;
  v_old_latitude numeric(9,6); v_old_longitude numeric(9,6); v_event_type text;
  v_customer uuid; v_latitude numeric(9,6); v_longitude numeric(9,6); v_source text;
  v_expected integer; v_key text; v_replay jsonb; v_result jsonb;
  v_search text; v_page integer := 1; v_total bigint;
begin
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_hash then raise exception 'Unauthorized gateway' using errcode='42501'; end if;
  select role, roles into v_role, v_roles from public.stockflow_members where email = v_email and status = 'active';
  if not private.stockflow_valid_roles(v_roles) or not (v_roles && array['administrator','management']::text[]) then raise exception 'Market access requires administrator or management' using errcode='42501'; end if;
  if p_action is null or p_action not in ('get_customer_locations','set_customer_location') then raise exception 'Unsupported market action' using errcode='22023'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid market payload' using errcode='22023'; end if;

  if p_action='get_customer_locations' then
    if (p_payload ? 'search' and jsonb_typeof(p_payload->'search') is distinct from 'string')
      or char_length(coalesce(p_payload->>'search',''))>120 then raise exception 'Invalid market search' using errcode='22023'; end if;
    v_search:=lower(coalesce(p_payload->>'search',''));
    if p_payload ? 'page' then
      if jsonb_typeof(p_payload->'page') is distinct from 'number' or (p_payload->>'page') !~ '^[0-9]+$' then raise exception 'Invalid market page' using errcode='22023'; end if;
      begin v_page:=(p_payload->>'page')::integer;
      exception when numeric_value_out_of_range then raise exception 'Invalid market page' using errcode='22023'; end;
      if v_page<1 then raise exception 'Invalid market page' using errcode='22023'; end if;
    end if;
    select count(*) into v_total from private.stockflow_customers c where c.active
      and (strpos(lower(c.name),v_search)>0 or strpos(lower(coalesce(c.city,'')),v_search)>0);
    return jsonb_build_object('customers',coalesce((select jsonb_agg(r.customer order by r.name,r.id) from (
      select c.name,c.id,jsonb_build_object('id',c.id,'name',c.name,'city',c.city,'tallyKey',c.tally_key,
        'location',case when l.id is null then null else jsonb_build_object(
          'latitude',l.latitude::text,'longitude',l.longitude::text,'source',l.source,'version',l.version,
          'updatedAt',l.updated_at,'updatedBy',l.updated_by_email) end) as customer
      from private.stockflow_customers c left join private.stockflow_customer_locations l on l.customer_id=c.id
      where c.active and (strpos(lower(c.name),v_search)>0 or strpos(lower(coalesce(c.city,'')),v_search)>0)
      order by c.name,c.id limit 50 offset (v_page::bigint-1)*50
    ) r),'[]'::jsonb),'page',jsonb_build_object('page',v_page,'pageSize',50,'total',v_total));
  end if;

  v_key:=p_payload->>'idempotencyKey';
  if jsonb_typeof(p_payload->'idempotencyKey') is distinct from 'string' or char_length(v_key)>200 then raise exception 'Invalid idempotency key' using errcode='22023'; end if;
  v_replay:=private.begin_stockflow_command(v_email,p_action,v_key,p_payload);
  if v_replay is not null then return v_replay; end if;
  if jsonb_typeof(p_payload->'latitude') is distinct from 'string' or jsonb_typeof(p_payload->'longitude') is distinct from 'string'
    or (p_payload->>'latitude') !~ '^-?[0-9]{1,3}(\.[0-9]{1,6})?$'
    or (p_payload->>'longitude') !~ '^-?[0-9]{1,3}(\.[0-9]{1,6})?$' then raise exception 'Invalid coordinates' using errcode='22023'; end if;
  v_latitude:=(p_payload->>'latitude')::numeric; v_longitude:=(p_payload->>'longitude')::numeric;
  if v_latitude not between -90 and 90 or v_longitude not between -180 and 180 or (v_latitude=0 and v_longitude=0) then raise exception 'Invalid coordinates' using errcode='22023'; end if;
  v_source:=p_payload->>'source';
  if v_source is null or v_source not in ('manual_pin','pasted_link') then raise exception 'Invalid location source' using errcode='22023'; end if;
  if jsonb_typeof(p_payload->'customerId') is distinct from 'string'
    or (p_payload->>'customerId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Active customer required' using errcode='22023'; end if;
  v_customer:=(p_payload->>'customerId')::uuid;
  if not exists(select 1 from private.stockflow_customers where id=v_customer and active) then raise exception 'Active customer required' using errcode='22023'; end if;
  if p_payload->'expectedVersion' is not null and p_payload->'expectedVersion'<>'null'::jsonb then
    if jsonb_typeof(p_payload->'expectedVersion') is distinct from 'number' or (p_payload->>'expectedVersion') !~ '^[0-9]+$' then raise exception 'Invalid expected version' using errcode='22023'; end if;
    begin v_expected:=(p_payload->>'expectedVersion')::integer;
    exception when numeric_value_out_of_range then raise exception 'Invalid expected version' using errcode='22023'; end;
    if v_expected<1 then raise exception 'Invalid expected version' using errcode='22023'; end if;
  end if;
  select * into v_location from private.stockflow_customer_locations where customer_id=v_customer for update;
  if not found then
    if v_expected is not null then raise exception 'Location changed; refresh and try again' using errcode='PT409'; end if;
    begin
      insert into private.stockflow_customer_locations(customer_id,latitude,longitude,source,created_by_email,updated_by_email)
        values(v_customer,v_latitude,v_longitude,v_source,v_email,v_email) returning * into v_location;
    exception when unique_violation then raise exception 'Location changed; refresh and try again' using errcode='PT409'; end;
    v_event_type:='placed';
  else
    if v_expected is distinct from v_location.version then raise exception 'Location changed; refresh and try again' using errcode='PT409'; end if;
    v_old_latitude:=v_location.latitude; v_old_longitude:=v_location.longitude;
    update private.stockflow_customer_locations set latitude=v_latitude,longitude=v_longitude,source=v_source,
      updated_by_email=v_email,updated_at=now(),version=version+1 where id=v_location.id returning * into v_location;
    v_event_type:='moved';
  end if;
  insert into private.stockflow_customer_location_events(location_id,customer_id,event_type,old_latitude,old_longitude,new_latitude,new_longitude,source,actor_email,request_id)
    values(v_location.id,v_customer,v_event_type,v_old_latitude,v_old_longitude,v_location.latitude,v_location.longitude,v_source,v_email,v_key);
  v_result:=jsonb_build_object('ok',true,'customerId',v_customer,'location',jsonb_build_object(
    'latitude',v_location.latitude::text,'longitude',v_location.longitude::text,'source',v_location.source,'version',v_location.version));
  perform private.finish_stockflow_command(v_email,p_action,v_key,p_payload,v_location.id,v_result);
  return v_result;
end $$;
revoke all on function public.stockflow_market_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_market_gateway(text,text,text,jsonb) to service_role;

commit;
