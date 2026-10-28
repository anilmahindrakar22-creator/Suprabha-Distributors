-- Disposable-database test: commit fixtures before opening the independent locker.
-- Run with psql autocommit (no --single-transaction), like price_book_concurrency.sql.
create extension if not exists dblink with schema public;
begin;
insert into public.stockflow_snapshots(id,company,fetched_at,payload)
values('suprabha','SUPRABHA TEST',now()::text,
  '{"company":"SUPRABHA TEST","rows":[],"groups":[]}'::jsonb)
on conflict(id) do nothing;
create temp table product_refresh_lock_original as
select payload from public.stockflow_snapshots where id='suprabha';
do $fixture$
begin
  if exists(select 1 from private.stockflow_products where tally_item_key in ('LOCKTEST-1','LOCKTEST-2')) then
    raise exception 'Product refresh lock test keys must initially be absent';
  end if;
end $fixture$;
-- No customers/pricing keys: unrelated snapshot importers skip these fixtures.
update public.stockflow_snapshots set payload=jsonb_build_object(
  'catalog',jsonb_build_array(jsonb_build_object(
    'tallyKey','LOCKTEST-1','item','Lock test baseline','group','G','baseUnit','Nos')),
  'catalogVersion','lock-v0') where id='suprabha';
create temp table product_refresh_lock_baseline as
select last_catalog_version from private.stockflow_product_refresh_state where id='suprabha';
do $baseline$
begin
  if (select last_catalog_version from product_refresh_lock_baseline) is distinct from 'lock-v0'
    or not exists(select 1 from private.stockflow_products where tally_item_key='LOCKTEST-1' and active)
  then raise exception 'Baseline catalogue was not applied'; end if;
end $baseline$;
commit;

-- Set outside DO so the main uploader statement itself has a bounded runtime.
set statement_timeout='15s';
do $contention$
declare
  started timestamptz;
  elapsed interval;
  affected integer;
  catalog_payload jsonb := jsonb_build_object(
    'catalog',jsonb_build_array(jsonb_build_object(
      'tallyKey','LOCKTEST-2','item','Lock test reagent','group','G','baseUnit','Nos')),
    'catalogVersion','lock-v1');
begin
  perform public.dblink_connect('locker',format(
    'host=127.0.0.1 port=%s dbname=%s user=%s',current_setting('port'),current_database(),current_user));
  perform public.dblink_exec('locker','begin');
  perform public.dblink_exec('locker','lock table private.stockflow_products in share row exclusive mode');

  started := clock_timestamp();
  update public.stockflow_snapshots set payload=catalog_payload where id='suprabha';
  get diagnostics affected = row_count;
  elapsed := clock_timestamp()-started;
  if affected <> 1 then raise exception 'Snapshot upload did not update exactly one row'; end if;
  if elapsed >= interval '6 seconds' then
    raise exception 'Snapshot upload blocked too long: %',elapsed;
  end if;
  if (select payload from public.stockflow_snapshots where id='suprabha') is distinct from catalog_payload then
    raise exception 'Snapshot upload did not persist its payload';
  end if;
  if exists(select 1 from private.stockflow_products where tally_item_key='LOCKTEST-2') then
    raise exception 'Blocked refresh inserted the new product';
  end if;
  if not exists(select 1 from private.stockflow_product_refresh_state
    where id='suprabha' and last_error is not null and last_error ilike '%lock%'
      and last_catalog_version=(select last_catalog_version from product_refresh_lock_baseline)) then
    raise exception 'Blocked refresh did not record a lock error and preserve lock-v0';
  end if;

  perform public.dblink_exec('locker','rollback');
  update public.stockflow_snapshots set payload=catalog_payload where id='suprabha';
  if not exists(select 1 from private.stockflow_products where tally_item_key='LOCKTEST-2' and active)
    or not exists(select 1 from private.stockflow_product_refresh_state
      where id='suprabha' and last_catalog_version='lock-v1' and last_error is null)
  then raise exception 'Next upload did not apply the catalogue and clear the error'; end if;
  perform public.dblink_disconnect('locker');
exception when others or query_canceled then
  -- Disconnect also rolls back the independent transaction on assertion failure.
  if 'locker'=any(coalesce(public.dblink_get_connections(),array[]::text[])) then
    perform public.dblink_disconnect('locker');
  end if;
  raise;
end $contention$;
reset statement_timeout;

-- Restore the exact saved payload before subsequent tests run.
update public.stockflow_snapshots set payload=(select payload from product_refresh_lock_original)
where id='suprabha';
do $cleanup$
begin
  -- DELETE trigger bit is 8; retain fixtures if any delete trigger protects products.
  if not exists(select 1 from pg_trigger
    where tgrelid='private.stockflow_products'::regclass and (tgtype::integer & 8) <> 0) then
    delete from private.stockflow_products where tally_item_key in ('LOCKTEST-1','LOCKTEST-2');
  end if;
end $cleanup$;
drop table product_refresh_lock_original, product_refresh_lock_baseline;
