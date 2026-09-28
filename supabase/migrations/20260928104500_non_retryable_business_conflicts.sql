-- PostgREST 14 retries SQLSTATE 40001 internally. StockFlow previously used that
-- database serialization code for ordinary optimistic-concurrency rejections,
-- allowing one stale API call to spin inside PostgREST. Business conflicts are
-- HTTP 409 responses; genuine PostgreSQL serialization failures remain 40001.
do $migration$
declare
  function_record record;
  definition text;
  corrected_definition text;
begin
  for function_record in
    select p.oid, n.nspname, p.proname
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('private', 'public')
      and p.prokind = 'f'
      and p.proname like 'stockflow%'
      and p.prosrc ~* $pattern$errcode\s*=\s*'40001'$pattern$
  loop
    definition := pg_catalog.pg_get_functiondef(function_record.oid);
    corrected_definition := pg_catalog.regexp_replace(
      definition,
      $pattern$(errcode\s*=\s*)'40001'$pattern$,
      $replacement$\1'PT409'$replacement$,
      'gi'
    );
    if corrected_definition = definition then
      raise exception 'Could not correct retryable business conflict in %.%',
        function_record.nspname, function_record.proname;
    end if;
    execute corrected_definition;
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('private', 'public')
      and p.prokind = 'f'
      and p.proname like 'stockflow%'
      and p.prosrc ~* $pattern$errcode\s*=\s*'40001'$pattern$
  ) then
    raise exception 'Retryable SQLSTATE 40001 remains in a StockFlow business function';
  end if;
end
$migration$;
