begin;
do $test$
declare
  v_customer uuid; v_inactive uuid; v_division uuid; v_seed uuid; v_estimate uuid;
  v_payload jsonb; v_result jsonb; v_replay jsonb; v_read jsonb; v_bad jsonb;
  v_actor text; v_action text; v_count integer:=0; v_commands bigint; v_names text[];
begin
  insert into public.stockflow_members(email,role,roles,status) values
    ('wallet-admin@example.test','administrator',array['administrator'],'active'),
    ('wallet-manager@example.test','management',array['management'],'active'),
    ('wallet-sales@example.test','sales',array['sales'],'active'),
    ('wallet-viewer@example.test','viewer',array['viewer'],'active');
  update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('wallet-test-key','sha256'),'hex') where name='orders';
  insert into private.stockflow_customers(name,created_by_email) values('Wallet orderless fixture','wallet-admin@example.test') returning id into v_customer;
  insert into private.stockflow_customers(name,active,created_by_email) values('Wallet inactive fixture',false,'wallet-admin@example.test') returning id into v_inactive;

  foreach v_action in array array['get_wallet_divisions','set_wallet_division','record_wallet_estimate','get_customer_wallet'] loop
    foreach v_actor in array array['wallet-viewer@example.test','wallet-sales@example.test','wallet-missing@example.test'] loop
      begin
        perform public.stockflow_wallet_gateway('wallet-test-key',v_actor,v_action,'{}');
        raise exception 'Forbidden member allowed: %, %',v_actor,v_action;
      exception when insufficient_privilege then null; end;
    end loop;
    begin
      perform public.stockflow_wallet_gateway('wrong','wallet-admin@example.test',v_action,'{}');
      raise exception 'Bad gateway key allowed: %',v_action;
    exception when insufficient_privilege then null; end;
  end loop;
  v_read:=public.stockflow_wallet_gateway('wallet-test-key','wallet-admin@example.test','get_wallet_divisions','{}');
  select array_agg(value->>'name' order by ordinality) into v_names from jsonb_array_elements(v_read->'divisions') with ordinality;
  if v_names is distinct from array['Biochemistry','Haematology','Immunoassay','Electrolytes','Coagulation','Urine','Other'] then raise exception 'Seed names/order incorrect: %',v_names; end if;
  if exists(select 1 from private.stockflow_wallet_divisions where not active or version<>1 or created_by_email<>'system:migration' or updated_by_email<>'system:migration')
    or exists(select 1 from private.stockflow_wallet_division_events) then raise exception 'Seed metadata/events incorrect'; end if;
  if exists(select 1 from jsonb_array_elements(v_read->'divisions') with ordinality where (value->>'sortOrder')::integer<>ordinality*10) then raise exception 'Seed sort orders incorrect'; end if;
  v_seed:=(v_read->'divisions'->0->>'id')::uuid;

  v_payload:='{"name":" Wallet fixture division ","active":true,"sortOrder":80,"idempotencyKey":"wallet-division-create-001"}';
  v_result:=public.stockflow_wallet_gateway('wallet-test-key','wallet-admin@example.test','set_wallet_division',v_payload);
  v_division:=(v_result->'division'->>'id')::uuid;
  if v_result->>'ok'<>'true' or v_result->'division'->>'name'<>'Wallet fixture division' or v_result->'division'->>'version'<>'1'
    or (select count(*) from private.stockflow_wallet_division_events where division_id=v_division)<>1
    or not exists(select 1 from private.stockflow_wallet_division_events where division_id=v_division and event_type='created'
      and old_name is null and old_active is null and new_name='Wallet fixture division' and new_active
      and actor_email='wallet-admin@example.test' and request_id='wallet-division-create-001') then raise exception 'Division creation/audit incorrect'; end if;
  v_replay:=public.stockflow_wallet_gateway('wallet-test-key','wallet-admin@example.test','set_wallet_division',v_payload);
  if v_replay is distinct from v_result or (select count(*) from private.stockflow_wallet_division_events where division_id=v_division)<>1 then raise exception 'Division replay incorrect'; end if;
  begin
    perform public.stockflow_wallet_gateway('wallet-test-key','wallet-admin@example.test','set_wallet_division',v_payload||'{"name":"WALLET FIXTURE DIVISION","idempotencyKey":"wallet-division-duplicate-001"}');
    raise exception 'Duplicate name allowed';
  exception when invalid_parameter_value then
    if sqlerrm<>'Division name already used' then raise; end if;
  end;
  v_payload:=jsonb_build_object('divisionId',v_division,'name','Wallet renamed division','active',false,'expectedVersion',1,'idempotencyKey','wallet-division-edit-001');
  v_result:=public.stockflow_wallet_gateway('wallet-test-key','wallet-manager@example.test','set_wallet_division',v_payload);
  if v_result->'division'->>'active'<>'false' or v_result->'division'->>'version'<>'2' or v_result->'division'->>'sortOrder'<>'80'
    or not exists(select 1 from private.stockflow_wallet_division_events where division_id=v_division and event_type='updated'
      and old_name='Wallet fixture division' and new_name='Wallet renamed division' and old_active and not new_active
      and actor_email='wallet-manager@example.test') then raise exception 'Division edit/audit incorrect'; end if;
  begin
    perform public.stockflow_wallet_gateway('wallet-test-key','wallet-admin@example.test','set_wallet_division',v_payload||'{"idempotencyKey":"wallet-division-stale-001"}');
    raise exception 'Stale version allowed';
  exception when sqlstate 'PT409' then null; end;
  begin
    perform public.stockflow_wallet_gateway('wallet-test-key','wallet-admin@example.test','set_wallet_division',(v_payload-'expectedVersion')||'{"idempotencyKey":"wallet-division-no-version-001"}');
    raise exception 'Missing version allowed';
  exception when sqlstate 'PT409' then null; end;
  v_read:=public.stockflow_wallet_gateway('wallet-test-key','wallet-manager@example.test','get_wallet_divisions','{}');
  if not exists(select 1 from jsonb_array_elements(v_read->'divisions') where value->>'id'=v_division::text and value->>'active'='false') then raise exception 'Inactive division omitted'; end if;

  v_payload:=jsonb_build_object('customerId',v_customer,'divisionId',v_seed,'monthlyWalletPaise','1000','method','customer_stated',
    'confidence','high','note',' Initial estimate ','asOf','2020-01-01','idempotencyKey','wallet-estimate-record-001');
  for v_bad in select value from jsonb_array_elements(jsonb_build_array(jsonb_build_object('divisionId',v_division),jsonb_build_object('customerId',v_inactive))) loop
    begin
      perform public.stockflow_wallet_gateway('wallet-test-key','wallet-admin@example.test','record_wallet_estimate',v_payload||v_bad);
      raise exception 'Inactive reference allowed';
    exception when invalid_parameter_value then null; end;
  end loop;
  v_result:=public.stockflow_wallet_gateway('wallet-test-key','wallet-admin@example.test','record_wallet_estimate',v_payload);
  v_estimate:=(v_result->'estimate'->>'id')::uuid;
  if v_result->>'ok'<>'true' or v_result->'estimate'->>'monthlyWalletPaise'<>'1000' or jsonb_typeof(v_result->'estimate'->'monthlyWalletPaise')<>'string'
    or v_result->'estimate'->>'note'<>'Initial estimate' or v_result->'estimate'->>'createdBy'<>'wallet-admin@example.test'
    or v_result->'estimate'->>'customerId'<>v_customer::text or v_result->'estimate'->>'divisionId'<>v_seed::text
    or not exists(select 1 from private.stockflow_wallet_estimates where id=v_estimate and request_id='wallet-estimate-record-001') then raise exception 'Estimate record incorrect'; end if;
  v_replay:=public.stockflow_wallet_gateway('wallet-test-key','wallet-admin@example.test','record_wallet_estimate',v_payload);
  if v_replay is distinct from v_result or (select count(*) from private.stockflow_wallet_estimates where customer_id=v_customer)<>1 then raise exception 'Estimate replay incorrect'; end if;
  begin
    perform public.stockflow_wallet_gateway('wallet-test-key','wallet-admin@example.test','record_wallet_estimate',v_payload||'{"monthlyWalletPaise":"2000"}');
    raise exception 'Changed replay payload allowed';
  exception when invalid_parameter_value then null; end;

  perform public.stockflow_wallet_gateway('wallet-test-key','wallet-manager@example.test','record_wallet_estimate',v_payload||'{"asOf":"2020-02-01","monthlyWalletPaise":"2000","idempotencyKey":"wallet-correction-later-001"}');
  v_read:=public.stockflow_wallet_gateway('wallet-test-key','wallet-manager@example.test','get_customer_wallet',jsonb_build_object('customerId',v_customer));
  if v_read->'current'->0->>'monthlyWalletPaise'<>'2000' then raise exception 'Later effective date did not win'; end if;
  perform public.stockflow_wallet_gateway('wallet-test-key','wallet-admin@example.test','record_wallet_estimate',v_payload||'{"asOf":"2019-12-01","monthlyWalletPaise":"3000","idempotencyKey":"wallet-correction-earlier-001"}');
  v_read:=public.stockflow_wallet_gateway('wallet-test-key','wallet-admin@example.test','get_customer_wallet',jsonb_build_object('customerId',v_customer));
  if v_read->'current'->0->>'monthlyWalletPaise'<>'2000' or v_read->'history'->0->>'asOf'<>'2019-12-01' then raise exception 'Backdated correction/current or history incorrect'; end if;
  perform public.stockflow_wallet_gateway('wallet-test-key','wallet-admin@example.test','record_wallet_estimate',v_payload||'{"asOf":"2020-02-01","monthlyWalletPaise":"4000","idempotencyKey":"wallet-correction-same-date-001"}');
  v_read:=public.stockflow_wallet_gateway('wallet-test-key','wallet-admin@example.test','get_customer_wallet',jsonb_build_object('customerId',v_customer));
  if v_read->'current'->0->>'monthlyWalletPaise'<>'4000' then raise exception 'Later created_at did not win same effective date'; end if;
  if not ((select created_at from private.stockflow_wallet_estimates where request_id='wallet-correction-same-date-001')>
    (select created_at from private.stockflow_wallet_estimates where request_id='wallet-correction-later-001')) then raise exception 'Same-date fixture timestamps not ordered'; end if;

  for v_bad in select value from jsonb_array_elements(jsonb_build_array(
    '{"monthlyWalletPaise":100}'::jsonb,'{"monthlyWalletPaise":"-1"}'::jsonb,'{"monthlyWalletPaise":"12345678901234"}'::jsonb,
    '{"monthlyWalletPaise":"1000000000001"}'::jsonb,jsonb_build_object('asOf',((now() at time zone 'Asia/Kolkata')::date+1)::text),
    '{"asOf":"2026-02-30"}'::jsonb,'{"asOf":"1999-12-31"}'::jsonb,'{"note":"ab"}'::jsonb,
    '{"method":"bad"}'::jsonb,'{"confidence":"bad"}'::jsonb,'{"customerId":"bad"}'::jsonb,'{"divisionId":"bad"}'::jsonb)) loop
    v_count:=v_count+1;
    begin
      perform public.stockflow_wallet_gateway('wallet-test-key','wallet-admin@example.test','record_wallet_estimate',
        v_payload||v_bad||jsonb_build_object('idempotencyKey','wallet-invalid-input-'||v_count));
      raise exception 'Invalid input allowed: %',v_bad;
    exception when invalid_parameter_value then null; end;
  end loop;
  begin
    update private.stockflow_wallet_estimates set note='Changed' where id=v_estimate;
    raise exception 'Estimate update allowed';
  exception when insufficient_privilege then null; end;
  begin
    delete from private.stockflow_wallet_estimates where id=v_estimate;
    raise exception 'Estimate delete allowed';
  exception when insufficient_privilege then null; end;
  begin
    update private.stockflow_wallet_division_events set actor_email='changed' where division_id=v_division;
    raise exception 'Division event update allowed';
  exception when insufficient_privilege then null; end;
  begin
    delete from private.stockflow_wallet_division_events where division_id=v_division;
    raise exception 'Division event delete allowed';
  exception when insufficient_privilege then null; end;
  begin
    delete from private.stockflow_wallet_divisions where id=v_division;
    raise exception 'Division delete allowed';
  exception when insufficient_privilege then null; end;

  -- A second division checks summation/order; history is bounded by entry time.
  select id into v_seed from private.stockflow_wallet_divisions where name='Other';
  for v_count in 1..55 loop
    perform public.stockflow_wallet_gateway('wallet-test-key','wallet-manager@example.test','record_wallet_estimate',
      v_payload||jsonb_build_object('divisionId',v_seed,'monthlyWalletPaise',v_count::text,'idempotencyKey','wallet-history-row-'||v_count));
  end loop;
  select count(*) into v_commands from private.stockflow_command_results;
  foreach v_actor in array array['wallet-admin@example.test','wallet-manager@example.test'] loop
    perform public.stockflow_wallet_gateway('wallet-test-key',v_actor,'get_wallet_divisions','{}');
    v_read:=public.stockflow_wallet_gateway('wallet-test-key',v_actor,'get_customer_wallet',jsonb_build_object('customerId',v_customer));
    if jsonb_array_length(v_read->'current')<>2 or v_read->'current'->0->'division'->>'name'<>'Biochemistry'
      or v_read->'current'->1->'division'->>'name'<>'Other' or v_read->>'totalMonthlyWalletPaise'<>'4055'
      or (v_read->>'totalMonthlyWalletPaise')::bigint<>(select sum((value->>'monthlyWalletPaise')::bigint) from jsonb_array_elements(v_read->'current'))
      or jsonb_typeof(v_read->'totalMonthlyWalletPaise')<>'string' or jsonb_array_length(v_read->'history')<>50
      or v_read->'history'->0->>'monthlyWalletPaise'<>'55' or v_read->'history'->49->>'monthlyWalletPaise'<>'6' then raise exception 'Wallet total/order/history cap incorrect'; end if;
    if v_read ? 'revenue' or v_read ? 'revenuePaise' or v_read ? 'share' then raise exception 'Revenue fields leaked into wallet'; end if;
  end loop;
  if (select count(*) from private.stockflow_command_results)<>v_commands then raise exception 'Reads wrote commands'; end if;
  -- Reads also support inactive customers and empty wallets.
  v_read:=public.stockflow_wallet_gateway('wallet-test-key','wallet-admin@example.test','get_customer_wallet',jsonb_build_object('customerId',v_inactive));
  if v_read<>'{"current":[],"history":[],"totalMonthlyWalletPaise":"0"}'::jsonb then raise exception 'Empty inactive wallet read incorrect'; end if;
  begin
    perform public.stockflow_wallet_gateway('wallet-test-key','wallet-admin@example.test','get_customer_wallet',jsonb_build_object('customerId',extensions.gen_random_uuid()));
    raise exception 'Unknown customer allowed';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.stockflow_wallet_gateway('wallet-test-key','wallet-admin@example.test','unknown','{}');
    raise exception 'Unknown action allowed';
  exception when invalid_parameter_value then null; end;
  if has_function_privilege('authenticated','public.stockflow_wallet_gateway(text,text,text,jsonb)','EXECUTE')
    or has_function_privilege('anon','public.stockflow_wallet_gateway(text,text,text,jsonb)','EXECUTE')
    or not has_function_privilege('service_role','public.stockflow_wallet_gateway(text,text,text,jsonb)','EXECUTE') then raise exception 'Gateway grants incorrect'; end if;
end $test$;
rollback;
