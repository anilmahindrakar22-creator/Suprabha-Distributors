\set ON_ERROR_STOP on
set timezone = 'Asia/Kolkata';
-- SQL gateway time, including authentication, role checks and JSON construction.
-- Excludes HTTP, application transformation, network and client rendering.
create temporary table perf_reads(name text primary key, query text, inner_query text);
insert into perf_reads values
 ('get_today',$q$select public.stockflow_today_gateway('PERF local gateway 20261102','perf-admin-1@test.local','get_today','{}')$q$,null),
 ('wallet_all',$q$select public.stockflow_wallet_gateway('PERF local gateway 20261102','perf-admin-1@test.local','get_wallet_workspace','{"view":"all","page":1,"search":""}')$q$,
  $q$select private.stockflow_wallet_read((now() at time zone 'Asia/Kolkata')::date)$q$),
 ('wallet_focus',$q$select public.stockflow_wallet_gateway('PERF local gateway 20261102','perf-admin-1@test.local','get_wallet_workspace','{"view":"focus","page":1,"search":""}')$q$,
  $q$select private.stockflow_wallet_read((now() at time zone 'Asia/Kolkata')::date)$q$),
 ('wallet_account',$q$select public.stockflow_wallet_gateway('PERF local gateway 20261102','perf-admin-1@test.local','get_wallet_account',jsonb_build_object('customerId',md5('PERF customer 1')::uuid))$q$,
  $q$select private.stockflow_wallet_account_read((now() at time zone 'Asia/Kolkata')::date,md5('PERF customer 1')::uuid)$q$),
 -- A full wallet page of 50 IDs, rather than the empty-array fast path.
 ('wallet_diagnoses',$q$select public.stockflow_opportunity_gateway('PERF local gateway 20261102','perf-admin-1@test.local','get_wallet_diagnoses',jsonb_build_object('customerIds',(select jsonb_agg(md5('PERF customer '||n)::uuid order by n) from generate_series(1,50) n)))$q$,null),
 ('accounts',$q$select public.stockflow_accounts_gateway('PERF local gateway 20261102','perf-admin-1@test.local','get_accounts','{"search":"","scope":"all","page":1}')$q$,null),
 ('customer_map',$q$select public.stockflow_customer_map_gateway('PERF local gateway 20261102','perf-admin-1@test.local','get_map_pins','{"south":15.4,"west":75.0,"north":18.6,"east":77.9}')$q$,null),
 ('service_workspace',$q$select public.stockflow_service_gateway('PERF local gateway 20261102','perf-admin-1@test.local','get_service_workspace','{}')$q$,null),
 ('recover',$q$select private.stockflow_recover_read((now() at time zone 'Asia/Kolkata')::date)$q$,null);

-- Extract the real shared Wallet CTE from the replayed function, rather than
-- maintaining a copied query or explaining an opaque function Result node.
-- Bind its PL/pgSQL variables to this run's certified state and current policy.
-- Fail closed on definition drift; the final report will explain the skip.
do $$
declare body text; v_inner_sql text; first_pos integer; last_pos integer;
 today date:=(now() at time zone 'Asia/Kolkata')::date;
 window_end date:=date_trunc('month',today)::date; policy jsonb;
begin
 select prosrc into body from pg_proc where oid='private.stockflow_wallet_read(date)'::regprocedure;
 body:=replace(body,chr(13),'');
 first_pos:=strpos(body,' with latest as (');
 last_pos:=strpos(body,' into rows,summary,unlinked,unlinked_count from output;');
 if first_pos>0 and last_pos>first_pos then
  v_inner_sql:=substr(body,first_pos,last_pos-first_pos)||' from output';
  policy:=private.stockflow_wallet_policy_read();
  v_inner_sql:=regexp_replace(v_inner_sql,'\mp_today\M',format('%L::date',today),'g');
  v_inner_sql:=regexp_replace(v_inner_sql,'\mwindow_start\M',format('%L::date',(window_end-interval '3 months')::date),'g');
  v_inner_sql:=regexp_replace(v_inner_sql,'\mwindow_end\M',format('%L::date',window_end),'g');
  v_inner_sql:=regexp_replace(v_inner_sql,'\mcertified\M','true','g');
  v_inner_sql:=regexp_replace(v_inner_sql,'\mpolicy\M',format('%L::jsonb',policy),'g');
  update perf_reads set inner_query=v_inner_sql where name in ('wallet_all','wallet_focus','wallet_account');
 else
  update perf_reads set inner_query=null where name in ('wallet_all','wallet_focus','wallet_account');
 end if;
end $$;
create temporary table perf_results(name text primary key, median_ms numeric, max_ms numeric, bytes integer);
do $$
declare r record; sample integer; started timestamptz; result jsonb; elapsed numeric[];
 med numeric; maximum numeric; size integer;
begin
 for r in select * from perf_reads order by name loop
  execute r.query into result; -- One warm-up; excluded from all reported samples.
  elapsed:='{}';
  for sample in 1..5 loop
   started:=clock_timestamp();
   execute r.query into result;
   elapsed:=array_append(elapsed,extract(epoch from clock_timestamp()-started)*1000);
  end loop;
  select percentile_cont(0.5) within group(order by ms)::numeric,max(ms) into med,maximum from unnest(elapsed) ms;
  size:=octet_length(result::text);
  insert into perf_results values(r.name,med,maximum,size);
  raise notice 'perf % median_ms=% max_ms=% bytes=%',r.name,round(med,3),round(maximum,3),size;
 end loop;
end $$;
-- Select the two slowest by measured median (name breaks ties). EXPLAIN of a
-- callable/extracted inner query exposes the main plan. Helper function plans
-- remain opaque. These EXPLAIN times are separate from the gateway samples.
do $$
declare r record; plan_line text;
begin
 for r in select p.*,s.median_ms from perf_results s join perf_reads p using(name)
  order by s.median_ms desc,p.name limit 2 loop
  if r.inner_query is null then
   raise notice 'explain % skipped: no separately callable main query or verified extraction for this PL/pgSQL branch',r.name;
  else
   raise notice 'explain % main inner query (shared Wallet calculation; certified=true): %',r.name,r.inner_query;
   for plan_line in execute 'EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) '||r.inner_query loop
    raise notice '%',plan_line;
   end loop;
  end if;
 end loop;
end $$;
