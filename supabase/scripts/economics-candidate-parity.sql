-- Acceptance tool; NOT part of the replay. Run on production only with the
-- owner's go-ahead, outside billing hours. This transaction holds the economics
-- advisory lock (instrument-economics-v1) for its entire duration after rebuild.
-- Real-data parity works only while TOTAL source lines are <= 10,000: the
-- preserved full_scan function deliberately retains its original 54000 guard.
-- All projections, restatement events and active-run changes are rolled back.
begin;

-- BEGIN SHARED PARITY HELPERS (also embedded in the standalone acceptance script).
create function pg_temp.candidate_snapshot(p_run uuid) returns jsonb language plpgsql as $$
declare snapshot jsonb;
begin
 if (select id from private.stockflow_economic_runs where active) is distinct from p_run then
  raise exception 'Snapshot must be taken immediately after its rebuild';
 end if;
 select jsonb_build_object(
  'run',p_run,
  'results',coalesce((select jsonb_agg(to_jsonb(x) order by x.source_line_id,x.target_id nulls first) from (
   select source_line_id,target_id,status,reason,share_bps,quantity,revenue_paise,cost_paise,gp_paise,recovery_origin_date
   from private.stockflow_economic_results where run_id=p_run
  ) x),'[]'::jsonb),
  'links',coalesce((select jsonb_agg(to_jsonb(x) order by x.sale_line_id,x.purchase_line_id) from (
   select sale_line_id,purchase_line_id,quantity,cost_paise from private.stockflow_economic_auto_cost_links where run_id=p_run
  ) x),'[]'::jsonb),
  'events',coalesce((select jsonb_agg(to_jsonb(x) order by x.target_id,x.kind,x.amount_paise,x.effective_date) from (
   select e.target_id,e.kind,e.amount_paise,e.effective_date from private.stockflow_economic_events e
   join private.stockflow_economic_results r on r.id=e.source_result_id
   where r.run_id=p_run and e.kind in ('gp','contribution') and e.reverses_id is null
  ) x),'[]'::jsonb),
  'summary',private.stockflow_economic_workspace_read(array['management'],true),
  'full',private.stockflow_economic_workspace_read(array['management'],false)
 ) into snapshot;
 return snapshot;
end$$;
-- Deliberately strip ONLY run IDs and timestamps, as required by acceptance.
-- Keep generated result/event IDs, ledger history, business dates, array order,
-- amounts and reasons intact. A literal full-read comparison can therefore
-- expose differences inherent even in two unchanged rebuilds; do not hide them.
create function pg_temp.candidate_read_bytes(p_value jsonb) returns jsonb language plpgsql immutable as $$
declare result jsonb;
begin
 if jsonb_typeof(p_value)='object' then
  select coalesce(jsonb_object_agg(key,pg_temp.candidate_read_bytes(value)),'{}'::jsonb) into result
  from jsonb_each(p_value)
  where key not in ('generation','generationId','run_id','runId','lastRebuiltAt','sourceImportedAt',
   'created_at','createdAt','recorded_at','recordedAt','imported_at','importedAt','observed_at','observedAt','updated_at','updatedAt');
  return result;
 elsif jsonb_typeof(p_value)='array' then
  select coalesce(jsonb_agg(pg_temp.candidate_read_bytes(value) order by ordinality),'[]'::jsonb) into result
  from jsonb_array_elements(p_value) with ordinality;
  return result;
 end if;
 return p_value;
end$$;
-- A5 normalisation (conductor decision, 30 Oct 2026): the full read's ledger
-- accumulates history across runs. Compare only the live postings: drop reversal
-- rows and the rows they reverse, strip generated identifiers and the run actor,
-- and sort. Amounts, dates, targets, kinds and reasons are still compared exactly.
create function pg_temp.candidate_strip(p jsonb) returns jsonb language sql immutable as $$
 select p-'id'-'request_id'-'requestId'-'source_result_id'-'sourceResultId'-'reverses_id'-'reversesId'-'actor'-'resultId'
$$;
create function pg_temp.candidate_full_read(p jsonb) returns jsonb language sql immutable as $$
 select pg_temp.candidate_read_bytes(p)
  || jsonb_build_object('ledger',coalesce((select jsonb_agg(pg_temp.candidate_strip(e) order by pg_temp.candidate_strip(e)::text)
     from jsonb_array_elements(p->'ledger') e
     where e->>'kind'<>'reversal'
      and not exists(select 1 from jsonb_array_elements(p->'ledger') r where r->>'kind'='reversal' and r->>'reverses_id'=e->>'id')),'[]'::jsonb))
  || jsonb_build_object('attributionLines',coalesce((select jsonb_agg(pg_temp.candidate_strip(pg_temp.candidate_read_bytes(a)) order by pg_temp.candidate_strip(pg_temp.candidate_read_bytes(a))::text)
     from jsonb_array_elements(p->'attributionLines') a),'[]'::jsonb))
$$;
-- END SHARED PARITY HELPERS

-- Recursively report every differing field, preserving duplicate array entries.
create function pg_temp.candidate_differences(p_old jsonb,p_new jsonb,p_path text)
returns table(path text,old_value jsonb,new_value jsonb) language plpgsql as $$
declare k text; i integer;
begin
 if p_old::text is not distinct from p_new::text then return;end if;
 if jsonb_typeof(p_old)='object' and jsonb_typeof(p_new)='object' then
  for k in select jsonb_object_keys(p_old) union select jsonb_object_keys(p_new) loop
   return query select * from pg_temp.candidate_differences(p_old->k,p_new->k,p_path||'.'||k);
  end loop;
 elsif jsonb_typeof(p_old)='array' and jsonb_typeof(p_new)='array' then
  for i in 0..greatest(jsonb_array_length(p_old),jsonb_array_length(p_new))-1 loop
   return query select * from pg_temp.candidate_differences(p_old->i,p_new->i,p_path||'['||i||']');
  end loop;
 else
  return query select p_path,p_old,p_new;
 end if;
end$$;

do $parity$
declare old_run uuid; new_run uuid; old_snapshot jsonb; new_snapshot jsonb;
 part text; difference record; differences bigint:=0;
begin
 old_run:=private.stockflow_rebuild_instrument_economics_full_scan('candidate-parity');
 old_snapshot:=pg_temp.candidate_snapshot(old_run);
 new_run:=private.stockflow_rebuild_instrument_economics('candidate-parity');
 new_snapshot:=pg_temp.candidate_snapshot(new_run);
 old_snapshot:=jsonb_set(old_snapshot,array['summary'],pg_temp.candidate_read_bytes(old_snapshot->'summary'));
 new_snapshot:=jsonb_set(new_snapshot,array['summary'],pg_temp.candidate_read_bytes(new_snapshot->'summary'));
 foreach part in array array['results','links','events','summary'] loop
  for difference in select * from pg_temp.candidate_differences(old_snapshot->part,new_snapshot->part,part) loop
   differences:=differences+1;
   raise notice 'PARITY DIFFERENCE %: full_scan=% candidate=%',difference.path,difference.old_value,difference.new_value;
  end loop;
 end loop;
 if pg_temp.candidate_full_read(old_snapshot->'full')::text is distinct from pg_temp.candidate_full_read(new_snapshot->'full')::text then
  differences:=differences+1;
  raise notice 'PARITY DIFFERENCE full: full_scan=% candidate=%',pg_temp.candidate_full_read(old_snapshot->'full'),pg_temp.candidate_full_read(new_snapshot->'full');
 end if;
 if differences=0 then
  raise notice 'PARITY OK: results %, automatic cost links %, GP/contribution events %, summary and full reads',
   jsonb_array_length(new_snapshot->'results'),jsonb_array_length(new_snapshot->'links'),jsonb_array_length(new_snapshot->'events');
 else
  raise notice 'PARITY FAILED: % differing fields',differences;
 end if;
end$parity$;
rollback;
