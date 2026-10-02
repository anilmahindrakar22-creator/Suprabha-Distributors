-- The catalog cache version must follow the catalog master, not every stock refresh.
begin;

update private.stockflow_gateway_config
set secret_sha256=encode(extensions.digest('catalog-source-version-test','sha256'),'hex')
where name='orders';

insert into public.stockflow_members(email,role,status)
values('catalog-source-version@test.local','administrator','active')
on conflict(email) do update set role='administrator',status='active';

insert into public.stockflow_snapshots(id,company,fetched_at,payload)
values('suprabha','SUPRABHA TEST',now()::text,
  jsonb_build_object('company','SUPRABHA TEST',
    'fetchedAt','2026-09-29T12:00:00Z',
    'catalogVersion','2026-09-29T08:00:00Z',
    'catalog','[]'::jsonb,'tallyInvoices','[]'::jsonb,'customers','[]'::jsonb))
on conflict(id) do update set company=excluded.company,fetched_at=excluded.fetched_at,
  payload=excluded.payload,updated_at=now();

do $test$
declare
  key text := 'catalog-source-version-test';
  actor text := 'catalog-source-version@test.local';
  catalog jsonb;
  bootstrap jsonb;
  orders jsonb;
begin
  catalog:=public.stockflow_catalog_gateway(key,actor,'get_catalog','{}'::jsonb);
  bootstrap:=public.stockflow_order_gateway(key,actor,'bootstrap','{}'::jsonb);
  orders:=public.stockflow_order_list_gateway(key,actor,'list_orders','{}'::jsonb);
  if catalog->>'catalogVersion'<>'2026-09-29T08:00:00Z'
     or bootstrap->'snapshot'->>'catalogVersion'<>'2026-09-29T08:00:00Z'
     or orders->'snapshot'->>'catalogVersion'<>'2026-09-29T08:00:00Z' then
    raise exception 'A gateway used stock freshness rather than catalog freshness';
  end if;

  update public.stockflow_snapshots
  set payload=payload-'catalogVersion'
  where id='suprabha';
  catalog:=public.stockflow_catalog_gateway(key,actor,'get_catalog','{}'::jsonb);
  bootstrap:=public.stockflow_order_gateway(key,actor,'bootstrap','{}'::jsonb);
  orders:=public.stockflow_order_list_gateway(key,actor,'list_orders','{}'::jsonb);
  if catalog->>'catalogVersion'<>'2026-09-29T12:00:00Z'
     or bootstrap->'snapshot'->>'catalogVersion'<>'2026-09-29T12:00:00Z'
     or orders->'snapshot'->>'catalogVersion'<>'2026-09-29T12:00:00Z' then
    raise exception 'Legacy snapshots lost their fetchedAt version fallback';
  end if;
end $test$;

rollback;
