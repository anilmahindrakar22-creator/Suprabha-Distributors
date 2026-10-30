-- Edit this to the newest local migration version included in the deployed train.
\set expected_latest '20261031150000'

begin transaction read only;
set local statement_timeout = '30s';

-- 1. Migration history: guard the production-only Supabase history relation.
select 'migrations_applied' as check_name, 'WARN' as status,
       'supabase_migrations.schema_migrations not present' as detail
where to_regclass('supabase_migrations.schema_migrations') is null
union all
select 'migrations_applied',
       case when history.latest_version < :'expected_latest' then 'WARN' else 'PASS' end,
       format('count=%s; latest=%s; newest_5=%s; expected_at_least=%s',
         history.migration_count, coalesce(history.latest_version,'none'), coalesce(history.newest_five,'none'), :'expected_latest')
from (select count(*)::bigint as migration_count, max(version::text) as latest_version,
             (select string_agg(version, ', ' order by version desc)
              from (select version::text as version from supabase_migrations.schema_migrations order by version::text desc limit 5) v) as newest_five
      from supabase_migrations.schema_migrations) history
where to_regclass('supabase_migrations.schema_migrations') is not null;

-- 2. Tally source freshness. Each source relation gets its own guarded branch.
select 'tally_freshness' as check_name, 'WARN' as status,
       'private.stockflow_economic_source_vouchers not present' as detail
where to_regclass('private.stockflow_economic_source_vouchers') is null
union all
select 'tally_freshness',
       case when source.latest_at is null or source.latest_at < now()-interval '24 hours' then 'WARN' else 'PASS' end,
       format('source=economics; latest=%s',coalesce(source.latest_at::text,'missing'))
from (select max(imported_at) as latest_at from private.stockflow_economic_source_vouchers) source
where to_regclass('private.stockflow_economic_source_vouchers') is not null
union all
select 'tally_freshness', 'WARN', 'public.stockflow_snapshots not present'
where to_regclass('public.stockflow_snapshots') is null
union all
select 'tally_freshness',
       case when source.latest_at is null or source.latest_at < now()-interval '24 hours' then 'WARN' else 'PASS' end,
       format('source=stock; company=%s; latest=%s',coalesce(source.company_id,'missing'),coalesce(source.latest_at::text,'missing'))
from (select company as company_id,
             max(coalesce(nullif(payload->>'fetchedAtIso',''),nullif(payload->>'fetchedAt',''),fetched_at)::timestamptz) as latest_at
      from public.stockflow_snapshots group by company
      union all
      select null::text, null::timestamptz where not exists(select 1 from public.stockflow_snapshots)) source
where to_regclass('public.stockflow_snapshots') is not null;

-- 3. Three most recent complete calendar months per linked company. Guard both the table and function.
select 'sales_coverage' as check_name, 'WARN' as status,
       'private.stockflow_economic_customer_identities not present' as detail
where to_regclass('private.stockflow_economic_customer_identities') is null
union all
select 'sales_coverage', 'WARN', 'private.stockflow_sales_coverage_status(text,date,date) not present'
where to_regprocedure('private.stockflow_sales_coverage_status(text,date,date)') is null
union all
select 'sales_coverage',
       case when (coverage.status->>'complete')::boolean then 'PASS' else 'WARN' end,
       format('company=%s; window=%s..%s; complete=%s; blocking_exceptions=%s',
         identities.company_id, months.month_from, (months.month_from + interval '1 month - 1 day')::date,
         coalesce(coverage.status->>'complete','false'), coalesce(coverage.status->>'blockingCount','unknown'))
from (select distinct company_id from private.stockflow_economic_customer_identities) identities
cross join (select (date_trunc('month',current_date)::date - n*interval '1 month')::date as month_from
            from generate_series(3,1,-1) n) months
cross join lateral (select private.stockflow_sales_coverage_status(
  identities.company_id,months.month_from,(months.month_from+interval '1 month - 1 day')::date) as status) coverage
where to_regclass('private.stockflow_economic_customer_identities') is not null
  and to_regprocedure('private.stockflow_sales_coverage_status(text,date,date)') is not null
order by 1,2;

-- 4. Member table and role validator are optional in local or partial deployments.
select 'members' as check_name, 'WARN' as status, 'public.stockflow_members not present' as detail
where to_regclass('public.stockflow_members') is null
union all
select 'members', 'WARN', 'private.stockflow_valid_roles(text[]) not present'
where to_regprocedure('private.stockflow_valid_roles(text[])') is null
union all
select 'members',
       case when members.active_admins=0 or members.invalid_roles>0 then 'WARN' else 'PASS' end,
       format('counts_by_role_status=%s; active_administrators=%s; members_with_role_outside_roles_set=%s',
         coalesce(members.counts_by_role_status,'[]'),members.active_admins,members.invalid_roles)
from (select coalesce((select jsonb_agg(jsonb_build_object('role',role,'status',status,'count',member_count) order by role,status)::text
                       from (select role,status,count(*)::bigint as member_count from public.stockflow_members group by role,status) counts),'[]') as counts_by_role_status,
             count(*) filter(where status='active' and role='administrator')::bigint as active_admins,
             count(*) filter(where not coalesce(private.stockflow_valid_roles(array[role]),false))::bigint as invalid_roles
      from public.stockflow_members) members
where to_regclass('public.stockflow_members') is not null
  and to_regprocedure('private.stockflow_valid_roles(text[])') is not null;

-- 5. Leftover test orders. Do not return customer names or notes.
select 'leftover_test_orders' as check_name, 'WARN' as status,
       'private.stockflow_orders not present' as detail
where to_regclass('private.stockflow_orders') is null
union all
select 'leftover_test_orders',
       case when matching_orders>0 then 'WARN' else 'PASS' end,
       format('count=%s',matching_orders)
from (select count(*)::bigint as matching_orders from private.stockflow_orders
      where status<>'cancelled' and (customer_name ilike '%test%' or coalesce(notes,'') ilike '%test%')) orders
where to_regclass('private.stockflow_orders') is not null;

-- 6. Market objects: report each absent object as WARN and keep present/missing detail bounded.
with required_objects(object_name,object_kind) as (values
  ('private.stockflow_commercial_opportunities','table'),
  ('private.stockflow_commercial_opportunity_closures','table'),
  ('private.stockflow_commercial_constraints','table'),
  ('private.stockflow_commercial_actions','table'),
  ('private.stockflow_commercial_action_results','table'),
  ('private.stockflow_contact_influences','table'),
  ('private.stockflow_contact_influence_ends','table'),
  ('public.stockflow_opportunity_gateway(text,text,text,jsonb)','function'),
  ('public.stockflow_action_gateway(text,text,text,jsonb)','function'),
  ('public.stockflow_my_actions_gateway(text,text,text,jsonb)','function'),
  ('public.stockflow_power_map_gateway(text,text,text,jsonb)','function')
), presence as (
  select object_name,object_kind,
         case when object_kind='table' then to_regclass(object_name) is not null
              else to_regprocedure(object_name) is not null end as exists_now
  from required_objects
)
select 'market_objects_present' as check_name,
       case when bool_and(exists_now) then 'PASS' else 'WARN' end as status,
       coalesce(string_agg(object_name||' not present',', ' order by object_name) filter(where not exists_now),'all required objects present') as detail
from presence;

-- 7. Guard every gateway signature before checking privileges on it.
with gateways(signature) as (values
  ('public.stockflow_opportunity_gateway(text,text,text,jsonb)'),
  ('public.stockflow_action_gateway(text,text,text,jsonb)'),
  ('public.stockflow_my_actions_gateway(text,text,text,jsonb)'),
  ('public.stockflow_power_map_gateway(text,text,text,jsonb)')
)
select 'market_gateway_grants' as check_name,
       case when to_regprocedure(signature) is null then 'WARN'
            when has_function_privilege('anon',to_regprocedure(signature),'execute')
              or has_function_privilege('authenticated',to_regprocedure(signature),'execute') then 'FAIL'
            else 'PASS' end as status,
       case when to_regprocedure(signature) is null then signature||' not present'
            when has_function_privilege('anon',to_regprocedure(signature),'execute')
              or has_function_privilege('authenticated',to_regprocedure(signature),'execute') then signature||' executable by anon or authenticated'
            else signature||' restricted' end as detail
from gateways;

-- 8. Guard every new private table before reading relrowsecurity.
with required_tables(table_name) as (values
  ('stockflow_commercial_opportunities'),('stockflow_commercial_opportunity_closures'),
  ('stockflow_commercial_constraints'),('stockflow_commercial_actions'),
  ('stockflow_commercial_action_results'),('stockflow_contact_influences'),('stockflow_contact_influence_ends')
), rls_state as (
  select table_name,to_regclass('private.'||table_name) as relation_oid
  from required_tables
)
select 'market_private_table_rls' as check_name,
       case when relation_oid is null then 'WARN'
            when (select relrowsecurity from pg_class where oid=relation_oid) then 'PASS'
            else 'FAIL' end as status,
       case when relation_oid is null then 'private.'||table_name||' not present'
            when (select relrowsecurity from pg_class where oid=relation_oid) then 'private.'||table_name||' RLS enabled'
            else 'private.'||table_name||' RLS disabled' end as detail
from rls_state;

rollback;
