begin;
-- Admission, not a manual dismissal, resolves a document failure. Keep every
-- rejection immutable and derive the current queue from canonical source history.
create function private.stockflow_economic_import_exception_open(p_id bigint)
returns boolean language sql stable set search_path=pg_catalog,private as $$
 select exists(
  select 1 from private.stockflow_economic_import_exceptions e where e.id=p_id
  and not exists(
   select 1 from private.stockflow_economic_source_vouchers v
   where v.company_id=e.company_id and v.source_id=e.source_id
   and case when e.evidence->>'revision' ~ '^[0-9]{1,19}$' then
    v.source_revision>(e.evidence->>'revision')::numeric
    or (v.source_revision=(e.evidence->>'revision')::numeric and v.imported_at>e.recorded_at)
   else v.imported_at>e.recorded_at end
  )
 )
$$;
revoke all on function private.stockflow_economic_import_exception_open(bigint) from public,anon,authenticated;

do $$
declare definition text; fragment text:='from private.stockflow_economic_import_exceptions';
begin
 definition:=pg_get_functiondef('private.stockflow_economic_workspace(text[])'::regprocedure);
 if (length(definition)-length(replace(definition,fragment,'')))/length(fragment)<>1 then
  raise exception 'Unexpected economic workspace import-exception fragment; stop migration';
 end if;
 execute replace(definition,fragment,fragment||' e where private.stockflow_economic_import_exception_open(e.id)');
end$$;
commit;
