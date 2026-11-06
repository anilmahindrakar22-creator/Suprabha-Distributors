begin;
create function pg_temp.control_source_assert(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%',message; end if; end $$;

insert into public.stockflow_members(email,role,status) values
 ('control-source-sales@test.local','sales','active'),
 ('control-source-ops@test.local','operations','active');
update private.stockflow_gateway_config
 set secret_sha256=encode(extensions.digest('control-source-test-key','sha256'),'hex') where name='orders';

do $test$
declare before_count bigint; before_rejected bigint; snapshot_time timestamptz; result jsonb; actor text;
begin
 select count(*) into before_count from private.stockflow_sales_control_imports;
 perform public.stockflow_sync_snapshot(jsonb_build_object('company','SUPRABHA DISTRIBUTORS',
  'fetchedAtIso',clock_timestamp(),'rows','[]'::jsonb,'groups','[]'::jsonb,
  'catalog',jsonb_build_object('retained',true),'salesControlTotals','null'::jsonb));
 perform pg_temp.control_source_assert((select count(*) from private.stockflow_sales_control_imports)=before_count,
  'JSON null control totals must not add an import row');
 perform pg_temp.control_source_assert((select not (s.payload ? 'salesControlTotals')
  from public.stockflow_snapshots s where id='suprabha'),'JSON null control key must be stripped from the snapshot');

 select count(*) into before_rejected from private.stockflow_sales_control_imports where rejected_parts=1;
 perform public.stockflow_sync_snapshot(jsonb_build_object('company','SUPRABHA DISTRIBUTORS',
  'fetchedAtIso',clock_timestamp(),'rows','[]'::jsonb,'groups','[]'::jsonb,
  'catalog',jsonb_build_object('retained',true),'salesControlTotals','{}'::jsonb));
 perform pg_temp.control_source_assert((select count(*) from private.stockflow_sales_control_imports)=before_count+1,
  'Invalid control envelope must still add exactly one import row');
 perform pg_temp.control_source_assert((select count(*) from private.stockflow_sales_control_imports
  where rejected_parts=1)=before_rejected+1,'Invalid control envelope must record rejected_parts=1');

 select s.updated_at into snapshot_time from public.stockflow_snapshots s where id='suprabha';
 foreach actor in array array['control-source-sales@test.local','control-source-ops@test.local'] loop
  result:=public.stockflow_order_summary_gateway('control-source-test-key',actor,'get_order_summary');
  perform pg_temp.control_source_assert(result ? 'sourceUpdatedAt'
   and (result->>'sourceUpdatedAt')::timestamptz=snapshot_time,'Snapshot source time missing or incorrect for '||actor);
  perform pg_temp.control_source_assert(result ? 'operations' and result ? 'orderRevision',
   'Existing order summary keys missing for '||actor);
  perform pg_temp.control_source_assert((select array_agg(key order by key) from jsonb_object_keys(result) key)
   =array['economicsStatus','operations','operationsDate','orderRevision','sourceUpdatedAt'],
   'Unexpected order summary keys for '||actor);
 end loop;
end $test$;

-- API sessions load safeupdate; inspect all non-extension application functions.
do $test$
declare candidate record;
begin
 for candidate in
  select p.oid::regprocedure as function_name,statements.statement
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  cross join lateral regexp_split_to_table(regexp_replace(p.prosrc,'--[^\r\n]*','','g'),';') as statements(statement)
  where n.nspname in ('public','private') and p.prokind='f'
   and not exists(select 1 from pg_depend d
    where d.classid='pg_proc'::regclass and d.objid=p.oid and d.objsubid=0 and d.deptype='e')
 loop
  perform pg_temp.control_source_assert(
   candidate.statement !~* '\ydelete\s+from\s+[a-z_."]+(\s+(as\s+)?[a-z_]+)?\s*$',
   format('Function %s contains DELETE without WHERE',candidate.function_name));
  perform pg_temp.control_source_assert(not (
   candidate.statement ~* '\yupdate\s+(only\s+)?[a-z_."]+(\s+(as\s+)?[a-z_]+)?\s+set\y'
   and candidate.statement !~* '\ywhere\y' and candidate.statement !~* '\yon\s+conflict\y'),
   format('Function %s contains UPDATE without WHERE',candidate.function_name));
 end loop;
end $test$;
rollback;
