-- A disposable, rollback-only reproduction of the office connector's
-- service_role upload. The pricing trigger must not need broad table grants.
begin;

-- Hosted Supabase grants this table to service_role by default. The local
-- minimal scaffold does not model that grant or service_role's RLS bypass, so
-- mirror only snapshot-table write access for this rollback-only transaction.
grant select, insert, update on public.stockflow_snapshots to service_role;
create policy snapshot_upload_service_role_test on public.stockflow_snapshots
  for all to service_role using (true) with check (true);
set local role service_role;
insert into public.stockflow_snapshots(id, company, fetched_at, payload)
values (
  'suprabha', 'SUPRABHA TEST', now()::text,
  jsonb_build_object(
    'company', 'SUPRABHA TEST',
    'fetchedAtIso', 'snapshot-upload-privilege-test',
    'catalog', '[]'::jsonb,
    'tallyInvoices', '[]'::jsonb,
    'customers', '[]'::jsonb,
    'pricingHistory', jsonb_build_object(
      'sales', jsonb_build_array(jsonb_build_object(
        'customerTallyKey', 'NO-SUCH-LEDGER',
        'tallyItemKey', 'TEST-ITEM',
        'rate', 100,
        'invoiceDate', '2026-09-27',
        'invoiceReference', 'TEST-1',
        'sourceId', 'snapshot-upload-test',
        'sourceVersion', 'v1'
      )),
      'purchaseCosts', '[]'::jsonb
    )
  )
)
on conflict(id) do update set
  company = excluded.company,
  fetched_at = excluded.fetched_at,
  payload = excluded.payload;
reset role;

do $$
begin
  if not (select p.prosecdef and p.proowner = 'postgres'::regrole
          and p.proconfig @> array['search_path=pg_catalog, private, pg_temp']::text[]
          from pg_proc p
          where p.oid = 'private.stockflow_import_tally_pricing_evidence()'::regprocedure) then
    raise exception 'Pricing import trigger is not restricted to its trusted owner and search path';
  end if;
  if has_table_privilege('service_role', 'private.stockflow_customers', 'SELECT')
     or has_table_privilege('anon', 'public.stockflow_snapshots', 'INSERT')
     or has_table_privilege('authenticated', 'public.stockflow_snapshots', 'UPDATE') then
    raise exception 'Snapshot import widened direct table access';
  end if;
  if (select count(*) from private.stockflow_pricing_import_runs
      where source_version = 'snapshot-upload-privilege-test'
        and sales_received = 1 and sales_unmatched_customers = 1) <> 1 then
    raise exception 'Service-role upload did not record bounded pricing import evidence';
  end if;
  if (select payload ? 'pricingHistory' from public.stockflow_snapshots where id = 'suprabha') then
    raise exception 'Restricted pricing evidence leaked into public snapshot';
  end if;
end $$;

rollback;
