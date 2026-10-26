create table private.stockflow_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  member_email text not null,
  endpoint text not null unique check (char_length(endpoint) between 10 and 2048 and endpoint like 'https://%'),
  p256dh text not null,
  auth text not null,
  user_agent text check (char_length(user_agent) <= 200),
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  failure_count integer not null default 0 check (failure_count >= 0)
);
create index stockflow_push_subscriptions_member_idx
  on private.stockflow_push_subscriptions(member_email, created_at, id);

create table private.stockflow_push_deliveries (
  event_id bigint not null references private.stockflow_order_events(id),
  recipient_email text not null,
  endpoint_hash text not null,
  status text not null check (status in ('pending','sent','failed','gone')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text check (char_length(last_error) <= 300),
  sent_at timestamptz,
  claimed_at timestamptz,
  claim_id uuid,
  created_at timestamptz not null default now(),
  primary key (event_id, recipient_email, endpoint_hash)
);

create table private.stockflow_push_config (
  id boolean primary key default true check (id),
  push_enabled boolean not null default false,
  push_starts_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into private.stockflow_push_config(id, push_enabled) values (true, false);

alter table private.stockflow_push_subscriptions enable row level security;
alter table private.stockflow_push_deliveries enable row level security;
alter table private.stockflow_push_config enable row level security;
revoke all on private.stockflow_push_subscriptions, private.stockflow_push_deliveries,
  private.stockflow_push_config from public, anon, authenticated;

create function public.stockflow_push_gateway(
  p_gateway_key text, p_actor_email text, p_action text, p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, private, extensions
as $$
declare
  v_actor text := lower(btrim(coalesce(p_actor_email, '')));
  v_hash text;
  v_roles text[];
  v_endpoint text;
  v_removed integer;
begin
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name = 'orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key, ''), 'sha256'), 'hex') <> v_hash then
    raise exception 'Unauthorized gateway' using errcode = '42501';
  end if;
  select roles into v_roles from public.stockflow_members where email = v_actor and status = 'active';
  if not private.stockflow_valid_roles(v_roles) then
    raise exception 'Active membership required' using errcode = '42501';
  end if;
  if p_action = 'push_config' then
    return jsonb_build_object('enabled', coalesce((select push_enabled and push_starts_at is not null
      from private.stockflow_push_config where id), false));
  end if;
  if p_action is null or p_action not in ('push_subscribe','push_unsubscribe') then
    raise exception 'Unsupported push action' using errcode = '22023';
  end if;
  v_endpoint := p_payload->>'endpoint';
  if jsonb_typeof(p_payload) is distinct from 'object'
     or jsonb_typeof(p_payload->'endpoint') is distinct from 'string'
     or char_length(v_endpoint) not between 10 and 2048
     or v_endpoint !~ '^https://[^/[:space:]?#]+[^[:space:]]*$' then
    raise exception 'Valid HTTPS push endpoint required' using errcode = '22023';
  end if;
  if p_action = 'push_unsubscribe' then
    delete from private.stockflow_push_subscriptions where member_email = v_actor and endpoint = v_endpoint;
    get diagnostics v_removed = row_count;
    return jsonb_build_object('ok', true, 'removed', v_removed);
  end if;
  if jsonb_typeof(p_payload->'keys') is distinct from 'object'
     or jsonb_typeof(p_payload#>'{keys,p256dh}') is distinct from 'string'
     or jsonb_typeof(p_payload#>'{keys,auth}') is distinct from 'string'
     or (p_payload#>>'{keys,p256dh}') !~ '^[A-Za-z0-9_-]{87}=?$'
     or (p_payload#>>'{keys,auth}') !~ '^[A-Za-z0-9_-]{22}(==)?$'
     or (p_payload ? 'userAgent' and (jsonb_typeof(p_payload->'userAgent') is distinct from 'string'
       or char_length(p_payload->>'userAgent') > 200)) then
    raise exception 'Valid push keys and user agent required' using errcode = '22023';
  end if;
  -- Serialize the per-member cap, including concurrent subscriptions on different devices.
  perform pg_advisory_xact_lock(hashtextextended('stockflow_push_subscribe:' || v_actor, 0));
  insert into private.stockflow_push_subscriptions(member_email, endpoint, p256dh, auth, user_agent)
  values (v_actor, v_endpoint, p_payload#>>'{keys,p256dh}', p_payload#>>'{keys,auth}', p_payload->>'userAgent')
  on conflict (endpoint) do update set member_email = excluded.member_email,
    p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent,
    last_success_at = null, last_failure_at = null, failure_count = 0;
  delete from private.stockflow_push_subscriptions s where s.id in (
    select id from private.stockflow_push_subscriptions where member_email = v_actor
    order by created_at desc, id desc offset 10
  );
  return jsonb_build_object('ok', true);
end;
$$;

create function private.stockflow_push_recipients(p_event_id bigint)
returns table(recipient_email text, title text, body text)
language plpgsql stable security definer
set search_path = pg_catalog, private, extensions
as $$
declare
  e private.stockflow_order_events%rowtype;
  o private.stockflow_orders%rowtype;
  m record;
  v_body text;
  v_confirm constant text[] := array['phone_order_received','awaiting_confirmation','awaiting_approval'];
  v_pack constant text[] := array['confirmed','partially_reserved','fully_reserved','ready_for_picking','picked'];
  v_dispatch constant text[] := array['billed_in_tally','ready_for_dispatch'];
begin
  select * into e from private.stockflow_order_events where id = p_event_id;
  if not found then return; end if;
  select * into o from private.stockflow_orders where id = e.order_id;
  if not found then return; end if;
  for m in select email, roles from public.stockflow_members
    where status = 'active' and private.stockflow_valid_roles(roles) order by email loop
    v_body := null;
    if e.event_type = 'order_assignment_changed' then
      if m.email = e.metadata->>'after' then v_body := 'Assigned to you'; end if;
    elsif e.to_status is not null and e.to_status is distinct from e.from_status then
      if e.to_status = any(v_confirm) and not coalesce(e.from_status = any(v_confirm), false)
         and m.roles && array['administrator','management','sales','operations']::text[] then
        v_body := 'New order to confirm';
      elsif e.to_status = any(v_pack) and not coalesce(e.from_status = any(v_pack), false)
         and m.roles && array['warehouse','operations']::text[] then
        v_body := 'Ready to pick & pack';
      elsif e.to_status in ('packed','awaiting_tally_billing') and 'accounts' = any(m.roles) then
        v_body := 'Packed · ready for Tally billing';
      elsif e.to_status = 'awaiting_tally_billing' and 'billing' = any(m.roles) then
        v_body := 'Packed and priced · ready to bill';
      elsif e.to_status = any(v_dispatch) and not coalesce(e.from_status = any(v_dispatch), false)
         and 'operations' = any(m.roles) then
        v_body := 'Billed · ready for dispatch';
      end if;
    end if;
    if v_body is null then continue; end if;
    begin
      perform private.assert_stockflow_order_access(m.email, m.roles, e.order_id);
    exception when others then
      continue;
    end;
    recipient_email := m.email;
    title := o.customer_name || ' · ' || o.order_number;
    body := v_body;
    return next;
  end loop;
end;
$$;

-- Sender contract: due returns claim_id; every record result must include claimId.
-- Claims expire after two minutes; a consumed or superseded claim cannot record again.
create function private.stockflow_push_due(p_limit integer default 200)
returns table(event_id bigint, recipient_email text, endpoint text, p256dh text, auth text,
  endpoint_hash text, title text, body text, order_id uuid, order_number text, claim_id uuid)
language plpgsql volatile security definer
set search_path = pg_catalog, private, extensions
as $$
declare
  v_claim_id uuid := gen_random_uuid();
begin
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'Push limit must be between 1 and 1000' using errcode = '22023';
  end if;
  return query
  with candidates as materialized (
    select e.id as event_id, r.recipient_email, s.endpoint, s.p256dh, s.auth,
      encode(extensions.digest(s.endpoint, 'sha256'), 'hex') as endpoint_hash,
      r.title, r.body, o.id as order_id, o.order_number, e.created_at
    from private.stockflow_push_config c
    join private.stockflow_order_events e on e.created_at >= c.push_starts_at
      and e.created_at >= now() - interval '24 hours'
    join private.stockflow_orders o on o.id = e.order_id
    cross join lateral private.stockflow_push_recipients(e.id) r
    join private.stockflow_push_subscriptions s on s.member_email = r.recipient_email
    where c.id and c.push_enabled and c.push_starts_at is not null
      and not exists (
        select 1 from private.stockflow_push_deliveries d
        where d.event_id = e.id and d.recipient_email = r.recipient_email
          and d.endpoint_hash = encode(extensions.digest(s.endpoint, 'sha256'), 'hex')
          and (d.status in ('sent','gone') or (d.status = 'failed' and d.attempts >= 5)
            or (d.status = 'pending' and d.claimed_at > now() - interval '2 minutes'))
      )
    order by e.created_at, e.id, r.recipient_email, s.endpoint
    limit p_limit
  ), claimed as (
    insert into private.stockflow_push_deliveries as d
      (event_id, recipient_email, endpoint_hash, status, claimed_at, claim_id)
    select c.event_id, c.recipient_email, c.endpoint_hash, 'pending', now(), v_claim_id
    from candidates c order by c.created_at, c.event_id, c.recipient_email, c.endpoint
    on conflict on constraint stockflow_push_deliveries_pkey do update
      set status = 'pending', claimed_at = excluded.claimed_at, claim_id = excluded.claim_id
      where (d.status = 'failed' and d.attempts < 5)
        or (d.status = 'pending' and (d.claimed_at is null or d.claimed_at <= now() - interval '2 minutes'))
    returning d.event_id, d.recipient_email, d.endpoint_hash, d.claim_id
  )
  select c.event_id, c.recipient_email, c.endpoint, c.p256dh, c.auth, c.endpoint_hash,
    c.title, c.body, c.order_id, c.order_number, d.claim_id
  from candidates c join claimed d on d.event_id = c.event_id
    and d.recipient_email = c.recipient_email and d.endpoint_hash = c.endpoint_hash
  order by c.created_at, c.event_id, c.recipient_email, c.endpoint;
end;
$$;

create function private.stockflow_push_record(p_results jsonb)
returns void language plpgsql security definer
set search_path = pg_catalog, private, extensions
as $$
declare
  r jsonb;
  v_event bigint;
  v_email text;
  v_hash text;
  v_outcome text;
  v_claim_id uuid;
  v_changed integer;
begin
  if jsonb_typeof(p_results) is distinct from 'array' then
    raise exception 'Push results must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_results) > 1000 then
    raise exception 'Too many push results' using errcode = '22023';
  end if;
  for r in select value from jsonb_array_elements(p_results) loop
    v_email := r->>'recipientEmail';
    v_hash := r->>'endpointHash';
    v_outcome := r->>'outcome';
    if jsonb_typeof(r) is distinct from 'object'
       or coalesce(r->>'eventId', '') !~ '^[1-9][0-9]*$'
       or jsonb_typeof(r->'recipientEmail') is distinct from 'string'
       or coalesce(v_email, '') = '' or v_email <> lower(btrim(v_email))
       or coalesce(v_hash, '') !~ '^[a-f0-9]{64}$'
       or jsonb_typeof(r->'claimId') is distinct from 'string'
       or v_outcome is null or v_outcome not in ('sent','failed','gone')
       or (r ? 'error' and jsonb_typeof(r->'error') is distinct from 'string') then
      raise exception 'Invalid push result' using errcode = '22023';
    end if;
    begin
      v_event := (r->>'eventId')::bigint;
      v_claim_id := (r->>'claimId')::uuid;
    exception when numeric_value_out_of_range or invalid_text_representation then
      raise exception 'Invalid push event or claim' using errcode = '22023';
    end;
    update private.stockflow_push_deliveries d
      set status = v_outcome, attempts = d.attempts + 1,
        last_error = case when v_outcome = 'sent' then null else left(r->>'error', 300) end,
        sent_at = case when v_outcome = 'sent' then now() end
      where d.event_id = v_event and d.recipient_email = v_email and d.endpoint_hash = v_hash
        and d.status = 'pending' and d.claim_id = v_claim_id;
    get diagnostics v_changed = row_count;
    -- Only the first result for the current claim can change delivery/subscription state.
    if v_changed = 0 then continue; end if;
    if v_outcome = 'gone' then
      delete from private.stockflow_push_subscriptions s where s.member_email = v_email
        and encode(extensions.digest(s.endpoint, 'sha256'), 'hex') = v_hash;
    elsif v_outcome = 'failed' then
      update private.stockflow_push_subscriptions s
      set failure_count = s.failure_count + 1, last_failure_at = now()
      where s.member_email = v_email and encode(extensions.digest(s.endpoint, 'sha256'), 'hex') = v_hash;
    else
      update private.stockflow_push_subscriptions s set last_success_at = now()
      where s.member_email = v_email and encode(extensions.digest(s.endpoint, 'sha256'), 'hex') = v_hash;
    end if;
  end loop;
end;
$$;

create function public.stockflow_push_sweep(p_secret text, p_action text, p_payload jsonb)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, private, extensions
as $$
declare
  v_hash text;
  v_rows jsonb;
  v_limit integer := 200;
begin
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name = 'push';
  if v_hash is null or encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex') <> v_hash then
    raise exception 'Unauthorized push sweep' using errcode = '42501';
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'Push payload must be an object' using errcode = '22023';
  end if;
  if p_action = 'due' then
    if p_payload ? 'limit' then
      if coalesce(p_payload->>'limit', '') !~ '^[0-9]+$' then
        raise exception 'Invalid push limit' using errcode = '22023';
      end if;
      begin v_limit := (p_payload->>'limit')::integer;
      exception when numeric_value_out_of_range then
        raise exception 'Invalid push limit' using errcode = '22023';
      end;
    end if;
    select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) into v_rows
      from private.stockflow_push_due(v_limit) d;
    return jsonb_build_object('rows', v_rows);
  elsif p_action = 'record' then
    perform private.stockflow_push_record(p_payload->'results');
    return jsonb_build_object('ok', true);
  end if;
  raise exception 'Unsupported push sweep action' using errcode = '22023';
end;
$$;

revoke all on function public.stockflow_push_gateway(text,text,text,jsonb),
  private.stockflow_push_recipients(bigint), private.stockflow_push_due(integer),
  private.stockflow_push_record(jsonb), public.stockflow_push_sweep(text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.stockflow_push_gateway(text,text,text,jsonb),
  private.stockflow_push_recipients(bigint), private.stockflow_push_due(integer),
  private.stockflow_push_record(jsonb), public.stockflow_push_sweep(text,text,jsonb)
  to service_role;

notify pgrst, 'reload schema';
