-- Disposable local replay database only. Fixtures commit for independent sessions.
create extension if not exists dblink with schema public;
insert into private.stockflow_economic_policy_versions(actor,reason,automatic_approval) values('test','Manual approval path fixture',false);
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('economic-race-key','sha256'),'hex') where name='orders';
insert into public.stockflow_members(email,role,status) values('economic-race@test.local','administrator','active');
insert into private.stockflow_customers(id,name,tally_key,created_by_email) values('cccccccc-cccc-4ccc-8ccc-ccccccccccc1','Approval race fixture','approval-race-customer','test') on conflict(id) do nothing;
create function public.test_economic_call(payload jsonb, action text default 'set_policy') returns jsonb language plpgsql as $$
begin return public.stockflow_economics_gateway('economic-race-key','economic-race@test.local',action,payload);
exception when others then return jsonb_build_object('errorCode',sqlstate);end$$;
create function public.test_economic_group_sync(doc jsonb) returns uuid language plpgsql as $group_sync$
begin
 insert into public.stockflow_snapshots(id,company,fetched_at,payload) values('suprabha','SUPRABHA DISTRIBUTORS',now()::text,'{"catalog":[]}'::jsonb) on conflict(id) do nothing;
 update public.stockflow_snapshots set payload=jsonb_build_object('catalog','[]'::jsonb,'economicEvidence',doc) where id='suprabha';
 return(select id from private.stockflow_economic_item_catalogs where company_id=doc->>'companyId' order by observed_at desc,id desc limit 1);
end$group_sync$;
do $test$
declare first_result jsonb;second_result jsonb;second_pid integer;attempt integer;proposal_id uuid; approval_payload jsonb;group_target uuid;catalog_id uuid;catalog_doc jsonb;group_payload jsonb;
 payload jsonb:='{"attractiveMonths":24,"reviewMonths":36,"exceptionMonths":48,"forecastWindowMonths":3,"watchRevenuePercent":80,"criticalRevenuePercent":50,"reason":"Concurrent policy evidence","idempotencyKey":"economic-concurrent-0001"}';
begin
 perform public.dblink_connect('economic_a','dbname='||current_database()||' user='||current_user||' options=-cstatement_timeout=15000');
 perform public.dblink_connect('economic_b','dbname='||current_database()||' user='||current_user||' options=-cstatement_timeout=15000');
 select pid into second_pid from public.dblink('economic_b','select pg_backend_pid()') as t(pid integer);
 perform public.dblink_exec('economic_a','begin');
 select value into first_result from public.dblink('economic_a',format('select public.test_economic_call(%L::jsonb)',payload::text)) as t(value jsonb);
 if first_result?'errorCode' then raise exception 'Initial economic command failed: %',first_result;end if;
 perform public.dblink_send_query('economic_b',format('select public.test_economic_call(%L::jsonb)',payload::text));
 for attempt in 1..500 loop exit when exists(select 1 from pg_locks where pid=second_pid and not granted);perform pg_sleep(0.01);end loop;
 if not exists(select 1 from pg_locks where pid=second_pid and not granted) then raise exception 'Economic writes did not serialize';end if;
 perform public.dblink_exec('economic_a','commit');
 select value into second_result from public.dblink_get_result('economic_b') as t(value jsonb);
 perform * from public.dblink_get_result('economic_b') as t(value jsonb);
 if first_result is distinct from second_result then raise exception 'Concurrent economic receipt replay differs';end if;
 if (select count(*) from private.stockflow_economic_audit a where a.payload->>'idempotencyKey'='economic-concurrent-0001')<>1 then raise exception 'Concurrent economic audit duplicated';end if;
 if (select count(*) from private.stockflow_economic_runs where active)<>1 then raise exception 'Projection publication not atomic';end if;
 select value into second_result from public.dblink('economic_b',format('select public.test_economic_call(%L::jsonb)',(payload||'{"watchRevenuePercent":81}')::text)) as t(value jsonb);
 if second_result->>'errorCode' is distinct from '22023' then raise exception 'Changed receipt reuse accepted: %',second_result;end if;
 -- Closing waits behind an in-flight original write and then reports accepted instead of erasing it.
 payload:=payload||'{"idempotencyKey":"economic-close-race-0001"}';
 perform public.dblink_exec('economic_a','begin');
 select value into first_result from public.dblink('economic_a',format('select public.test_economic_call(%L::jsonb)',payload::text)) as t(value jsonb);
 if first_result?'errorCode' then raise exception 'Recovery race original failed: %',first_result;end if;
 perform public.dblink_send_query('economic_b',format('select public.stockflow_economics_gateway(%L,%L,%L,%L::jsonb)','economic-race-key','economic-race@test.local','recover_economic_command','{"commandAction":"set_policy","commandKey":"economic-close-race-0001","closeUnresolved":true}'));
 for attempt in 1..500 loop exit when exists(select 1 from pg_locks where pid=second_pid and not granted);perform pg_sleep(0.01);end loop;
 if not exists(select 1 from pg_locks where pid=second_pid and not granted) then raise exception 'Close fence bypassed in-flight economic command';end if;
 perform public.dblink_exec('economic_a','commit');
 select value into second_result from public.dblink_get_result('economic_b') as t(value jsonb);
 perform * from public.dblink_get_result('economic_b') as t(value jsonb);
 if second_result is distinct from '{"status":"accepted"}'::jsonb then raise exception 'Close lost committed command: %',second_result;end if;
 if (select count(*) from private.stockflow_economic_audit a where a.payload->>'idempotencyKey'='economic-close-race-0001')<>1 then raise exception 'Recovery race duplicated command';end if;
 -- A preview read before another transaction changes policy cannot approve after waiting for that writer.
 select value into first_result from public.dblink('economic_a',format('select public.test_economic_call(%L::jsonb,%L)', '{"kind":"group","name":"Approval concurrency pool","companyId":"approval-race-company","customerId":"cccccccc-cccc-4ccc-8ccc-ccccccccccc1","customerSourceId":"approval-race-customer","siteId":"race-site","modelId":"race-model","effectiveFrom":"2026-01-01","capitalPaise":"0","idempotencyKey":"approval-race-create"}', 'create_target')) as t(value jsonb);
 if first_result?'errorCode' then raise exception 'Approval race target setup failed: %',first_result;end if;
 proposal_id:=(first_result->>'entityId')::uuid;
 select value into first_result from public.dblink('economic_a',format('select public.test_economic_call(%L::jsonb,%L)', jsonb_build_object('targetId',proposal_id,'effectiveFrom','2026-01-01','monthlyRevenuePaise','10000','monthlyGpPaise','1000','reason','Reviewed concurrency baseline','idempotencyKey','approval-race-baseline')::text, 'set_expectation')) as t(value jsonb);
 if first_result?'errorCode' then raise exception 'Approval race baseline failed: %',first_result;end if;
 approval_payload:=jsonb_build_object('targetId',proposal_id,'expectedVersion',1,'expectedGeneration',first_result->>'generation','decision','approved','reason','Decision based on the earlier policy','idempotencyKey','approval-race-decision');
 perform public.dblink_exec('economic_a','begin');
 select value into first_result from public.dblink('economic_a',format('select public.test_economic_call(%L::jsonb)',(payload||'{"reviewMonths":35,"idempotencyKey":"approval-race-policy"}')::text)) as t(value jsonb);
 if first_result?'errorCode' then raise exception 'Approval race policy failed: %',first_result;end if;
 perform public.dblink_send_query('economic_b',format('select public.test_economic_call(%L::jsonb,%L)',approval_payload::text,'approve_target'));
 for attempt in 1..500 loop exit when exists(select 1 from pg_locks where pid=second_pid and not granted);perform pg_sleep(0.01);end loop;
 if not exists(select 1 from pg_locks where pid=second_pid and not granted) then raise exception 'Approval did not wait for financial writer';end if;
 perform public.dblink_exec('economic_a','commit');
 select value into second_result from public.dblink_get_result('economic_b') as t(value jsonb);
 perform * from public.dblink_get_result('economic_b') as t(value jsonb);
 if second_result->>'errorCode' is distinct from 'PT409' then raise exception 'Queued approval used an obsolete financial preview: %',second_result;end if;
 if (select approval from private.stockflow_economic_targets where id=proposal_id)<>'proposed' or exists(select 1 from private.stockflow_command_results where idempotency_key='approval-race-decision') or exists(select 1 from private.stockflow_economic_audit a where a.payload->>'idempotencyKey'='approval-race-decision') then raise exception 'Stale approval partially committed';end if;
 approval_payload:=approval_payload||jsonb_build_object('expectedGeneration',first_result->>'generation');
 select value into first_result from public.dblink('economic_b',format('select public.test_economic_call(%L::jsonb,%L)',approval_payload::text,'approve_target')) as t(value jsonb);
 if first_result?'errorCode' then raise exception 'Refreshed approval failed: %',first_result;end if;
 select value into second_result from public.dblink('economic_a',format('select public.test_economic_call(%L::jsonb,%L)',approval_payload::text,'approve_target')) as t(value jsonb);
 if second_result is distinct from first_result then raise exception 'Refreshed approval replay duplicated or recalculated the decision';end if;
 -- A group mapping queued behind a new master catalog must review the new membership.
 perform public.dblink_exec('economic_a', $fixture$insert into private.stockflow_orders(id,order_number,customer_id,customer_name,source,status,created_by_email,updated_by_email,idempotency_key) values('cccccccc-cccc-4ccc-8ccc-ccccccccccc2','GROUP-RACE-ORDER','cccccccc-cccc-4ccc-8ccc-ccccccccccc1','Approval race fixture','phone','delivered','test','test','group-race-order')$fixture$);
 perform public.dblink_exec('economic_a', $fixture$insert into private.stockflow_equipment_installations(id,order_id,tally_key,item_name,status,scheduled_date,serial_number,created_by_email,completed_at) values('cccccccc-cccc-4ccc-8ccc-ccccccccccc3','cccccccc-cccc-4ccc-8ccc-ccccccccccc2','group-race-instrument','Group race instrument','completed',private.stockflow_economic_business_date()-1,'GROUP-RACE','test',now())$fixture$);
 catalog_doc:=jsonb_build_object('schemaVersion',1,'companyId','group-race-company','sourceVersion',clock_timestamp()::text,'itemCatalog','{"groups":[{"id":"group-race-guid","name":"Race reagents","parentId":null}],"products":[{"id":"race-a","name":"A","groupId":"group-race-guid","unit":"pack"}]}'::jsonb,'vouchers','[]'::jsonb);
 select value into catalog_id from public.dblink('economic_a',format('select public.test_economic_group_sync(%L::jsonb)',catalog_doc::text)) as t(value uuid);
 select value into first_result from public.dblink('economic_a',format('select public.test_economic_call(%L::jsonb,%L)',jsonb_build_object('kind','placement','name','Group race placement','companyId','group-race-company','customerId','cccccccc-cccc-4ccc-8ccc-ccccccccccc1','customerSourceId','group-race-customer','siteId','race-site','modelId','race-model','installationId','cccccccc-cccc-4ccc-8ccc-ccccccccccc3','effectiveFrom',private.stockflow_economic_business_date()-1,'capitalPaise','0','idempotencyKey','group-race-create-0001')::text,'create_target')) as t(value jsonb);
 if first_result?'errorCode' then raise exception 'Group race target failed: %',first_result;end if;
 group_target:=(first_result->>'entityId')::uuid;
 group_payload:=jsonb_build_object('targetId',group_target,'expectedCatalogId',catalog_id,'groupId','group-race-guid','effect','include','effectiveFrom',private.stockflow_economic_business_date()-1,'reason','Reviewed earlier group membership','idempotencyKey','group-race-save-00001');
 catalog_doc:=catalog_doc||jsonb_build_object('sourceVersion',clock_timestamp()::text,'itemCatalog',jsonb_set(catalog_doc->'itemCatalog','{products}',(catalog_doc->'itemCatalog'->'products')||'[{"id":"race-b","name":"B","groupId":"group-race-guid","unit":"pack"}]'::jsonb));
 perform public.dblink_exec('economic_a','begin');
 select value into catalog_id from public.dblink('economic_a',format('select public.test_economic_group_sync(%L::jsonb)',catalog_doc::text)) as t(value uuid);
 perform public.dblink_send_query('economic_b',format('select public.test_economic_call(%L::jsonb,%L)',group_payload::text,'set_item_group_mapping'));
 for attempt in 1..500 loop exit when exists(select 1 from pg_locks where pid=second_pid and not granted);perform pg_sleep(0.01);end loop;
 if not exists(select 1 from pg_locks where pid=second_pid and not granted) then raise exception 'Group mapping did not serialize behind master sync';end if;
 perform public.dblink_exec('economic_a','commit');
 select value into second_result from public.dblink_get_result('economic_b') as t(value jsonb);
 perform * from public.dblink_get_result('economic_b') as t(value jsonb);
 if second_result->>'errorCode' is distinct from 'PT409' or exists(select 1 from private.stockflow_economic_item_group_mappings where target_id=group_target) or exists(select 1 from private.stockflow_command_results where idempotency_key='group-race-save-00001') then raise exception 'Queued group mapping used stale catalog or partially committed: %',second_result;end if;
 group_payload:=group_payload||jsonb_build_object('expectedCatalogId',catalog_id);
 select value into first_result from public.dblink('economic_b',format('select public.test_economic_call(%L::jsonb,%L)',group_payload::text,'set_item_group_mapping')) as t(value jsonb);
 if first_result?'errorCode' then raise exception 'Refreshed group mapping failed: %',first_result;end if;
 select value into second_result from public.dblink('economic_a',format('select public.test_economic_call(%L::jsonb,%L)',group_payload::text,'set_item_group_mapping')) as t(value jsonb);
 if first_result is distinct from second_result or (select count(*) from private.stockflow_economic_item_group_mappings where target_id=group_target)<>1 then raise exception 'Group receipt replay duplicated mapping';end if;
 perform public.dblink_disconnect('economic_a');perform public.dblink_disconnect('economic_b');
end$test$;
