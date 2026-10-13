begin;
do $test$
declare
  original jsonb;
  catalog jsonb;
  variant jsonb;
  before_products jsonb;
  before_state jsonb;
  version_a integer;
  version_b integer;
  preview jsonb;
  result jsonb;
  saved_timeout text := current_setting('lock_timeout');
  affected integer;
begin
  insert into public.stockflow_snapshots(id,company,fetched_at,payload)
  values ('suprabha','SUPRABHA TEST',now()::text,
    '{"company":"SUPRABHA TEST","rows":[],"groups":[],"customers":[]}'::jsonb)
  on conflict (id) do nothing;
  select payload into original from public.stockflow_snapshots where id='suprabha';
  -- Keep unrelated snapshot importers out of these product-only fixtures.
  original := original - 'catalog' - 'catalogVersion' - 'customers' - 'pricing';
  if exists(select 1 from private.stockflow_products where tally_item_key like 'REFRESH-TEST-%') then
    raise exception 'Product refresh test keys must initially be absent';
  end if;

  catalog := jsonb_build_array(
    jsonb_build_object('tallyKey',' REFRESH-TEST-A ','item',' Refresh A ','group',' Refresh group ','baseUnit',' Nos '),
    jsonb_build_object('tallyKey','REFRESH-TEST-B','item','Refresh B'),
    jsonb_build_object('tallyKey','REFRESH-TEST-A','item','Duplicate must lose'),
    jsonb_build_object('tallyKey',' ','item','Invalid key'),
    jsonb_build_object('tallyKey','REFRESH-TEST-INVALID','item',' '));
  update public.stockflow_snapshots set payload=original || jsonb_build_object(
    'catalog',catalog,'catalogVersion','REFRESH-TEST-v1') where id='suprabha';
  if not exists(select 1 from private.stockflow_products where tally_item_key='REFRESH-TEST-A'
    and name='Refresh A' and item_group='Refresh group' and base_unit='Nos' and active and version=1)
    or not exists(select 1 from private.stockflow_products where tally_item_key='REFRESH-TEST-B'
      and name='Refresh B' and item_group='' and base_unit='' and active and version=1)
    or exists(select 1 from private.stockflow_products where tally_item_key='REFRESH-TEST-INVALID') then
    raise exception 'New catalogue identities, trimming or first-duplicate selection failed';
  end if;
  if not exists(select 1 from private.stockflow_product_refresh_state where id='suprabha'
    and last_catalog_version='REFRESH-TEST-v1' and last_inserted=2 and last_updated=0 and last_error is null) then
    raise exception 'Initial product refresh counts were not recorded';
  end if;

  -- Compare every product, including version and updated_at, and all state fields.
  select jsonb_agg(to_jsonb(p) order by tally_item_key) into before_products from private.stockflow_products p;
  select to_jsonb(s) into before_state from private.stockflow_product_refresh_state s where id='suprabha';
  update public.stockflow_snapshots set payload=original || jsonb_build_object(
    'catalog',jsonb_build_array(jsonb_build_object('tallyKey','REFRESH-TEST-A','item','Must not change')),
    'catalogVersion',' REFRESH-TEST-v1 ') where id='suprabha';
  if (select jsonb_agg(to_jsonb(p) order by tally_item_key) from private.stockflow_products p) is distinct from before_products
    or (select to_jsonb(s) from private.stockflow_product_refresh_state s where id='suprabha') is distinct from before_state then
    raise exception 'Unchanged catalogue version did work or changed earlier counts';
  end if;

  select version into version_a from private.stockflow_products where tally_item_key='REFRESH-TEST-A';
  select version into version_b from private.stockflow_products where tally_item_key='REFRESH-TEST-B';
  catalog := jsonb_build_array(
    jsonb_build_object('tallyKey','REFRESH-TEST-A','item','Refresh A renamed','group','Refresh group','baseUnit','Nos'),
    jsonb_build_object('tallyKey','REFRESH-TEST-B','item','Refresh B'));
  update public.stockflow_snapshots set payload=original || jsonb_build_object(
    'catalog',catalog,'catalogVersion','REFRESH-TEST-v2') where id='suprabha';
  if not exists(select 1 from private.stockflow_products where tally_item_key='REFRESH-TEST-A'
    and name='Refresh A renamed' and version=version_a+1)
    or not exists(select 1 from private.stockflow_products where tally_item_key='REFRESH-TEST-B' and version=version_b)
    or not exists(select 1 from private.stockflow_product_refresh_state where id='suprabha' and last_inserted=0 and last_updated=1) then
    raise exception 'Rename did not bump exactly the changed product';
  end if;
  select jsonb_agg(to_jsonb(p) order by tally_item_key) into before_products from private.stockflow_products p;
  update public.stockflow_snapshots set payload=original || jsonb_build_object(
    'catalog',jsonb_build_array(catalog->0),'catalogVersion','REFRESH-TEST-v3') where id='suprabha';
  if (select jsonb_agg(to_jsonb(p) order by tally_item_key) from private.stockflow_products p) is distinct from before_products
    or not exists(select 1 from private.stockflow_products where tally_item_key='REFRESH-TEST-B' and active)
    or not exists(select 1 from private.stockflow_product_refresh_state where id='suprabha' and last_inserted=0 and last_updated=0) then
    raise exception 'Partial catalogue deactivated a product or rewrote unchanged identities';
  end if;

  select to_jsonb(s) into before_state from private.stockflow_product_refresh_state s where id='suprabha';
  foreach variant in array array[
    '{"catalog":[],"catalogVersion":"REFRESH-TEST-empty"}'::jsonb,
    '{"catalogVersion":"REFRESH-TEST-missing"}'::jsonb,
    '{"catalog":null}'::jsonb,'{"catalog":{}}'::jsonb,'{"catalog":"invalid"}'::jsonb
  ] loop
    update public.stockflow_snapshots set payload=original || variant where id='suprabha';
    if (select jsonb_agg(to_jsonb(p) order by tally_item_key) from private.stockflow_products p) is distinct from before_products
      or (select to_jsonb(s) from private.stockflow_product_refresh_state s where id='suprabha') is distinct from before_state then
      raise exception 'Absent, empty or non-array catalogue changed products/state: %',variant;
    end if;
    result := private.stockflow_refresh_products_from_snapshot(original || variant);
    if result is distinct from '{"skipped":"no_catalog"}'::jsonb then
      raise exception 'Invalid catalogue did not report no_catalog: %',result;
    end if;
  end loop;

  -- End-to-end: A was created only through the snapshot, never hand-seeded.
  insert into private.stockflow_gateway_config(name,secret_sha256)
  values ('orders',encode(extensions.digest('product-refresh-test-key','sha256'),'hex'))
  on conflict (name) do update set secret_sha256=excluded.secret_sha256;
  insert into public.stockflow_members(email,role,status)
  values ('product-refresh-admin@test.local','administrator','active');
  update private.stockflow_pricing_policies set active=false where active;
  insert into private.stockflow_pricing_policies(policy_version,minimum_margin_percent,target_margin_percent,
    override_approval_percent,rounding_increment,rounding_rule_version,effective_from,created_by_email)
  values ('product-refresh-test-v1',20,30,5,5,'ceil-five-v1','2026-01-01','test');
  preview := public.stockflow_pricing_gateway('product-refresh-test-key','product-refresh-admin@test.local',
    'get_product_price_impact',jsonb_build_object('tallyKey','REFRESH-TEST-A','pricingDate','2026-10-11'));
  result := public.stockflow_pricing_gateway('product-refresh-test-key','product-refresh-admin@test.local',
    'set_standard_item_price',jsonb_build_object('tallyKey','REFRESH-TEST-A','pricingDate','2026-10-11',
      'validFrom','2026-10-11','price',125,'reason','New catalogue product regression',
      'previewHash',preview->>'previewHash','idempotencyKey','product-refresh-standard-price-01'));
  if result->>'ok' is distinct from 'true' or not exists(
    select 1 from private.stockflow_standard_item_prices
    where tally_item_key='REFRESH-TEST-A' and price_amount=125 and status='approved') then
    raise exception 'Refreshed product could not be priced through set_standard_item_price: %',result;
  end if;

  update public.stockflow_snapshots set payload=original ||
    '{"catalog":[1,"x",null],"catalogVersion":"REFRESH-TEST-junk"}'::jsonb where id='suprabha';
  get diagnostics affected = row_count;
  if affected<>1 or (select payload->>'catalogVersion' from public.stockflow_snapshots where id='suprabha')
    is distinct from 'REFRESH-TEST-junk'
    or (select jsonb_agg(to_jsonb(p) order by tally_item_key) from private.stockflow_products p) is distinct from before_products then
    raise exception 'Non-object catalogue entries broke snapshot upload or changed products';
  end if;

  update private.stockflow_products set active=false where tally_item_key='REFRESH-TEST-B';
  select version into version_b from private.stockflow_products where tally_item_key='REFRESH-TEST-B';
  update public.stockflow_snapshots set payload=original || jsonb_build_object(
    'catalog',catalog,'catalogVersion','REFRESH-TEST-v4') where id='suprabha';
  if not exists(select 1 from private.stockflow_products where tally_item_key='REFRESH-TEST-B' and active and version=version_b+1)
    or not exists(select 1 from private.stockflow_products where tally_item_key='REFRESH-TEST-A' and version=version_a+1)
    or not exists(select 1 from private.stockflow_product_refresh_state where id='suprabha' and last_inserted=0 and last_updated=1) then
    raise exception 'Reactivation failed to bump only the returning inactive product';
  end if;

  -- Force a real refresh failure to prove upload isolation, rollback and retry.
  select jsonb_agg(to_jsonb(p) order by tally_item_key) into before_products from private.stockflow_products p;
  select to_jsonb(s) into before_state from private.stockflow_product_refresh_state s where id='suprabha';
  alter table private.stockflow_products add constraint product_refresh_test_reject
    check (name <> 'REFRESH-TEST-rejected-name');
  variant := original || jsonb_build_object('catalogVersion','REFRESH-TEST-retry','catalog',jsonb_build_array(
    jsonb_build_object('tallyKey','REFRESH-TEST-A','item','REFRESH-TEST-rejected-name'),
    jsonb_build_object('tallyKey','REFRESH-TEST-RETRY','item','Refresh retry')));
  perform set_config('lock_timeout','7s',true);
  update public.stockflow_snapshots set payload=variant where id='suprabha';
  get diagnostics affected = row_count;
  if affected<>1 or (select payload from public.stockflow_snapshots where id='suprabha') is distinct from variant
    or (select jsonb_agg(to_jsonb(p) order by tally_item_key) from private.stockflow_products p) is distinct from before_products
    or (select to_jsonb(s)-'last_error'-'last_error_at' from private.stockflow_product_refresh_state s where id='suprabha')
      is distinct from (before_state-'last_error'-'last_error_at')
    or not exists(select 1 from private.stockflow_product_refresh_state where id='suprabha'
      and last_error like '%product_refresh_test_reject%' and length(last_error)<=500 and last_error_at is not null)
    or current_setting('lock_timeout')<>'7s' then
    raise exception 'Refresh failure aborted upload, changed applied state, lost error or leaked lock_timeout';
  end if;
  alter table private.stockflow_products drop constraint product_refresh_test_reject;
  update public.stockflow_snapshots set payload=variant where id='suprabha';
  if not exists(select 1 from private.stockflow_products where tally_item_key='REFRESH-TEST-RETRY' and active)
    or not exists(select 1 from private.stockflow_product_refresh_state where id='suprabha'
      and last_catalog_version='REFRESH-TEST-retry' and last_inserted=1 and last_updated=1 and last_error is null)
    or current_setting('lock_timeout')<>'7s' then
    raise exception 'Next upload did not retry successfully or restore lock_timeout';
  end if;
  perform set_config('lock_timeout',saved_timeout,true);
end $test$;
rollback;
