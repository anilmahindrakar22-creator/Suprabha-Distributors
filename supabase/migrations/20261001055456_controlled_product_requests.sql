-- Requests are operational records, never new canonical inventory items.
create table private.stockflow_product_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references private.stockflow_customers(id) on delete restrict,
  product_name text not null check (char_length(btrim(product_name)) between 2 and 200),
  details text not null default '' check (char_length(details) <= 1000),
  status text not null default 'open' check (status in ('open','resolved','rejected')),
  resolution text,
  created_by_email text not null,
  reviewed_by_email text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  version integer not null default 1 check (version > 0),
  check ((status='open' and resolution is null and reviewed_by_email is null and reviewed_at is null)
    or (status<>'open' and resolution is not null and char_length(btrim(resolution)) between 3 and 1000 and reviewed_by_email is not null and reviewed_at is not null))
);
create index stockflow_product_requests_open_idx on private.stockflow_product_requests(created_at,id) where status='open';
create index stockflow_product_requests_actor_idx on private.stockflow_product_requests(created_by_email,created_at desc,id);
create table private.stockflow_product_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references private.stockflow_product_requests(id) on delete restrict,
  event_type text not null check (event_type in ('opened','resolved','rejected')),
  actor_email text not null,
  actor_role text not null,
  metadata jsonb not null,
  created_at timestamptz not null default now()
);
create index stockflow_product_request_events_request_idx on private.stockflow_product_request_events(request_id,created_at);
alter table private.stockflow_product_requests enable row level security;
alter table private.stockflow_product_request_events enable row level security;
revoke all on private.stockflow_product_requests,private.stockflow_product_request_events from public,anon,authenticated;
create trigger stockflow_product_requests_no_delete before delete on private.stockflow_product_requests for each row execute function private.prevent_business_delete();
create trigger stockflow_product_request_events_immutable before update or delete on private.stockflow_product_request_events for each row execute function private.prevent_order_event_mutation();

create function public.stockflow_product_request_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,extensions as $$
declare
  v_email text := lower(btrim(coalesce(p_actor_email,''))); v_role text; v_hash text;
  v_request private.stockflow_product_requests%rowtype;
  v_key text; v_replay jsonb; v_result jsonb; v_name text; v_resolution text; v_customer uuid; v_catalog jsonb;
begin
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_hash then raise exception 'Unauthorized gateway' using errcode='42501'; end if;
  select role into v_role from public.stockflow_members where email=v_email and status='active';
  if v_role is null or v_role not in ('administrator','management','operations','sales') then raise exception 'Role cannot access product requests' using errcode='42501'; end if;
  if p_action='list_product_requests' then
    return jsonb_build_object('requests',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id) from (
      select id,customer_id,product_name,details,status,resolution,created_by_email,reviewed_by_email,created_at,reviewed_at,version
      from private.stockflow_product_requests where status='open' and (v_role in ('administrator','management','operations') or created_by_email=v_email)
      order by created_at desc,id limit 100
    ) r),'[]'::jsonb));
  end if;
  if p_action not in ('create_product_request','review_product_request') then raise exception 'Unsupported product request action' using errcode='22023'; end if;
  if p_action='review_product_request' and v_role not in ('administrator','management','operations') then raise exception 'Role cannot review product requests' using errcode='42501'; end if;
  v_key:=p_payload->>'idempotencyKey';
  v_replay:=private.begin_stockflow_command(v_email,p_action,v_key,p_payload);
  if v_replay is not null then return v_replay; end if;
  if p_action='create_product_request' then
    v_name:=btrim(coalesce(p_payload->>'productName',''));
    if char_length(v_name) not between 2 and 200 or char_length(coalesce(p_payload->>'details',''))>1000 then raise exception 'Valid product name and bounded details required' using errcode='22023'; end if;
    v_customer:=nullif(p_payload->>'customerId','')::uuid;
    if v_customer is not null and not exists(select 1 from private.stockflow_customers where id=v_customer and active) then raise exception 'Active customer required' using errcode='22023'; end if;
    -- Re-check latest authoritative imported catalog, not a filtered browser result.
    select payload->'catalog' into v_catalog from public.stockflow_snapshots where id='suprabha';
    if jsonb_typeof(v_catalog) is distinct from 'array' then raise exception 'Synced Tally catalog unavailable; refresh before requesting a product' using errcode='22023'; end if;
    if exists(select 1 from jsonb_array_elements(v_catalog) item where lower(btrim(item->>'item'))=lower(v_name)) then raise exception 'Product already exists in Tally catalog; select it instead' using errcode='22023'; end if;
    insert into private.stockflow_product_requests(customer_id,product_name,details,created_by_email)
      values(v_customer,v_name,btrim(coalesce(p_payload->>'details','')),v_email) returning * into v_request;
  else
    v_resolution:=btrim(coalesce(p_payload->>'resolution',''));
    if p_payload->>'status' is null or p_payload->>'status' not in ('resolved','rejected') or char_length(v_resolution) not between 3 and 1000 then raise exception 'Review outcome and reason required' using errcode='22023'; end if;
    select * into v_request from private.stockflow_product_requests where id=(p_payload->>'requestId')::uuid for update;
    if not found then raise exception 'Product request not found' using errcode='22023'; end if;
    if v_request.version is distinct from (p_payload->>'expectedVersion')::integer then raise exception 'Product request changed; refresh before review' using errcode='PT409'; end if;
    if v_request.status<>'open' then raise exception 'Product request already reviewed' using errcode='PT409'; end if;
    update private.stockflow_product_requests set status=p_payload->>'status',resolution=v_resolution,reviewed_by_email=v_email,reviewed_at=now(),version=version+1 where id=v_request.id returning * into v_request;
  end if;
  insert into private.stockflow_product_request_events(request_id,event_type,actor_email,actor_role,metadata)
    values(v_request.id,case when p_action='create_product_request' then 'opened' else v_request.status end,v_email,v_role,jsonb_build_object('requestId',v_key,'resolution',v_request.resolution));
  v_result:=jsonb_build_object('ok',true,'requestId',v_request.id,'status',v_request.status,'version',v_request.version);
  perform private.finish_stockflow_command(v_email,p_action,v_key,p_payload,v_request.id,v_result);
  return v_result;
end $$;
revoke all on function public.stockflow_product_request_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_product_request_gateway(text,text,text,jsonb) to service_role;
