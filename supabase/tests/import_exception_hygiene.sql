-- Disposable fixtures only; all writes roll back.
begin;
set local statement_timeout='120s';
set local lock_timeout='10s';
create function pg_temp.ih_assert(ok boolean,label text) returns void language plpgsql as $$
begin
 if ok is distinct from true then raise exception 'Import exception hygiene: %',label; end if;
end $$;
create function pg_temp.ih_call(payload jsonb,actor text default 'ih-manager@test.local',gateway_key text default 'ih-key') returns jsonb language sql as $$
 select public.stockflow_economics_gateway(gateway_key,actor,'acknowledge_economic_exceptions',payload)
$$;
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('ih-key','sha256'),'hex') where name='orders';
insert into public.stockflow_members(email,role,roles,status) values
 ('ih-manager@test.local','management',array['management'],'active'),
 ('ih-ops@test.local','operations',array['operations'],'active'),
 ('ih-suspended@test.local','management',array['management'],'suspended');

do $test$
declare company text:='ih-company-'||extensions.gen_random_uuid()::text;
 problem text:='ih-stale-'||extensions.gen_random_uuid()::text;
 request_id uuid:=extensions.gen_random_uuid(); payload jsonb; result jsonb; repeated jsonb; report jsonb; group_row jsonb;
 first_id bigint; fresh_id bigint; old_ids bigint[]; source_count bigint; source_hash text; actor text; relation text;
 ack_count bigint; action_count bigint; bad jsonb; signature text; db_role text;
begin
 -- Same open rejection is suppressed, but a different revision is retained.
 insert into private.stockflow_economic_import_exceptions(company_id,source_id,reason,evidence)
 values(company,'voucher','ih-rejected','{"revision":1}') returning id into first_id;
 insert into private.stockflow_economic_import_exceptions(company_id,source_id,reason,evidence)
 values(company,'voucher','ih-rejected','{"revision":1}');
 perform pg_temp.ih_assert((select count(*)=1 from private.stockflow_economic_import_exceptions where company_id=company),'same revision deduped');
 insert into private.stockflow_economic_import_exceptions(company_id,source_id,reason,evidence)
 values(company,'voucher','ih-rejected','{"revision":2}');
 perform pg_temp.ih_assert((select count(*)=2 from private.stockflow_economic_import_exceptions where company_id=company),'different revision retained');
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,kind,evidence)
 values(company,'voucher',3,current_date,'sale','{}');
 perform pg_temp.ih_assert(not private.stockflow_economic_import_exception_open(first_id),'new voucher revision closes rejection');
 insert into private.stockflow_economic_import_exceptions(company_id,source_id,reason,evidence)
 values(company,'voucher','ih-rejected','{"revision":1}');
 perform pg_temp.ih_assert((select count(*)=3 from private.stockflow_economic_import_exceptions where company_id=company),'closed rejection permits new insert');
 -- Null companies and absent revisions use IS NOT DISTINCT FROM semantics.
 insert into private.stockflow_economic_import_exceptions(source_id,reason,evidence)
 values(company,'ih-null-company','{}'),(company,'ih-null-company','{}');
 perform pg_temp.ih_assert((select count(*)=1 from private.stockflow_economic_import_exceptions where source_id=company),'null company and revision deduped');
 insert into private.stockflow_economic_import_exceptions(reason,evidence,recorded_at)
 values(problem,'{}',now()-interval '10 days'),(problem,'{}',now()-interval '10 days');
 select array_agg(id order by id) into old_ids from private.stockflow_economic_import_exceptions where reason=problem;
 perform pg_temp.ih_assert(cardinality(old_ids)=2,'null sources never deduped');
 insert into private.stockflow_economic_import_exceptions(reason,evidence)
 values(problem,'{}') returning id into fresh_id;
 report:=public.stockflow_economics_gateway('ih-key','ih-manager@test.local','get_data_speed_report','{}');
 select value into group_row from jsonb_array_elements(report->'exceptions') where value->>'reason'=problem;
 perform pg_temp.ih_assert(group_row=jsonb_build_object('reason',problem,'total',3,'under7Days',1,'from7To30Days',2,'over30Days',0,'acknowledgeable',2),'report eligible count and unchanged age buckets');
 payload:=jsonb_build_object('requestId',request_id,'reason',problem,'expectedCount',2,'note','Historical issue reviewed');
 -- Validate before writing and enforce management access before payload validation.
 begin
  perform pg_temp.ih_call(jsonb_set(payload,'{expectedCount}','5'));
  raise exception 'Changed count accepted';
 exception when sqlstate '40001' then
  perform pg_temp.ih_assert(sqlerrm='Problem count changed; reload','count mismatch message');
 end;
 foreach actor in array array['ih-ops@test.local','ih-suspended@test.local'] loop
  begin
   perform pg_temp.ih_call(payload,actor);
   raise exception 'Restricted actor accepted';
  exception when sqlstate '42501' then
   perform pg_temp.ih_assert(sqlerrm=case when actor='ih-ops@test.local' then 'Data checks are restricted' else 'Active membership required' end,'restricted actor message');
  end;
 end loop;
 begin
  perform pg_temp.ih_call(payload,'ih-manager@test.local','wrong-key');
  raise exception 'Wrong key accepted';
 exception when sqlstate '42501' then
  perform pg_temp.ih_assert(sqlerrm='Unauthorized gateway','gateway key checked');
 end;
 for bad in select x from (values
  (payload||'{"extra":true}'::jsonb),(jsonb_set(payload,'{note}','"short"')),
  (payload-'reason'),(jsonb_set(payload,'{expectedCount}','2.5')),
  (jsonb_set(payload,'{expectedCount}','"2"')),(jsonb_set(payload,'{requestId}','"bad"')),
  ('[]'::jsonb),('null'::jsonb),(null::jsonb)) invalid(x) loop
  begin
   perform pg_temp.ih_call(bad);
   raise exception 'Invalid payload accepted';
  exception when sqlstate '22023' then null;
  end;
 end loop;
 select count(*),md5(coalesce(jsonb_agg(to_jsonb(e) order by id)::text,'')) into source_count,source_hash
 from private.stockflow_economic_import_exceptions e;
 select count(*) into ack_count from private.stockflow_economic_import_exception_acks;
 select count(*) into action_count from private.stockflow_economic_import_exception_ack_actions;
 result:=pg_temp.ih_call(payload);
 perform pg_temp.ih_assert(result=jsonb_build_object('actionId',request_id,'acknowledged',2),'ack result');
 perform pg_temp.ih_assert((select count(*)=ack_count+2 from private.stockflow_economic_import_exception_acks),'two ack rows');
 perform pg_temp.ih_assert((select count(*)=action_count+1 from private.stockflow_economic_import_exception_ack_actions),'one action row');
 perform pg_temp.ih_assert((select count(*)=2 and bool_and(action_id=request_id and acknowledged_by='ih-manager@test.local' and reason=payload->>'note')
  from private.stockflow_economic_import_exception_acks where exception_id=any(old_ids)),'audit actor, note and action');
 perform pg_temp.ih_assert((select reason_group=problem and recorded_before=now()-interval '7 days' and acknowledged_count=2
  from private.stockflow_economic_import_exception_ack_actions where id=request_id),'audit group and cutoff');
 perform pg_temp.ih_assert((select bool_and(not private.stockflow_economic_import_exception_open(id)) from unnest(old_ids) id),'acked rows closed');
 perform pg_temp.ih_assert(private.stockflow_economic_import_exception_open(fresh_id),'fresh row stays open');
 repeated:=pg_temp.ih_call(payload);
 perform pg_temp.ih_assert(repeated=result,'request id returns original result');
 perform pg_temp.ih_assert((select count(*)=ack_count+2 from private.stockflow_economic_import_exception_acks)
  and (select count(*)=action_count+1 from private.stockflow_economic_import_exception_ack_actions),'retry writes nothing');
 begin
  perform pg_temp.ih_call(jsonb_set(payload,'{requestId}',to_jsonb(extensions.gen_random_uuid())));
  raise exception 'Empty acknowledgement accepted';
 exception when sqlstate '22023' then
  perform pg_temp.ih_assert(sqlerrm='Nothing to acknowledge','empty message');
 end;
 foreach relation in array array['stockflow_economic_import_exception_acks','stockflow_economic_import_exception_ack_actions'] loop
  begin
   execute format('update private.%I set reason=reason where %I=$1',relation,case when relation='stockflow_economic_import_exception_acks' then 'action_id' else 'id' end) using request_id;
   raise exception 'Audit update accepted';
  exception when raise_exception then
   perform pg_temp.ih_assert(sqlerrm='Acknowledgements are append-only','append-only update '||relation);
  end;
  begin
   execute format('delete from private.%I where %I=$1',relation,case when relation='stockflow_economic_import_exception_acks' then 'action_id' else 'id' end) using request_id;
   raise exception 'Audit delete accepted';
  exception when raise_exception then
   perform pg_temp.ih_assert(sqlerrm='Acknowledgements are append-only','append-only delete '||relation);
  end;
  foreach db_role in array array['anon','authenticated','service_role'] loop
   perform pg_temp.ih_assert(not has_table_privilege(db_role,'private.'||relation,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),'audit table revoked '||db_role);
  end loop;
 end loop;
 perform pg_temp.ih_assert((select count(*)=source_count and md5(coalesce(jsonb_agg(to_jsonb(e) order by id)::text,''))=source_hash
  from private.stockflow_economic_import_exceptions e),'exception rows byte-identical after acknowledge and retry');
 foreach signature in array array['private.stockflow_economic_acknowledge_exceptions(text,jsonb)',
  'private.stockflow_data_speed_report_read(jsonb)','private.stockflow_data_speed_report_read_before_exception_acks(jsonb)'] loop
  foreach db_role in array array['anon','authenticated','service_role'] loop
   perform pg_temp.ih_assert(not has_function_privilege(db_role,signature,'EXECUTE'),'helper revoked '||signature||' '||db_role);
  end loop;
 end loop;
 perform pg_temp.ih_assert((select 'statement_timeout=20s'=any(proconfig) from pg_proc
  where oid='public.stockflow_economics_gateway(text,text,text,jsonb)'::regprocedure),'gateway timeout');
 perform pg_temp.ih_assert(has_function_privilege('service_role','public.stockflow_economics_gateway(text,text,text,jsonb)','EXECUTE'),'service gateway grant');
 report:=public.stockflow_economics_gateway('ih-key','ih-manager@test.local','get_data_speed_report','{}');
 select value into group_row from jsonb_array_elements(report->'exceptions') where value->>'reason'=problem;
 perform pg_temp.ih_assert(group_row->>'total'='1' and group_row->>'acknowledgeable'='0','report excludes acknowledged rows');
end $test$;
rollback;
