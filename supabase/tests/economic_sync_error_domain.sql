begin;

-- Model separate upload timestamps within this rollback transaction.
alter table private.stockflow_economic_import_exceptions alter column recorded_at set default clock_timestamp();
insert into public.stockflow_snapshots(id,company,fetched_at,payload)
 values('suprabha','SUPRABHA DISTRIBUTORS',now()::text,'{"catalog":[]}'::jsonb) on conflict(id) do nothing;

do $test$
declare company text:='sync-domain-company'; observed_at timestamptz:=clock_timestamp(); doc jsonb; definition text; metadata record;
begin
 select p.prosecdef,p.proconfig into strict metadata from pg_proc p
 where p.oid='private.stockflow_import_economic_vouchers()'::regprocedure;
 doc:=jsonb_build_object('schemaVersion',1,'companyId',company,'sourceVersion',observed_at::text,
  'itemCatalog','{"groups":[{"id":"reagents","name":"Reagents","parentId":null}],"products":[{"id":"a","name":"Reagent A","groupId":"reagents","unit":"pack"}]}'::jsonb,
  'vouchers','[]'::jsonb);
 update public.stockflow_snapshots set payload=jsonb_build_object('catalog','[]'::jsonb,'economicEvidence',doc) where id='suprabha';
 if not private.stockflow_economic_item_catalog_current(company) then raise exception 'D1 imported catalog is not current';end if;

 update public.stockflow_snapshots set payload='{"catalog":[],"economicSyncError":"x1","economicSyncDomain":"sales_coverage"}'::jsonb where id='suprabha';
 if not exists(select 1 from private.stockflow_economic_import_exceptions where reason='x1' and evidence->>'source'='connector_sync'
  and evidence->>'domain'='sales_coverage') then raise exception 'D2 sales coverage domain was not recorded';end if;
 if not private.stockflow_economic_item_catalog_current(company) then raise exception 'D2 sales coverage failure hid the catalog';end if;
 if exists(select 1 from public.stockflow_snapshots where id='suprabha' and payload ?| array['economicSyncError','economicSyncDomain']) then
  raise exception 'D2 sync error keys remain in the snapshot';end if;

 update public.stockflow_snapshots set payload='{"catalog":[],"economicSyncError":"x2","economicSyncDomain":"instrument_economics"}'::jsonb where id='suprabha';
 if not exists(select 1 from private.stockflow_economic_import_exceptions where reason='x2' and evidence->>'source'='connector_sync'
  and evidence->>'domain'='instrument_economics') then raise exception 'D3 instrument economics domain was not recorded';end if;
 if private.stockflow_economic_item_catalog_current(company) then raise exception 'D3 instrument economics failure left the catalog current';end if;

 doc:=doc||jsonb_build_object('sourceVersion',(observed_at+interval '1 minute')::text);
 update public.stockflow_snapshots set payload=jsonb_build_object('catalog','[]'::jsonb,'economicEvidence',doc) where id='suprabha';
 if not private.stockflow_economic_item_catalog_current(company) then raise exception 'D4 newer catalog did not restore currency';end if;
 update public.stockflow_snapshots set payload='{"catalog":[],"economicSyncError":"x3"}'::jsonb where id='suprabha';
 if not exists(select 1 from private.stockflow_economic_import_exceptions where reason='x3' and evidence->>'source'='connector_sync'
  and not (evidence ? 'domain')) then raise exception 'D4 legacy failure acquired a domain or was not recorded';end if;
 if private.stockflow_economic_item_catalog_current(company) then raise exception 'D4 legacy failure left the catalog current';end if;

 doc:=doc||jsonb_build_object('sourceVersion',(observed_at+interval '2 minutes')::text);
 update public.stockflow_snapshots set payload=jsonb_build_object('catalog','[]'::jsonb,'economicEvidence',doc) where id='suprabha';
 if not private.stockflow_economic_item_catalog_current(company) then raise exception 'D5 newer catalog did not restore currency';end if;
 update public.stockflow_snapshots set payload='{"catalog":[],"economicSyncError":"x4","economicSyncDomain":"evil"}'::jsonb where id='suprabha';
 if not exists(select 1 from private.stockflow_economic_import_exceptions where reason='x4' and evidence->>'source'='connector_sync'
  and not (evidence ? 'domain')) then raise exception 'D5 unknown domain was stored or failure was not recorded';end if;
 if private.stockflow_economic_item_catalog_current(company) then raise exception 'D5 unknown domain left the catalog current';end if;

 definition:=pg_get_functiondef('private.stockflow_import_economic_vouchers()'::regprocedure);
 if (length(definition)-length(replace(definition,'economicSyncDomain','')))/length('economicSyncDomain')<>3 then
  raise exception 'D6 expected three sync domain references in importer';end if;
 if metadata.prosecdef is distinct from true or metadata.proconfig is distinct from array['search_path=pg_catalog, private, public, extensions']::text[] then
  raise exception 'D6 importer security definer or search_path changed';end if;
 raise notice 'PASS economic sync error domain D1-D6';
end $test$;

rollback;
