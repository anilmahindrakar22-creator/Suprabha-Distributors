begin;
create function pg_temp.deferred_assert(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%',message;end if;end$$;

create function pg_temp.deferred_upload(revision integer) returns void language plpgsql as $$
begin
 perform public.stockflow_sync_snapshot(jsonb_build_object('company','SUPRABHA DISTRIBUTORS','fetchedAtIso',clock_timestamp(),
  'rows','[]'::jsonb,'groups','[]'::jsonb,'catalog',jsonb_build_object('deferredRevision',revision),
  'economicEvidence',jsonb_build_object('schemaVersion',1,'companyId','deferred-test','sourceVersion',clock_timestamp(),
   'vouchers',jsonb_build_array(jsonb_build_object('sourceId','deferred-sale','revision',revision,'date','2026-07-10',
    'kind','sale','amountStatus','verified','lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','deferred-product',
     'quantity',1,'unit','Nos','netSalesPaise',100*revision,'gstPaise',18)))))));
end$$;

-- Fail after publication writes to prove the worker rolls the entire rebuild back.
create temp sequence deferred_rebuild_calls;
create function pg_temp.deferred_force_error(original text,code text) returns void language plpgsql as $$
declare anchor text:='return run;';
begin
 perform pg_temp.deferred_assert((length(original)-length(replace(original,anchor,'')))/length(anchor)=1,
  'Expected exactly one rebuild return anchor');
 execute replace(original,anchor,format($patch$perform nextval('pg_temp.deferred_rebuild_calls');
  raise exception 'Forced deferred rebuild failure' using errcode=%L;
  return run;$patch$,code));
end$$;

insert into public.stockflow_members(email,role,status) values('deferred-sales@test.local','sales','active');
update private.stockflow_gateway_config
 set secret_sha256=encode(extensions.digest('deferred-test-key','sha256'),'hex') where name='orders';

do $test$
declare original text; guard_anchor text:='>10000 then raise exception'; runs_before bigint; results_before jsonb;
 first_pending timestamptz; first_since timestamptz; saved_snapshot jsonb; code text; revision integer:=4;
 calls_before bigint; summary jsonb; role_name text;
begin
 -- D1. The migration preserves inline publication by default.
 perform pg_temp.deferred_assert((select mode='inline' from private.stockflow_economic_rebuild_settings),'D1 default mode');
 select count(*) into runs_before from private.stockflow_economic_runs;
 perform pg_temp.deferred_upload(1);
 perform pg_temp.deferred_assert((select count(*) from private.stockflow_economic_runs)=runs_before+1,'D1 inline run');
 select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) into results_before from private.stockflow_economic_results r;
 perform pg_temp.deferred_assert(jsonb_array_length(results_before)>0,'D1 fixture publishes results');

 -- D2. Only source evidence and the snapshot advance during deferred uploads.
 update private.stockflow_economic_rebuild_settings set mode='deferred' where id;
 select count(*) into runs_before from private.stockflow_economic_runs;
 perform pg_temp.deferred_upload(2);
 perform pg_temp.deferred_assert((select count(*) from private.stockflow_economic_runs)=runs_before,'D2 no inline run');
 perform pg_temp.deferred_assert((select jsonb_agg(to_jsonb(r) order by r.id) from private.stockflow_economic_results r)=results_before,'D2 no new results');
 perform pg_temp.deferred_assert((select payload->'catalog'->>'deferredRevision' from public.stockflow_snapshots where id='suprabha')='2','D2 snapshot saved');
 perform pg_temp.deferred_assert(exists(select 1 from private.stockflow_economic_source_vouchers where company_id='deferred-test' and source_revision=2),'D2 evidence saved');
 select pending_since into first_pending from private.stockflow_economic_rebuild_status where company_id='deferred-test';
 perform pg_temp.deferred_assert(first_pending is not null,'D2 pending recorded');
 perform pg_temp.deferred_assert((private.stockflow_sales_coverage_read(array['accounts'])->'rebuild'->>'pendingSince')::timestamptz=first_pending,'D2 coverage pendingSince');

 -- D3. Subsequent evidence preserves the age of the outstanding request.
 perform pg_temp.deferred_upload(3);
 perform pg_temp.deferred_assert((select pending_since from private.stockflow_economic_rebuild_status where company_id='deferred-test')=first_pending,'D3 first pending retained');

 -- D4. One global publication covers all pending companies.
 perform private.stockflow_request_economic_rebuild('deferred-second-test');
 perform pg_temp.deferred_assert(private.stockflow_run_pending_economic_rebuild()=1,'D4 published return');
 perform pg_temp.deferred_assert((select count(*) from private.stockflow_economic_runs)=runs_before+1,'D4 exactly one run');
 perform pg_temp.deferred_assert((select actor='tally-sync' from private.stockflow_economic_runs where active),'D4 actor');
 perform pg_temp.deferred_assert((select count(*)=2 from private.stockflow_economic_rebuild_status
  where company_id in ('deferred-test','deferred-second-test') and state='ok' and reason is null and since is null and pending_since is null and attempts=0),'D4 all pending cleared');
 perform pg_temp.deferred_assert(exists(select 1 from private.stockflow_economic_results r
  join private.stockflow_economic_source_lines l on l.id=r.source_line_id
  join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id
  join private.stockflow_economic_runs run on run.id=r.run_id and run.active
  where v.company_id='deferred-test' and v.source_revision=3),'D4 latest evidence published');

 -- D5. An idle tick costs no generation.
 perform pg_temp.deferred_assert(private.stockflow_run_pending_economic_rebuild()=0,'D5 idle return');
 perform pg_temp.deferred_assert((select count(*) from private.stockflow_economic_runs)=runs_before+1,'D5 no extra run');

 -- D6. The existing 54000 guard pauses publication while retaining the upload.
 original:=pg_get_functiondef('private.stockflow_rebuild_instrument_economics(text)'::regprocedure);
 perform pg_temp.deferred_assert((length(original)-length(replace(original,guard_anchor,'')))/length(guard_anchor)=1,'D6 unique guard');
 execute replace(original,guard_anchor,'>-1 then raise exception');
 perform pg_temp.deferred_upload(4);
 select payload into saved_snapshot from public.stockflow_snapshots where id='suprabha';
 select count(*) into runs_before from private.stockflow_economic_runs;
 select jsonb_agg(to_jsonb(r) order by r.id) into results_before from private.stockflow_economic_results r;
 perform pg_temp.deferred_assert(private.stockflow_run_pending_economic_rebuild()=0,'D6 contained 54000');
 perform pg_temp.deferred_assert((select count(*) from private.stockflow_economic_runs)=runs_before,'D6 runs unchanged');
 perform pg_temp.deferred_assert((select jsonb_agg(to_jsonb(r) order by r.id) from private.stockflow_economic_results r)=results_before,'D6 results unchanged');
 perform pg_temp.deferred_assert((select payload from public.stockflow_snapshots where id='suprabha')=saved_snapshot
  and saved_snapshot->'catalog'->>'deferredRevision'='4','D6 snapshot intact');
 perform pg_temp.deferred_assert((select state='paused' and reason is not null and since is not null and pending_since is null and attempts=0
  from private.stockflow_economic_rebuild_status where company_id='deferred-test'),'D6 paused without pending');
 execute original;

 -- D7 and D8. Ordinary errors and explicit cancellation roll back publication and retry.
 foreach code in array array['22023','57014'] loop
  revision:=revision+1;
  select since into first_since from private.stockflow_economic_rebuild_status where company_id='deferred-test';
  perform pg_temp.deferred_upload(revision);
  select pending_since into first_pending from private.stockflow_economic_rebuild_status where company_id='deferred-test';
  perform pg_temp.deferred_assert((select since is not distinct from first_since from private.stockflow_economic_rebuild_status where company_id='deferred-test'),'Request retains prior pause');
  select count(*) into runs_before from private.stockflow_economic_runs;
  select jsonb_agg(to_jsonb(r) order by r.id) into results_before from private.stockflow_economic_results r;
  select payload into saved_snapshot from public.stockflow_snapshots where id='suprabha';
  perform pg_temp.deferred_force_error(original,code);
  perform pg_temp.deferred_assert(private.stockflow_run_pending_economic_rebuild()=0,'D7/D8 contained '||code);
  perform pg_temp.deferred_assert((select count(*) from private.stockflow_economic_runs)=runs_before,'D7/D8 runs rolled back');
  perform pg_temp.deferred_assert((select jsonb_agg(to_jsonb(r) order by r.id) from private.stockflow_economic_results r)=results_before,'D7/D8 results rolled back');
  perform pg_temp.deferred_assert((select payload from public.stockflow_snapshots where id='suprabha')=saved_snapshot,'D7/D8 snapshot intact');
  perform pg_temp.deferred_assert((select state='paused' and reason='Forced deferred rebuild failure' and since is not null
   and (first_since is null or since=first_since) and attempts=1 and pending_since=first_pending
   from private.stockflow_economic_rebuild_status where company_id='deferred-test'),'D7/D8 retry retained');
  execute original;
  perform pg_temp.deferred_assert(private.stockflow_run_pending_economic_rebuild()=1,'D7/D8 retry publishes');
  perform pg_temp.deferred_assert((select state='ok' and reason is null and since is null and pending_since is null and attempts=0
   from private.stockflow_economic_rebuild_status where company_id='deferred-test'),'D7/D8 retry clears pause');
 end loop;

 -- D9. A rollback to inline preserves pending work with no newer generation.
 perform private.stockflow_request_economic_rebuild('deferred-test');
 update private.stockflow_economic_rebuild_settings set mode='inline' where id;
 select count(*) into runs_before from private.stockflow_economic_runs;
 perform pg_temp.deferred_assert(private.stockflow_run_pending_economic_rebuild()=0,'D9 inline worker return');
 perform pg_temp.deferred_assert((select count(*) from private.stockflow_economic_runs)=runs_before,'D9 no run');
 perform pg_temp.deferred_assert((select pending_since is not null from private.stockflow_economic_rebuild_status where company_id='deferred-test'),'D9 pending retained');

 -- D9a/D9b. Simulate a request from an earlier transaction because runs.created_at defaults to now().
 foreach code in array array['inline','deferred'] loop
  update private.stockflow_economic_rebuild_settings set mode=code where id;
  perform private.stockflow_request_economic_rebuild('deferred-test');
  update private.stockflow_economic_rebuild_status set pending_since=transaction_timestamp()-interval '1 second',attempts=2 where company_id='deferred-test';
  perform private.stockflow_rebuild_instrument_economics('deferred-test-user');
  select count(*) into runs_before from private.stockflow_economic_runs;
  perform pg_temp.deferred_assert(private.stockflow_run_pending_economic_rebuild()=0,'D9a/D9b already covered return');
  perform pg_temp.deferred_assert((select count(*) from private.stockflow_economic_runs)=runs_before,'D9a/D9b no duplicate run');
  perform pg_temp.deferred_assert((select pending_since is null and attempts=0 from private.stockflow_economic_rebuild_status where company_id='deferred-test'),'D9a/D9b clears pending');
 end loop;

 -- New evidence after an inline publication must not inherit its already-covered pending age.
 -- Represent the earlier committed request explicitly because this whole fixture rolls back.
 perform private.stockflow_request_economic_rebuild('deferred-test');
 update private.stockflow_economic_rebuild_status set pending_since=transaction_timestamp()-interval '1 second' where company_id='deferred-test';
 perform private.stockflow_rebuild_instrument_economics('deferred-test-user');
 select count(*) into runs_before from private.stockflow_economic_runs;
 perform pg_temp.deferred_upload(7);
 perform pg_temp.deferred_assert((select pending_since>transaction_timestamp() from private.stockflow_economic_rebuild_status where company_id='deferred-test'),
  'New evidence replaces a covered pending timestamp');
 perform pg_temp.deferred_assert(private.stockflow_run_pending_economic_rebuild()=1,'New evidence after inline command publishes');
 perform pg_temp.deferred_assert((select count(*) from private.stockflow_economic_runs)=runs_before+1,'New evidence needs one further run');
 perform pg_temp.deferred_assert(exists(select 1 from private.stockflow_economic_results r
  join private.stockflow_economic_source_lines l on l.id=r.source_line_id
  join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id
  join private.stockflow_economic_runs run on run.id=r.run_id and run.active
  where v.company_id='deferred-test' and v.source_revision=7),'New evidence is covered by the worker run');

 -- D9c. Three failures exhaust retries until new evidence resets the allowance.
 perform private.stockflow_request_economic_rebuild('deferred-test');
 perform pg_temp.deferred_force_error(original,'22023');
 for revision in 1..3 loop
  perform pg_temp.deferred_assert(private.stockflow_run_pending_economic_rebuild()=0,'D9c failure contained');
  perform pg_temp.deferred_assert((select attempts=revision and pending_since is not null from private.stockflow_economic_rebuild_status where company_id='deferred-test'),'D9c attempt counted');
  if revision=1 then
   select since into first_since from private.stockflow_economic_rebuild_status where company_id='deferred-test';
  end if;
 end loop;
 select last_value into calls_before from pg_temp.deferred_rebuild_calls;
 perform pg_temp.deferred_assert(private.stockflow_run_pending_economic_rebuild()=0,'D9c capped return');
 perform pg_temp.deferred_assert((select last_value from pg_temp.deferred_rebuild_calls)=calls_before,'D9c fourth tick never calls rebuild');
 perform pg_temp.deferred_assert((select attempts=3 and since=first_since from private.stockflow_economic_rebuild_status where company_id='deferred-test'),'D9c cap and first pause retained');
 perform pg_temp.deferred_upload(8);
 perform pg_temp.deferred_assert((select attempts=0 and since=first_since and state='paused' and reason='Forced deferred rebuild failure'
  from private.stockflow_economic_rebuild_status where company_id='deferred-test'),'D9c new evidence resets only attempts');
 execute original;
 perform pg_temp.deferred_assert(private.stockflow_run_pending_economic_rebuild()=1,'D9c new evidence retries');

 -- D10. Sales receives only the two public status fields, even when a private reason exists.
 update private.stockflow_economic_rebuild_status set state='paused',reason='Private diagnostic',pending_since=clock_timestamp(),updated_at=clock_timestamp() where company_id='deferred-test';
 summary:=public.stockflow_order_summary_gateway('deferred-test-key','deferred-sales@test.local','get_order_summary');
 perform pg_temp.deferred_assert((select array_agg(key order by key) from jsonb_object_keys(summary->'economicsStatus') key)=array['pendingSince','state'],'D10 public status keys');
 perform pg_temp.deferred_assert(summary->'economicsStatus'->>'state'='paused'
  and summary->'economicsStatus'->>'pendingSince' is not null,'D10 public status values');

 -- D11. Only the database owner can operate the switch and worker.
 foreach role_name in array array['anon','authenticated','service_role'] loop
  perform pg_temp.deferred_assert(not has_table_privilege(role_name,'private.stockflow_economic_rebuild_settings','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),'D11 settings denied '||role_name);
  perform pg_temp.deferred_assert(not has_function_privilege(role_name,'private.stockflow_request_economic_rebuild(text)','EXECUTE'),'D11 request denied '||role_name);
  perform pg_temp.deferred_assert(not has_function_privilege(role_name,'private.stockflow_run_pending_economic_rebuild()','EXECUTE'),'D11 worker denied '||role_name);
 end loop;
end $test$;
rollback;
