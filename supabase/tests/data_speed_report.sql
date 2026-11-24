-- Disposable replay only; every fixture and gateway change rolls back.
begin;
set local statement_timeout='120s';
set local lock_timeout='10s';
create function pg_temp.ds_assert(ok boolean,label text) returns void language plpgsql as $$
begin
 if ok is distinct from true then raise exception 'Data speed report: %',label; end if;
end $$;
create function pg_temp.ds_constraints(relation regclass) returns void language plpgsql as $$
declare c record;
begin
 for c in select conname,pg_get_constraintdef(oid) definition from pg_constraint where conrelid=relation order by conname loop
  raise notice 'Fixture constraint %.%: %',relation,c.conname,c.definition;
 end loop;
 for c in select attname from pg_attribute where attrelid=relation and attnum>0 and not attisdropped and attnotnull order by attnum loop
  raise notice 'Fixture NOT NULL %.%',relation,c.attname;
 end loop;
end $$;
create function pg_temp.ds_call(action text default 'get_data_speed_report',payload jsonb default '{}'::jsonb) returns jsonb language sql as $$
 select public.stockflow_economics_gateway('ds-key','ds-manager@test.local',action,payload)
$$;
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('ds-key','sha256'),'hex') where name='orders';
select pg_temp.ds_constraints('public.stockflow_members');
-- Valid role/roles; active status; unique normalized emails.
insert into public.stockflow_members(email,role,roles,status) values
 ('ds-manager@test.local','management',array['management'],'active'),
 ('ds-admin@test.local','administrator',array['administrator'],'active'),
 ('ds-accounts@test.local','accounts',array['accounts'],'active'),
 ('ds-sales@test.local','sales',array['sales'],'active'),
 ('ds-ops@test.local','operations',array['operations'],'active');
-- Complete a gateway statement before inspecting stats (when tracking is loaded).
select public.stockflow_economics_gateway('ds-key','ds-manager@test.local','get_data_speed_report','{}'::jsonb);
do $test$
declare result jsonb; row_doc jsonb; payload jsonb; current_doc jsonb; base_doc jsonb; previous_doc jsonb;
 gateway_set text[]; screen_gateway_set text[];
 reset_at timestamptz; a_at timestamptz:=now()-interval '14 days'; b_at timestamptz:=now()-interval '7 days';
 inserted integer; actor text; signature text; db_role text; keys text[];
 reason text:='ds-test-'||extensions.gen_random_uuid()::text;
begin
 raise notice 'Data speed report phase: shape and extension availability';
 result:=pg_temp.ds_call();
 select array_agg(k order by k) into keys from jsonb_object_keys(result) k;
 perform pg_temp.ds_assert(keys=array['budget','exceptions','lastImportAt','lastRebuildAt','reads','snapshotCount','statsAvailable','statsResetAt','windowFrom'],'exact report keys');
 perform pg_temp.ds_assert(result->'budget'='{"meanMs":1000,"maxMs":3000}'::jsonb,'budget');
 perform pg_temp.ds_assert(jsonb_typeof(result->'statsAvailable')='boolean','availability boolean');
 perform pg_temp.ds_assert(jsonb_array_length(result->'reads')<=30 and jsonb_array_length(result->'exceptions')<=50,'caps');
 perform pg_temp.ds_assert(result->'lastImportAt' is not distinct from coalesce(to_jsonb((select max(imported_at) from private.stockflow_economic_source_vouchers)),'null'::jsonb),'import freshness');
 perform pg_temp.ds_assert(result->'lastRebuildAt' is not distinct from coalesce(to_jsonb((select created_at from private.stockflow_economic_runs where active)),'null'::jsonb),'rebuild freshness');
 if (result->>'statsAvailable')::boolean then
  begin
   execute $stats$
    select array_agg(distinct substring(query from 'stockflow_[a-z_]*gateway') order by substring(query from 'stockflow_[a-z_]*gateway'))
    from extensions.pg_stat_statements
    where query ~ 'stockflow_[a-z_]*gateway' and query ~* '^\s*with pgrst_source'
   $stats$ into screen_gateway_set;
   select array_agg(distinct value->>'gateway' order by value->>'gateway') into gateway_set
    from jsonb_array_elements(result->'reads');
   perform pg_temp.ds_assert(coalesce(gateway_set,'{}'::text[]) <@ coalesce(screen_gateway_set,'{}'::text[]),'reads come only from PostgREST statements');
  exception when others then
   raise notice 'Skipping pg_stat_statements screen-call set assertion: %',sqlerrm;
  end;
  for row_doc in select value from jsonb_array_elements(result->'reads') loop
   select array_agg(k order by k) into keys from jsonb_object_keys(row_doc) k;
   perform pg_temp.ds_assert(keys=array['calls','gateway','maxMs','meanMs','previousMeanMs'],'exact read keys');
   perform pg_temp.ds_assert((row_doc->>'calls')::bigint>=1 and (row_doc->>'meanMs')::numeric>=0 and (row_doc->>'maxMs')::numeric>=0,'valid read values');
   perform pg_temp.ds_assert(not exists(select 1 from jsonb_each_text(row_doc) v where lower(v.value) ~ 'select|with|\('),'no query text');
  end loop;
 else
  perform pg_temp.ds_assert(result->'reads'='[]'::jsonb and result->'statsResetAt'='null'::jsonb and result->'windowFrom'='null'::jsonb,'unavailable stats');
 end if;
 reset_at:=(result->>'statsResetAt')::timestamptz;
 raise notice 'Data speed report phase: synthetic batches and immutable window maths';
 -- Isolate batch selection from any pre-existing snapshots; rollback restores them.
 delete from private.stockflow_speed_snapshots;
 perform pg_temp.ds_constraints('private.stockflow_speed_snapshots');
 -- PK (taken_at,gateway); required timestamp, gateway and cumulative numbers.
 insert into private.stockflow_speed_snapshots(taken_at,stats_reset,gateway,calls,total_ms,max_ms)
 values(a_at,reset_at,'stockflow_zz_test_gateway',10,1000,400);
 perform pg_temp.ds_constraints('private.stockflow_speed_snapshots');
 insert into private.stockflow_speed_snapshots(taken_at,stats_reset,gateway,calls,total_ms,max_ms)
 values(b_at,reset_at,'stockflow_zz_test_gateway',20,4000,500);
 select jsonb_build_object('stats_reset',reset_at,'rows',jsonb_agg(to_jsonb(s))) into previous_doc
 from private.stockflow_speed_snapshots s where taken_at=a_at;
 select jsonb_build_object('stats_reset',reset_at,'rows',jsonb_agg(to_jsonb(s)),'previous',previous_doc) into base_doc
 from private.stockflow_speed_snapshots s where taken_at=b_at;
 current_doc:=jsonb_build_object('stats_reset',reset_at,'rows','[{"gateway":"stockflow_zz_test_gateway","calls":50,"total_ms":10000,"max_ms":700}]'::jsonb);
 row_doc:=private.stockflow_speed_window(current_doc,base_doc)->0;
 perform pg_temp.ds_assert(row_doc='{"gateway":"stockflow_zz_test_gateway","calls":30,"meanMs":200,"previousMeanMs":300,"maxMs":700}'::jsonb,'two weekly deltas');
 row_doc:=private.stockflow_speed_window(current_doc,null)->0;
 perform pg_temp.ds_assert(row_doc->>'calls'='50' and row_doc->>'meanMs'='200' and row_doc->'previousMeanMs'='null'::jsonb,'no base cumulative');
 row_doc:=private.stockflow_speed_window(current_doc,jsonb_set(base_doc,'{stats_reset}',to_jsonb(coalesce(reset_at,now())-interval '1 day')))->0;
 perform pg_temp.ds_assert(row_doc->>'calls'='50' and row_doc->'previousMeanMs'='null'::jsonb,'different reset has no base');
 result:=pg_temp.ds_call();
 perform pg_temp.ds_assert(result->>'snapshotCount'='2','distinct batches');
 if (result->>'statsAvailable')::boolean then
  perform pg_temp.ds_assert((result->>'windowFrom')::timestamptz=b_at,'latest eligible batch selected');
 end if;
 -- All batches now have a different reset, so the report must use cumulative stats.
 update private.stockflow_speed_snapshots set stats_reset=coalesce(reset_at,now())-interval '1 day';
 result:=pg_temp.ds_call();
 perform pg_temp.ds_assert(result->'windowFrom'='null'::jsonb,'report ignores other reset');
 raise notice 'Data speed report phase: open exceptions and age buckets';
 perform pg_temp.ds_constraints('private.stockflow_economic_import_exceptions');
 -- Generated bigint identity PK; required reason, evidence and recorded_at.
 -- Null company/source cannot match a later voucher, so these remain open.
 insert into private.stockflow_economic_import_exceptions(reason,evidence,recorded_at) values
 (reason,'{}',now()-interval '1 day'),(reason,'{}',now()-interval '10 days'),(reason,'{}',now()-interval '40 days');
 result:=pg_temp.ds_call();
 select value into row_doc from jsonb_array_elements(result->'exceptions') where value->>'reason'=reason;
 perform pg_temp.ds_assert(row_doc=jsonb_build_object('reason',reason,'total',3,'under7Days',1,'from7To30Days',1,'over30Days',1),'open reason age buckets');
 raise notice 'Data speed report phase: snapshot and retention';
 perform pg_temp.ds_constraints('private.stockflow_speed_snapshots');
 insert into private.stockflow_speed_snapshots(taken_at,stats_reset,gateway,calls,total_ms,max_ms)
 values(now()-interval '191 days',reset_at,'stockflow_zz_test_gateway',1,1,1);
 perform pg_temp.ds_constraints('private.stockflow_speed_snapshots');
 inserted:=private.stockflow_take_speed_snapshot();
 perform pg_temp.ds_assert(inserted>=0,'snapshot nonnegative');
 perform pg_temp.ds_assert(not exists(select 1 from private.stockflow_speed_snapshots where taken_at<now()-interval '190 days'),'old batch pruned');
 if (result->>'statsAvailable')::boolean then
  perform pg_temp.ds_assert(inserted>0 and (select count(*)=inserted and count(distinct taken_at)=1 from private.stockflow_speed_snapshots where taken_at=now()),'snapshot rows share timestamp');
 else
  perform pg_temp.ds_assert(inserted=0,'unavailable snapshot returns zero');
 end if;
 raise notice 'Data speed report phase: validation and access';
 for payload in select x from (values ('{"x":1}'::jsonb),('[]'),('null'),('1'),('"text"'),(null::jsonb)) bad(x) loop
  begin
   perform pg_temp.ds_call('get_data_speed_report',payload);
   raise exception 'Invalid payload accepted';
  exception when sqlstate '22023' then
   perform pg_temp.ds_assert(sqlerrm='Invalid speed report payload','validation message');
  end;
 end loop;
 foreach actor in array array['manager','admin'] loop
  perform public.stockflow_economics_gateway('ds-key','ds-'||actor||'@test.local','get_data_speed_report','{}');
 end loop;
 foreach actor in array array['accounts','sales','ops'] loop
  begin
   perform public.stockflow_economics_gateway('ds-key','ds-'||actor||'@test.local','get_data_speed_report','{"bad":1}');
   raise exception 'Restricted role accepted';
  exception when sqlstate '42501' then
   perform pg_temp.ds_assert(sqlerrm='Data checks are restricted','role before payload');
  end;
 end loop;
 begin
  perform public.stockflow_economics_gateway('wrong-key','ds-sales@test.local','get_data_speed_report','{"bad":1}');
  raise exception 'Wrong key accepted';
 exception when sqlstate '42501' then
  perform pg_temp.ds_assert(sqlerrm='Unauthorized gateway','key first');
 end;
 raise notice 'Data speed report phase: settings, privileges, cron and routing';
 perform pg_temp.ds_assert((select 'statement_timeout=20s'=any(proconfig) from pg_proc where oid='public.stockflow_economics_gateway(text,text,text,jsonb)'::regprocedure),'gateway timeout');
 perform pg_temp.ds_assert((select provolatile='v' and prosecdef and 'search_path=pg_catalog, private, extensions'=any(proconfig) from pg_proc where oid='private.stockflow_data_speed_report_read(jsonb)'::regprocedure),'read volatility, definer and path');
 perform pg_temp.ds_assert((select provolatile='i' and prolang=(select oid from pg_language where lanname='sql') from pg_proc where oid='private.stockflow_speed_window(jsonb,jsonb)'::regprocedure),'pure SQL immutable helper');
 foreach signature in array array['public.stockflow_economics_gateway(text,text,text,jsonb)','public.stockflow_economics_gateway_before_speed_report(text,text,text,jsonb)',
  'private.stockflow_data_speed_report_read(jsonb)','private.stockflow_take_speed_snapshot()','private.stockflow_speed_window(jsonb,jsonb)'] loop
  foreach db_role in array array['anon','authenticated','service_role'] loop
   if db_role='service_role' and signature like 'public.%' then continue; end if;
   perform pg_temp.ds_assert(not has_function_privilege(db_role,signature,'EXECUTE'),'function privilege '||signature||' '||db_role);
  end loop;
  perform pg_temp.ds_assert(not exists(select 1 from pg_proc pr cross join lateral aclexplode(coalesce(pr.proacl,acldefault('f',pr.proowner))) acl
   where pr.oid=signature::regprocedure and acl.grantee=0 and acl.privilege_type='EXECUTE'),'no public function grant');
 end loop;
 perform pg_temp.ds_assert(has_function_privilege('service_role','public.stockflow_economics_gateway(text,text,text,jsonb)','EXECUTE'),'service gateway grant');
 perform pg_temp.ds_assert((select relrowsecurity from pg_class where oid='private.stockflow_speed_snapshots'::regclass),'snapshot RLS');
 foreach db_role in array array['anon','authenticated'] loop
  perform pg_temp.ds_assert(not has_table_privilege(db_role,'private.stockflow_speed_snapshots','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),'snapshot table privileges');
 end loop;
 perform pg_temp.ds_assert(not exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
  where c.oid='private.stockflow_speed_snapshots'::regclass and acl.grantee=0),'no public table grant');
 if exists(select 1 from pg_extension where extname='pg_cron') then
  perform pg_temp.ds_assert((select count(*)=1 and min(schedule)='55 20 * * 0' and min(command)='select private.stockflow_take_speed_snapshot()'
   from cron.job where jobname='stockflow-speed-snapshot'),'cron schedule');
 end if;
 result:=pg_temp.ds_call('get_economic_cost_review');
 perform pg_temp.ds_assert(result ? 'salesTotal','cost review still routed');
 result:=pg_temp.ds_call('get_data_checks');
 perform pg_temp.ds_assert(result->>'view'='data_checks','data checks still routed');
 result:=pg_temp.ds_call('get_instrument_economics','{"view":"summary"}');
 perform pg_temp.ds_assert(result->>'readView'='summary','summary still routed');
 raise notice 'Data speed report phase: complete (rollback follows)';
end $test$;
rollback;
