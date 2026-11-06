begin;
create function pg_temp.safe_delete_assert(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%',message; end if; end $$;

do $test$
begin
  perform pg_temp.safe_delete_assert(position('delete from private.stockflow_supplier_prices where true;' in
    pg_get_functiondef('private.stockflow_import_tally_pricing_evidence()'::regprocedure))>0,
    'Supplier prices replacement requires WHERE for safeupdate');
  perform pg_temp.safe_delete_assert((select 'statement_timeout=24s'=any(proconfig) from pg_proc
    where oid='public.stockflow_sync_snapshot(jsonb)'::regprocedure),'Snapshot statement timeout must be 24s');
  perform pg_temp.safe_delete_assert(not exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    cross join lateral regexp_split_to_table(regexp_replace(p.prosrc,'--[^\r\n]*','','g'),';') as statements(statement)
    where n.nspname in ('public','private') and p.prokind='f'
      and not exists(select 1 from pg_depend d
        where d.classid='pg_proc'::regclass and d.objid=p.oid and d.objsubid=0 and d.deptype='e')
      and statement ~* '^\s*delete\s+from\s+[a-z_."]+\s*$'
  ),'Non-extension function contains DELETE without WHERE');
end $test$;
rollback;
