begin;

create table private.stockflow_visit_checkins (
  id uuid primary key default extensions.gen_random_uuid(),
  customer_id uuid not null references private.stockflow_customers(id),
  checked_in_by text not null,
  checked_in_at timestamptz not null default now(),
  latitude numeric(9,6) not null check (latitude between 15.4 and 18.6),
  longitude numeric(9,6) not null check (longitude between 75.0 and 77.9),
  accuracy_m int not null check (accuracy_m between 1 and 5000),
  distance_m int,
  verified boolean not null,
  visit_id uuid references private.stockflow_customer_visits(id),
  request_id text not null
);
create unique index stockflow_visit_checkins_request_idx on private.stockflow_visit_checkins(checked_in_by,request_id);
create index stockflow_visit_checkins_customer_idx on private.stockflow_visit_checkins(customer_id,checked_in_at desc);
alter table private.stockflow_visit_checkins enable row level security;
revoke all on private.stockflow_visit_checkins from public,anon,authenticated;

-- Called only after the accounts gateway authenticates its key and active roles.
create function private.stockflow_check_in(p_actor text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,private,extensions as $$
declare
  c private.stockflow_visit_checkins%rowtype;
  pin private.stockflow_customer_locations%rowtype;
  customer uuid; lat numeric; lng numeric; accuracy numeric; distance int;
begin
  if jsonb_typeof(p_payload) is distinct from 'object'
    or p_payload-array['customerId','latitude','longitude','accuracyM','requestId']<>'{}'::jsonb
    or jsonb_typeof(p_payload->'customerId') is distinct from 'string'
    or (p_payload->>'customerId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(p_payload->'requestId') is distinct from 'string'
    or char_length(btrim(p_payload->>'requestId')) not between 1 and 200
    or (p_payload->>'requestId')<>btrim(p_payload->>'requestId')
    or coalesce(jsonb_typeof(p_payload->'latitude'),'null') not in ('number','string')
    or coalesce(jsonb_typeof(p_payload->'longitude'),'null') not in ('number','string')
    or (p_payload->>'latitude') !~ '^-?[0-9]{1,3}(\.[0-9]+)?$'
    or (p_payload->>'longitude') !~ '^-?[0-9]{1,3}(\.[0-9]+)?$'
    or jsonb_typeof(p_payload->'accuracyM') is distinct from 'number' then
    raise exception 'Invalid check-in payload' using errcode='22023';
  end if;
  lat:=(p_payload->>'latitude')::numeric; lng:=(p_payload->>'longitude')::numeric;
  accuracy:=(p_payload->>'accuracyM')::numeric;
  if accuracy<>trunc(accuracy) or accuracy not between 1 and 5000 then
    raise exception 'Invalid GPS accuracy' using errcode='22023';end if;
  -- No market predicate exists in set_location. Match MARKET_AREA and its UI message.
  if lat not between 15.4 and 18.6 or lng not between 75.0 and 77.9 then
    raise exception 'This pin is outside the five-district market area (Kalaburagi, Bidar, Raichur, Yadgir, Bijapur). Check the link before saving.' using errcode='22023';
  end if;
  -- Serialize duplicate requests even when they name different customers.
  perform pg_advisory_xact_lock(hashtextextended('visit-checkin:'||p_actor||':'||(p_payload->>'requestId'),0));
  select * into c from private.stockflow_visit_checkins
    where checked_in_by=p_actor and request_id=p_payload->>'requestId';
  if not found then
    customer:=(p_payload->>'customerId')::uuid;
    -- Same customer lock as set_location and log_visit: the pin is a stable snapshot.
    perform 1 from private.stockflow_customers where id=customer and active for update;
    if not found then raise exception 'Active customer required' using errcode='22023';end if;
    select * into pin from private.stockflow_customer_locations where customer_id=customer and precision='pin';
    lat:=round(lat,6); lng:=round(lng,6);
    if found then
      distance:=round(6371000 * 2 * asin(sqrt(least(1.0,
        power(sin(radians((lat-pin.latitude)::double precision)/2),2)
        +cos(radians(lat::double precision))*cos(radians(pin.latitude::double precision))
        *power(sin(radians((lng-pin.longitude)::double precision)/2),2)))))::int;
    end if;
    insert into private.stockflow_visit_checkins(customer_id,checked_in_by,latitude,longitude,accuracy_m,distance_m,verified,request_id)
      values(customer,p_actor,lat,lng,accuracy::int,distance,coalesce(distance<=150 and accuracy<=100,false),p_payload->>'requestId')
      returning * into c;
  end if;
  return jsonb_build_object('checkinId',c.id,'checkedInAt',c.checked_in_at,'verified',c.verified,
    'distanceM',c.distance_m,'hasPin',c.distance_m is not null);
end$$;
revoke all on function private.stockflow_check_in(text,jsonb) from public,anon,authenticated,service_role;

-- A linked check-in is projected with privacy at the database read boundary.
create function private.stockflow_visit_checkin_read(p_visit uuid,p_actor text,p_roles text[]) returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
  select jsonb_build_object('verified',c.verified,'distanceM',c.distance_m,'checkedInAt',c.checked_in_at)
    ||case when c.checked_in_by=p_actor or p_roles&&array['administrator','management']::text[]
      then jsonb_build_object('latitude',c.latitude::text,'longitude',c.longitude::text) else '{}'::jsonb end
  from private.stockflow_visit_checkins c where c.visit_id=p_visit
  order by c.checked_in_at desc,c.id desc limit 1
$$;
revoke all on function private.stockflow_visit_checkin_read(uuid,text,text[]) from public,anon,authenticated,service_role;

-- Every anchor is taken from pg_get_functiondef in local replay. Refuse drift.
do $patch$
declare definition text; old_text text; new_text text;
begin
  definition:=replace(pg_get_functiondef('public.stockflow_accounts_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'');
  old_text:=$old$'set_location','log_visit'$old$;
  new_text:=$new$'set_location','log_visit','check_in'$new$;
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected accounts action anchor';end if;
  definition:=replace(definition,old_text,new_text);
  old_text:=$old$    raise exception 'Accounts access required' using errcode='42501';$old$;
  new_text:=$new$    if p_action='check_in' then raise exception 'Accounts access required' using errcode='PT403';end if;
    raise exception 'Accounts access required' using errcode='42501';$new$;
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected accounts role anchor';end if;
  definition:=replace(definition,old_text,new_text);
  old_text:=$old$  if p_action='get_accounts' then$old$;
  new_text:=$new$  if p_action='check_in' then return private.stockflow_check_in(v_email,p_payload);end if;
  if p_action='get_accounts' then$new$;
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected accounts dispatch anchor';end if;
  definition:=replace(definition,old_text,new_text);
  old_text:=$old$        values(v_customer,v_visited,v_email,v_outcome,v_note,v_next,v_key) returning id into v_id;$old$;
  new_text:=$new$        values(v_customer,v_visited,v_email,v_outcome,v_note,v_next,v_key) returning id into v_id;
      update private.stockflow_visit_checkins set visit_id=v_id where id=(
        select id from private.stockflow_visit_checkins
        where customer_id=v_customer and checked_in_by=v_email and visit_id is null
          and (checked_in_at at time zone 'Asia/Kolkata')::date=v_visited
        order by checked_in_at desc,id desc limit 1 for update);$new$;
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected log_visit insert anchor';end if;
  definition:=replace(definition,old_text,new_text);
  old_text:=$old$'outcome',visit.outcome,'visitedBy',visit.visited_by,'note',visit.note,$old$;
  new_text:=$new$'outcome',visit.outcome,'visitedBy',visit.visited_by,'note',visit.note,
          'checkin',private.stockflow_visit_checkin_read(visit.id,v_email,v_roles),$new$;
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected accounts visit read anchor';end if;
  definition:=replace(definition,old_text,new_text);
  execute definition;

  definition:=replace(pg_get_functiondef('public.stockflow_customer_map_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'');
  old_text:=$old$select jsonb_build_object('visitedOn',v.visited_on,'visitedBy',v.visited_by,'outcome',v.outcome) into v_data$old$;
  new_text:=$new$select jsonb_build_object('visitedOn',v.visited_on,'visitedBy',v.visited_by,'outcome',v.outcome,
  'checkin',private.stockflow_visit_checkin_read(v.id,v_actor,v_roles)) into v_data$new$;
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected map visit read anchor';end if;
  definition:=replace(definition,old_text,new_text);
  execute definition;
end $patch$;
revoke all on function public.stockflow_accounts_gateway(text,text,text,jsonb),
  public.stockflow_customer_map_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_accounts_gateway(text,text,text,jsonb),
  public.stockflow_customer_map_gateway(text,text,text,jsonb) to service_role;
commit;
notify pgrst,'reload schema';
