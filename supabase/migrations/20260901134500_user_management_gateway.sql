create table private.stockflow_member_events (
  id bigint generated always as identity primary key,
  member_email text not null,
  action text not null check (action in ('created', 'updated')),
  previous_role text,
  new_role text not null,
  previous_status text,
  new_status text not null,
  actor_email text not null,
  created_at timestamptz not null default now()
);

create index stockflow_member_events_email_created_idx
on private.stockflow_member_events (member_email, created_at desc);
alter table private.stockflow_member_events enable row level security;

create trigger stockflow_member_events_immutable
before update or delete on private.stockflow_member_events
for each row execute function private.prevent_order_event_mutation();

create or replace function public.stockflow_user_gateway(
  p_gateway_key text,
  p_actor_email text,
  p_action text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_actor_email text := lower(btrim(coalesce(p_actor_email, '')));
  v_actor_role text;
  v_expected_hash text;
  v_email text;
  v_role text;
  v_status text;
  v_previous public.stockflow_members%rowtype;
begin
  select secret_sha256 into v_expected_hash
  from private.stockflow_gateway_config where name = 'orders';
  if v_expected_hash is null
     or encode(extensions.digest(coalesce(p_gateway_key, ''), 'sha256'), 'hex') <> v_expected_hash then
    raise exception 'Unauthorized gateway' using errcode = '42501';
  end if;

  select role into v_actor_role from public.stockflow_members
  where email = v_actor_email and status = 'active';
  if v_actor_role is null then
    raise exception 'StockFlow membership is not active' using errcode = '42501';
  end if;

  if p_action = 'session' then
    return jsonb_build_object('email', v_actor_email, 'role', v_actor_role);
  end if;
  if v_actor_role <> 'administrator' then
    raise exception 'Administrator access is required' using errcode = '42501';
  end if;

  if p_action = 'list_users' then
    return jsonb_build_object('users', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'email', email, 'role', role, 'status', status, 'updatedAt', updated_at
      ) order by email)
      from public.stockflow_members
    ), '[]'::jsonb));
  end if;
  if p_action <> 'upsert_user' then
    raise exception 'Unsupported user action' using errcode = '22023';
  end if;

  v_email := lower(btrim(coalesce(p_payload->>'email', '')));
  v_role := p_payload->>'role';
  v_status := p_payload->>'status';
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or char_length(v_email) > 254 then
    raise exception 'A valid email address is required' using errcode = '22023';
  end if;
  if v_role not in ('administrator', 'sales', 'operations', 'warehouse', 'accounts', 'management', 'viewer') then
    raise exception 'Invalid user role' using errcode = '22023';
  end if;
  if v_status not in ('active', 'suspended') then
    raise exception 'Invalid user status' using errcode = '22023';
  end if;
  if v_email = v_actor_email and (v_role <> 'administrator' or v_status <> 'active') then
    raise exception 'Administrators cannot remove their own access' using errcode = '22023';
  end if;

  select * into v_previous from public.stockflow_members where email = v_email for update;
  insert into public.stockflow_members(email, role, status, updated_at)
  values (v_email, v_role, v_status, now())
  on conflict (email) do update set role = excluded.role, status = excluded.status, updated_at = now();

  insert into private.stockflow_member_events(
    member_email, action, previous_role, new_role, previous_status, new_status, actor_email
  ) values (
    v_email, case when v_previous.id is null then 'created' else 'updated' end,
    v_previous.role, v_role, v_previous.status, v_status, v_actor_email
  );
  return jsonb_build_object('ok', true, 'email', v_email, 'role', v_role, 'status', v_status);
end;
$$;

revoke all on function public.stockflow_user_gateway(text, text, text, jsonb)
from public, anon, authenticated;
grant execute on function public.stockflow_user_gateway(text, text, text, jsonb)
to service_role;
