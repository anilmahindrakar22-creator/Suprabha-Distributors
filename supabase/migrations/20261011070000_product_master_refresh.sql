-- The 3 September migration dropped stockflow_sync_inventory_products, leaving
-- pricing's product identity mirror stale for newly created Tally catalogue keys.
-- This is mirror only, not inventory (ADR-0001): never create stock, batches or
-- ledger data, and no deactivation (D-05), even for partial catalogue snapshots.
-- The refresh runs inside the stock snapshot upload transaction. It must never
-- break that upload and freeze stock freshness: isolate refresh errors in a
-- subtransaction, bound lock waits, record failures and retry on the next upload.
begin;

create table private.stockflow_product_refresh_state (
  id text primary key check (id='suprabha'),
  last_catalog_version text,
  last_applied_at timestamptz,
  last_inserted integer,
  last_updated integer,
  last_error text,
  last_error_at timestamptz
);
alter table private.stockflow_product_refresh_state enable row level security;
revoke all on private.stockflow_product_refresh_state from public, anon, authenticated;

create function private.stockflow_refresh_products_from_snapshot(p_payload jsonb)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, private
as $$
declare
  v_version text;
  v_inserted integer;
  v_updated integer;
begin
  if jsonb_typeof(p_payload->'catalog') is distinct from 'array' then
    return jsonb_build_object('skipped','no_catalog');
  end if;
  if jsonb_array_length(p_payload->'catalog') = 0 then
    return jsonb_build_object('skipped','no_catalog');
  end if;
  v_version := nullif(btrim(p_payload->>'catalogVersion'),'');
  if v_version is not null and exists (
    select 1 from private.stockflow_product_refresh_state
    where id='suprabha' and last_catalog_version=v_version
  ) then
    return jsonb_build_object('skipped','unchanged');
  end if;

  with source as (
    select distinct on (key) key, name, item_group, base_unit
    from (
      select btrim(item->>'tallyKey') as key, btrim(item->>'item') as name,
        coalesce(btrim(item->>'group'),'') as item_group,
        coalesce(btrim(item->>'baseUnit'),'') as base_unit, ordinal
      from jsonb_array_elements(p_payload->'catalog') with ordinality as entries(item,ordinal)
    ) parsed
    where nullif(key,'') is not null and nullif(name,'') is not null
    order by key, ordinal
  ), refreshed as (
    insert into private.stockflow_products(tally_item_key,name,item_group,base_unit,active)
    select key,name,item_group,base_unit,true from source where true
    on conflict (tally_item_key) do update set
      name=excluded.name, item_group=excluded.item_group, base_unit=excluded.base_unit,
      active=true, version=stockflow_products.version+1, updated_at=now()
    where (stockflow_products.name,stockflow_products.item_group,stockflow_products.base_unit,stockflow_products.active)
      is distinct from (excluded.name,excluded.item_group,excluded.base_unit,true)
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted), count(*) filter (where not inserted)
  into v_inserted,v_updated from refreshed;

  insert into private.stockflow_product_refresh_state
    (id,last_catalog_version,last_applied_at,last_inserted,last_updated,last_error)
  values ('suprabha',v_version,now(),v_inserted,v_updated,null)
  on conflict (id) do update set
    last_catalog_version=excluded.last_catalog_version,
    last_applied_at=excluded.last_applied_at,
    last_inserted=excluded.last_inserted,
    last_updated=excluded.last_updated,
    last_error=null;
  return jsonb_build_object('inserted',v_inserted,'updated',v_updated,'catalogVersion',v_version);
end;
$$;

create function private.stockflow_snapshot_refresh_products()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, private
as $$
declare
  v_lock_timeout text := current_setting('lock_timeout');
begin
  perform set_config('lock_timeout','2s',true);
  begin
    perform private.stockflow_refresh_products_from_snapshot(new.payload);
  exception when others then
    -- The failed refresh is rolled back; do not advance the applied version.
    begin
      insert into private.stockflow_product_refresh_state(id,last_error,last_error_at)
      values ('suprabha',left(sqlerrm,500),now())
      on conflict (id) do update set
        last_error=excluded.last_error, last_error_at=excluded.last_error_at;
    exception when others then
      -- Even a failure to record the error must not abort a stock upload.
      null;
    end;
  end;
  perform set_config('lock_timeout',v_lock_timeout,true);
  return new;
end;
$$;

create trigger stockflow_snapshot_refresh_products
after insert or update of payload on public.stockflow_snapshots
for each row when (new.id='suprabha')
execute function private.stockflow_snapshot_refresh_products();

revoke execute on function private.stockflow_refresh_products_from_snapshot(jsonb)
  from public, anon, authenticated;
revoke execute on function private.stockflow_snapshot_refresh_products()
  from public, anon, authenticated;

do $$
begin
  perform private.stockflow_refresh_products_from_snapshot(payload)
  from public.stockflow_snapshots where id='suprabha';
end;
$$;

commit;
