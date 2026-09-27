-- The office connector writes a snapshot as service_role. Its pricing evidence
-- import is part of that same transaction, but the evidence tables are private
-- and must not be granted directly to service_role.
--
-- This trigger is attached only to public.stockflow_snapshots; that table is
-- writable by service_role, not anon/authenticated. Its body uses qualified
-- relation names and a trusted search path. The function itself is not an RPC.
alter function private.stockflow_import_tally_pricing_evidence()
  security definer
  set search_path = pg_catalog, private, pg_temp;

revoke all on function private.stockflow_import_tally_pricing_evidence()
  from public, anon, authenticated, service_role;
