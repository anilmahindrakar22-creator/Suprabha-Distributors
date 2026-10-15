begin;
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('link-test-key','sha256'),'hex') where name='orders';
insert into public.stockflow_members(email,role,status) values
 ('link-manager@test.local','management','active'),('link-sales@test.local','sales','active');
insert into public.stockflow_snapshots(id,company,fetched_at,payload)
 values('suprabha','SUPRABHA TEST',now()::text,'{}') on conflict(id) do nothing;
insert into private.stockflow_customers(id,name,tally_key,created_by_email) values
 ('15100000-0000-4000-8000-000000000001','Link Alpha','Link Alpha','test'),
 ('15100000-0000-4000-8000-000000000002','Link Beta','Link Beta','test'),
 ('15100000-0000-4000-8000-000000000003','Link Gamma','Link Gamma','test'),
 ('15100000-0000-4000-8000-000000000004','Link Delta','Link Delta','test'),
 ('15100000-0000-4000-8000-000000000005','Link Fuzzy','Link Fuzzy','test');
-- Real BEFORE trigger path, including accepted complete-window coverage.
do $seed$
declare v_version text;
begin
 foreach v_version in array array['2026-10-14T10:00:00Z','2026-10-15T10:00:00Z'] loop
  update public.stockflow_snapshots set payload=jsonb_build_object('economicEvidence',jsonb_build_object(
   'schemaVersion','1','companyId','link-test-company','sourceVersion',v_version,
   'completeWindow',true,'windowFrom','2026-10-01','windowTo','2026-11-01','vouchers','[]'::jsonb,
   'customerLedgers','[{"guid":"alpha","name":" Link Alpha "},{"guid":"beta","name":"Link Beta"},{"guid":"gamma","name":"Link Gamma"},{"guid":"delta","name":"Link Delta"},{"guid":"fuzzy","name":"Link Fuzzy."}]'::jsonb
    -- The second export adds a ledger, so it is a new generation (identical lists are deduplicated).
    ||(case when v_version='2026-10-15T10:00:00Z' then '[{"guid":"epsilon","name":"Link Epsilon"}]' else '[]' end)::jsonb)) where id='suprabha';
 end loop;
 update public.stockflow_snapshots set payload=jsonb_build_object('economicEvidence',jsonb_build_object(
  'schemaVersion','1','companyId','link-waiting-company','sourceVersion','2026-10-15T10:00:00Z','vouchers','[]'::jsonb,
  'customerLedgers','[{"guid":"foreign","name":"Link Delta"}]'::jsonb)) where id='suprabha';
end$seed$;

do $test$
declare v_payload jsonb;v_result jsonb;v_read jsonb;v_bad jsonb;v_before bigint;v_action text;v_state text;
begin
 if private.stockflow_current_ledger_generation('link-test-company') is distinct from '2026-10-15T10:00:00Z'
  or (select count(*) from private.stockflow_economic_source_coverage where company_id='link-test-company')<>2 then raise exception 'Accepted generation missing';end if;
 v_read:=public.stockflow_economics_gateway('link-test-key','link-manager@test.local','get_link_suggestions','{"companyId":"link-test-company"}');
 if (v_read->'page'->>'total')::int<>4 or exists(select 1 from jsonb_array_elements(v_read->'rows') r where r->>'state'<>'suggested') then raise exception 'Exact suggestions incorrect';end if;
 v_payload:='{"companyId":"link-test-company","sourceVersion":"2026-10-15T10:00:00Z","rows":[{"customerId":"15100000-0000-4000-8000-000000000001","ledgerGuid":"alpha"},{"customerId":"15100000-0000-4000-8000-000000000002","ledgerGuid":"beta"}],"reason":"Person reviewed exact matches","idempotencyKey":"link-confirm-batch-0001"}';
 v_result:=public.stockflow_economics_gateway('link-test-key','link-manager@test.local','confirm_customer_links',v_payload);
 if v_result->>'confirmed'<>'2' or (select count(*) from private.stockflow_economic_customer_identities where company_id='link-test-company')<>2
  or (select count(*) from private.stockflow_customer_identity_events where company_id='link-test-company')<>2 then raise exception 'Batch writes incorrect';end if;
 if public.stockflow_economics_gateway('link-test-key','link-manager@test.local','confirm_customer_links',v_payload)<>v_result
  or (select count(*) from private.stockflow_customer_identity_events where company_id='link-test-company')<>2 then raise exception 'Replay duplicated events';end if;
 -- SQL validates direct gateway clients independently of the application parser.
 for v_bad in select value from jsonb_array_elements(jsonb_build_array(
  '{"rows":[]}'::jsonb,'{"rows":null}'::jsonb,'{"reason":"ab"}'::jsonb,'{"idempotencyKey":"short"}'::jsonb,
  '{"rows":[{"customerId":"invalid","ledgerGuid":"alpha"}]}'::jsonb,
  '{"rows":[{"customerId":"15100000-0000-4000-8000-000000000003","ledgerGuid":"gamma"},{"customerId":"15100000-0000-4000-8000-000000000003","ledgerGuid":"delta"}]}'::jsonb,
  '{"rows":[{"customerId":"15100000-0000-4000-8000-000000000003","ledgerGuid":"gamma"},{"customerId":"15100000-0000-4000-8000-000000000004","ledgerGuid":" gamma "}]}'::jsonb)) loop
  begin perform private.stockflow_customer_link_command('test',array['management'],'confirm_customer_links',v_payload||v_bad);
   raise exception 'Invalid SQL command accepted';exception when invalid_parameter_value then null;end;
 end loop;
 begin
  perform public.stockflow_economics_gateway('link-test-key','link-manager@test.local','confirm_customer_links',v_payload||'{"reason":"Changed review"}');
  raise exception 'Changed replay accepted';
 exception when invalid_parameter_value then null;end;

 -- Each failing batch starts with a valid Gamma row, so partial writes are observable.
 v_payload:=jsonb_set(v_payload,'{rows}','[{"customerId":"15100000-0000-4000-8000-000000000003","ledgerGuid":"gamma"},{"customerId":"15100000-0000-4000-8000-000000000005","ledgerGuid":"fuzzy"}]');
 for v_bad in select value from jsonb_array_elements(jsonb_build_array(
  jsonb_build_object('idempotencyKey','link-failure-fuzzy-0001'),
  jsonb_build_object('idempotencyKey','link-failure-guid-00001','rows','[{"customerId":"15100000-0000-4000-8000-000000000003","ledgerGuid":"gamma"},{"customerId":"15100000-0000-4000-8000-000000000004","ledgerGuid":"alpha"}]'::jsonb),
  jsonb_build_object('idempotencyKey','link-failure-customer-01','rows','[{"customerId":"15100000-0000-4000-8000-000000000001","ledgerGuid":"delta"},{"customerId":"15100000-0000-4000-8000-000000000003","ledgerGuid":"gamma"}]'::jsonb),
  jsonb_build_object('idempotencyKey','link-failure-stale-0001','sourceVersion','2026-10-14T10:00:00Z'),
  jsonb_build_object('idempotencyKey','link-failure-foreign-01','rows','[{"customerId":"15100000-0000-4000-8000-000000000003","ledgerGuid":"gamma"},{"customerId":"15100000-0000-4000-8000-000000000004","ledgerGuid":"foreign"}]'::jsonb))) loop
  select count(*) into v_before from private.stockflow_economic_customer_identities;
  begin
   perform public.stockflow_economics_gateway('link-test-key','link-manager@test.local','confirm_customer_links',v_payload||v_bad);
   raise exception 'Invalid batch accepted: %',v_bad;
  exception when sqlstate 'PT409' then null;end;
  if (select count(*) from private.stockflow_economic_customer_identities)<>v_before
   or (select count(*) from private.stockflow_customer_identity_events where company_id='link-test-company')<>2 then raise exception 'Partial writes survived';end if;
 end loop;
 foreach v_action in array array['get_link_suggestions','confirm_customer_links'] loop
  begin perform public.stockflow_economics_gateway('link-test-key','link-sales@test.local',v_action,v_payload);
   raise exception 'Sales access accepted';exception when insufficient_privilege then null;end;
 end loop;
 v_read:=private.stockflow_customer_link_command('test',array['management'],'get_link_suggestions','{"companyId":"link-waiting-company"}');
 if v_read->>'waiting' is distinct from 'true' then raise exception 'Unaccepted export offered';end if;
 -- Create both conflict directions using the real shared identity authority.
 insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
  values('link-test-company','gamma','15100000-0000-4000-8000-000000000004','test');
 foreach v_state in array array['suggested','linked','conflict'] loop
  v_read:=private.stockflow_customer_link_command('test',array['management'],'get_link_suggestions',jsonb_build_object('companyId','link-test-company','state',v_state));
  -- The canonical GUID remains visible even when the legacy name points elsewhere.
  if (v_read->'page'->>'total')::int<>(case when v_state='suggested' then 0 when v_state='linked' then 3 else 2 end)
   or exists(select 1 from jsonb_array_elements(v_read->'rows') r where r->>'state'<>v_state) then raise exception 'State filter incorrect: %',v_state;end if;
  if v_state='conflict' and (not exists(select 1 from jsonb_array_elements(v_read->'rows') r where r->'linkedTo'->>'customerId'='15100000-0000-4000-8000-000000000004')
   or not exists(select 1 from jsonb_array_elements(v_read->'rows') r where r->'linkedTo'->>'guid'='gamma')) then raise exception 'Conflict detail missing';end if;
 end loop;
 -- Recheck customer-only and GUID-only conflicts with exact name matches.
 update private.stockflow_customers set tally_key=null where id='15100000-0000-4000-8000-000000000003';
 update private.stockflow_customers set tally_key='Link Gamma' where id='15100000-0000-4000-8000-000000000005';
 begin perform private.stockflow_customer_link_command('test',array['management'],'confirm_customer_links',v_payload||'{"idempotencyKey":"link-exact-guid-conflict","rows":[{"customerId":"15100000-0000-4000-8000-000000000005","ledgerGuid":"gamma"}]}');
  raise exception 'Linked GUID accepted';exception when sqlstate 'PT409' then null;end;
 begin perform private.stockflow_customer_link_command('test',array['management'],'confirm_customer_links',v_payload||'{"idempotencyKey":"link-exact-customer-conflict","rows":[{"customerId":"15100000-0000-4000-8000-000000000004","ledgerGuid":"delta"}]}');
  raise exception 'Linked customer accepted';exception when sqlstate 'PT409' then null;end;
 if (select count(*) from private.stockflow_economic_customer_identities where company_id='link-test-company')<>3
  or (select count(*) from private.stockflow_customer_identity_events where company_id='link-test-company')<>2 then raise exception 'Exact conflict caused partial writes';end if;

 select count(*) into v_before from private.stockflow_economic_import_exceptions where evidence->>'kind'='customer_ledger_master';
 update public.stockflow_snapshots set payload=jsonb_build_object('marker','duplicate-imported','economicEvidence',jsonb_build_object(
  'schemaVersion','1','companyId','link-duplicate-company','sourceVersion','2026-10-15T11:00:00Z','vouchers','[]'::jsonb,
  'customerLedgers','[{"guid":"one","name":"Duplicate"},{"guid":"two","name":" Duplicate "}]'::jsonb)) where id='suprabha';
 if exists(select 1 from private.stockflow_economic_ledger_masters where company_id='link-duplicate-company')
  or (select count(*) from private.stockflow_economic_import_exceptions where evidence->>'kind'='customer_ledger_master')<>v_before+1
  or (select payload->>'marker' from public.stockflow_snapshots where id='suprabha') is distinct from 'duplicate-imported' then raise exception 'Duplicate array not safely skipped';end if;

 update public.stockflow_snapshots set payload=jsonb_build_object('economicEvidence',jsonb_build_object(
  'schemaVersion','1','companyId','link-test-company','sourceVersion','2026-10-16T10:00:00Z','completeWindow',true,
  'windowFrom','2026-10-01','windowTo','2026-11-01','vouchers','[]'::jsonb,
  'customerLedgers','[{"guid":"alpha","name":"Renamed Alpha"}]'::jsonb)) where id='suprabha';
 if private.stockflow_current_ledger_generation('link-test-company') is distinct from '2026-10-16T10:00:00Z'
  or not exists(select 1 from private.stockflow_economic_customer_identities where company_id='link-test-company' and source_id='alpha' and customer_id='15100000-0000-4000-8000-000000000001')
  or not exists(select 1 from private.stockflow_customer_identity_events where company_id='link-test-company' and source_id='alpha' and ledger_name_at_confirmation='Link Alpha') then raise exception 'Rename lost identity or confirmation provenance';end if;
 -- A historical successful request still replays after the generation changes.
 if private.stockflow_customer_link_command('link-manager@test.local',array['management'],'confirm_customer_links',
  '{"companyId":"link-test-company","sourceVersion":"2026-10-15T10:00:00Z","rows":[{"customerId":"15100000-0000-4000-8000-000000000001","ledgerGuid":"alpha"},{"customerId":"15100000-0000-4000-8000-000000000002","ledgerGuid":"beta"}],"reason":"Person reviewed exact matches","idempotencyKey":"link-confirm-batch-0001"}')<>v_result then raise exception 'Historical replay failed';end if;

 -- A fresh observation advances its version while reusing the stored master content.
 update public.stockflow_snapshots set payload=jsonb_build_object('economicEvidence',jsonb_build_object(
  'schemaVersion','1','companyId','link-test-company','sourceVersion','2026-10-17T10:00:00Z','completeWindow',true,
  'windowFrom','2026-10-01','windowTo','2026-11-01','vouchers','[]'::jsonb,
  'customerLedgers','[{"guid":"alpha","name":" Renamed Alpha "}]'::jsonb)) where id='suprabha';
 if exists(select 1 from private.stockflow_economic_ledger_masters where company_id='link-test-company' and source_version='2026-10-17T10:00:00Z')
  or private.stockflow_current_ledger_generation('link-test-company') is distinct from '2026-10-17T10:00:00Z' then raise exception 'Unchanged ledger list did not advance without duplication';end if;

 -- Source instant, not text or arrival order: 09:00-05:00 is 14:00 UTC.
 update public.stockflow_snapshots set payload=jsonb_build_object('economicEvidence',jsonb_build_object(
  'schemaVersion','1','companyId','link-test-company','sourceVersion','2026-10-17T09:00:00-05:00','completeWindow',true,
  'windowFrom','2026-10-01','windowTo','2026-11-01','vouchers','[]'::jsonb,
  'customerLedgers','[{"guid":"alpha","name":"Renamed Alpha"},{"guid":"zeta","name":"Link Zeta"}]'::jsonb)) where id='suprabha';
 if private.stockflow_current_ledger_generation('link-test-company') is distinct from '2026-10-17T09:00:00-05:00' then raise exception 'Generation chosen by text order';end if;
end$test$;
do $target_guard$
declare v_source text;v_customer text;v_before bigint;v_payload jsonb;
begin
 select count(*) into v_before from private.stockflow_economic_targets;
 foreach v_source in array array['alpha','new-guid'] loop
  v_customer:=case when v_source='alpha' then '15100000-0000-4000-8000-000000000005' else '15100000-0000-4000-8000-000000000001' end;
  v_payload:=jsonb_build_object('kind','group','name','Identity conflict fixture','companyId','link-test-company',
   'customerId',v_customer,'customerSourceId',v_source,'siteId','test-site','modelId','SYS240','effectiveFrom','2026-10-01',
   'idempotencyKey','target-identity-conflict-'||v_source);
  begin
   perform public.stockflow_economics_gateway('link-test-key','link-manager@test.local','create_target',v_payload);
   raise exception 'Conflicting create_target identity accepted';
  exception when invalid_parameter_value then
   if sqlerrm<>'Canonical customer identity conflicts with existing verification' then raise;end if;
  end;
 end loop;
 if (select count(*) from private.stockflow_economic_targets)<>v_before
  or exists(select 1 from private.stockflow_command_results where idempotency_key like 'target-identity-conflict-%')
  or exists(select 1 from private.stockflow_economic_customer_identities where company_id='link-test-company' and source_id='new-guid') then
  raise exception 'Identity conflict left target, identity or receipt writes';end if;
end$target_guard$;
rollback;
