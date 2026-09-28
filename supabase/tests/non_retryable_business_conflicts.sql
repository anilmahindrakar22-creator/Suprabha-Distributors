do $test$
begin
  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('private', 'public')
      and p.prokind = 'f'
      and p.proname like 'stockflow%'
      and p.prosrc ~* $pattern$errcode\s*=\s*'40001'$pattern$
  ) then
    raise exception 'A StockFlow business function still raises retryable SQLSTATE 40001';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('private', 'public')
      and p.prokind = 'f'
      and p.proname like 'stockflow%'
      and p.prosrc ~* $pattern$errcode\s*=\s*'PT409'$pattern$
  ) then
    raise exception 'No non-retryable StockFlow conflict guard was installed';
  end if;
end
$test$;
