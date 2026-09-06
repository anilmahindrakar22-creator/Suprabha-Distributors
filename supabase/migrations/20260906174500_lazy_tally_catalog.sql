create or replace function public.stockflow_catalog_gateway(
  p_gateway_key text, p_actor_email text, p_action text, p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_email text := lower(btrim(coalesce(p_actor_email, '')));
  v_hash text;
  v_snapshot jsonb;
begin
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name = 'orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key, ''), 'sha256'), 'hex') <> v_hash then
    raise exception 'Unauthorized gateway' using errcode = '42501';
  end if;
  if p_action <> 'get_catalog' then raise exception 'Unsupported catalog action' using errcode = '22023'; end if;
  if not exists(select 1 from public.stockflow_members where email = v_email and status = 'active') then
    raise exception 'Account is not approved' using errcode = '42501';
  end if;
  select payload into v_snapshot from public.stockflow_snapshots where id = 'suprabha';
  return jsonb_build_object(
    'catalogVersion', coalesce(v_snapshot->>'fetchedAt', ''),
    'catalog', coalesce(v_snapshot->'catalog', '[]'::jsonb)
  );
end;
$$;

revoke all on function public.stockflow_catalog_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_catalog_gateway(text,text,text,jsonb) to service_role;

do $$
declare f text; updated text;
begin
  select pg_get_functiondef('public.stockflow_order_gateway(text,text,text,jsonb)'::regprocedure) into f;
  updated := replace(f,
    $old$        'catalog', coalesce(v_snapshot->'catalog', '[]'::jsonb),
        'tallyInvoices'$old$,
    $new$        'catalogVersion', coalesce(v_snapshot->>'fetchedAt', ''),
        'catalog', '[]'::jsonb,
        'tallyInvoices'$new$);
  if updated = f then raise exception 'Expected eager catalog projection was not found'; end if;
  execute updated;
end;
$$;

revoke all on function public.stockflow_order_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_order_gateway(text,text,text,jsonb) to service_role;
