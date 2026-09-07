create or replace function public.stockflow_customer_gateway(
  p_gateway_key text, p_actor_email text, p_action text, p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_email text := lower(btrim(coalesce(p_actor_email, '')));
  v_hash text;
begin
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name = 'orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key, ''), 'sha256'), 'hex') <> v_hash then
    raise exception 'Unauthorized gateway' using errcode = '42501';
  end if;
  if p_action <> 'get_customers' then raise exception 'Unsupported customer action' using errcode = '22023'; end if;
  if not exists(select 1 from public.stockflow_members where email = v_email and status = 'active') then
    raise exception 'Account is not approved' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'customerVersion', coalesce((
      select max(updated_at)::text || ':' || count(*)::text
      from private.stockflow_customers where active
    ), '0'),
    'customers', coalesce((
      select jsonb_agg(to_jsonb(customer) order by customer.name)
      from (
        select id, name, phone, city, tally_key as "tallyKey"
        from private.stockflow_customers where active order by name
      ) customer
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.stockflow_customer_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_customer_gateway(text,text,text,jsonb) to service_role;

do $$
declare
  f text;
  customer_start integer;
  orders_start integer;
  updated text;
begin
  select pg_get_functiondef('public.stockflow_order_gateway(text,text,text,jsonb)'::regprocedure) into f;
  customer_start := strpos(f, E'      \'customers\', coalesce((');
  orders_start := strpos(f, E'      \'orders\', coalesce((');
  if customer_start = 0 or orders_start <= customer_start then
    raise exception 'Expected eager customer projection was not found';
  end if;
  updated := substring(f from 1 for customer_start - 1)
    || E'      \'customerVersion\', coalesce((select max(updated_at)::text || \':\' || count(*)::text from private.stockflow_customers where active), \'0\'),\n'
    || E'      \'customers\', \'[]\'::jsonb,\n'
    || substring(f from orders_start);
  execute updated;
end;
$$;

revoke all on function public.stockflow_order_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_order_gateway(text,text,text,jsonb) to service_role;
