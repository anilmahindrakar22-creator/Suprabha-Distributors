begin;
do $test$
declare
  v_ids uuid[] := array[]::uuid[]; v_id uuid; v_inactive uuid; v_division uuid; v_extra uuid;
  v_read jsonb; v_row jsonb; v_bad jsonb; v_actor text; v_filter text; v_i integer;
  v_commands bigint; v_count integer; v_active_divisions integer;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_stale date := ((now() at time zone 'Asia/Kolkata')::date - interval '7 months')::date;
begin
  insert into public.stockflow_members(email,role,roles,status) values
    ('overview-admin@example.test','administrator',array['administrator'],'active'),
    ('overview-manager@example.test','management',array['management'],'active'),
    ('overview-sales@example.test','sales',array['sales'],'active'),
    ('overview-viewer@example.test','viewer',array['viewer'],'active');
  update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('overview-test-key','sha256'),'hex') where name='orders';
  for v_i in 1..6 loop
    insert into private.stockflow_customers(name,city,created_by_email)
      values('Overview fixture '||v_i,'Overview City','overview-admin@example.test') returning id into v_id;
    v_ids:=array_append(v_ids,v_id);
  end loop;
  insert into private.stockflow_customers(name,city,active,created_by_email)
    values('Overview fixture inactive','Overview City',false,'overview-admin@example.test') returning id into v_inactive;
  v_read:=public.stockflow_wallet_gateway('overview-test-key','overview-admin@example.test','set_wallet_division',
    '{"name":"Overview primary","active":true,"idempotencyKey":"overview-division-primary"}');
  v_division:=(v_read->'division'->>'id')::uuid;
  v_read:=public.stockflow_wallet_gateway('overview-test-key','overview-admin@example.test','set_wallet_division',
    '{"name":"Overview extra","active":true,"idempotencyKey":"overview-division-extra"}');
  v_extra:=(v_read->'division'->>'id')::uuid;

  foreach v_actor in array array['overview-sales@example.test','overview-viewer@example.test','overview-missing@example.test'] loop
    begin
      perform public.stockflow_market_overview_gateway('overview-test-key',v_actor,'get_market_overview','{}');
      raise exception 'Forbidden overview member allowed: %',v_actor;
    exception when insufficient_privilege then null; end;
  end loop;
  begin
    perform public.stockflow_market_overview_gateway('wrong','overview-admin@example.test','get_market_overview','{}');
    raise exception 'Bad overview key allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.stockflow_market_overview_gateway('overview-test-key','overview-admin@example.test','wrong','{}');
    raise exception 'Unknown overview action allowed';
  exception when invalid_parameter_value then null; end;
  for v_bad in select value from jsonb_array_elements('[null,[],{"search":null},{"search":3},{"page":null},{"page":"1"},{"page":0},{"page":-1},{"page":1.5},{"page":2147483648},{"filter":null},{"filter":3},{"filter":"bad"}]'::jsonb)
    union all select jsonb_build_object('search',repeat('x',121)) loop
    begin
      perform public.stockflow_market_overview_gateway('overview-test-key','overview-admin@example.test','get_market_overview',v_bad);
      raise exception 'Invalid overview payload allowed: %',v_bad;
    exception when invalid_parameter_value then null; end;
  end loop;
  v_read:=public.stockflow_market_overview_gateway('overview-test-key','overview-manager@example.test','get_market_overview','{"search":"overview city"}');
  if v_read->'pareto' is distinct from '{"basis":"estimated_wallet","focusCustomers":0,"focusWalletPaise":"0","totalWalletPaise":"0","estimatedCustomers":0,"activeCustomers":0}'::jsonb
    or v_read->'counts' is distinct from '{"all":6,"noPin":6,"noEstimate":6,"staleEstimate":0}'::jsonb then raise exception 'Empty overview incorrect: %',v_read; end if;
  v_read:=public.stockflow_market_overview_gateway('overview-test-key','overview-admin@example.test','get_market_overview','{"search":"Overview City","filter":"focus"}');
  if v_read->'customers'<>'[]'::jsonb or v_read->'page'->>'total'<>'0' then raise exception 'Empty focus incorrect'; end if;

  -- Four positive wallets: 50, 30, 15 and 5 rupees. The third is stale.
  for v_i in 1..4 loop
    perform public.stockflow_wallet_gateway('overview-test-key','overview-admin@example.test','record_wallet_estimate',
      jsonb_build_object('customerId',v_ids[v_i],'divisionId',v_division,
        'monthlyWalletPaise',(array['5000','2900','1400','500'])[v_i],
        'asOf',case when v_i=3 then v_stale-1 else v_today end,'method','manager_estimate','confidence','high',
        'note','Overview fixture estimate','idempotencyKey','overview-estimate-'||v_i));
  end loop;
  -- A later effective date replaces 1400 with 1500; same-day corrections use entry time.
  perform public.stockflow_wallet_gateway('overview-test-key','overview-manager@example.test','record_wallet_estimate',
    jsonb_build_object('customerId',v_ids[3],'divisionId',v_division,'monthlyWalletPaise','1500','asOf',v_stale,
      'method','customer_stated','confidence','medium','note','Overview corrected estimate','idempotencyKey','overview-correction-later'));
  perform public.stockflow_wallet_gateway('overview-test-key','overview-manager@example.test','record_wallet_estimate',
    jsonb_build_object('customerId',v_ids[2],'divisionId',v_division,'monthlyWalletPaise','3000','asOf',v_today,
      'method','customer_stated','confidence','medium','note','Overview same day correction','idempotencyKey','overview-correction-same-day'));
  -- A zero estimate still supplies coverage. A stale second division tests oldest vs latest.
  foreach v_id in array array[v_ids[1],v_ids[6]] loop
    perform public.stockflow_wallet_gateway('overview-test-key','overview-admin@example.test','record_wallet_estimate',
      jsonb_build_object('customerId',v_id,'divisionId',v_extra,'monthlyWalletPaise','0','asOf',v_stale,
        'method','manager_estimate','confidence','low','note','Overview zero estimate','idempotencyKey','overview-zero-'||v_id));
  end loop;
  -- An inactive customer with a large wallet must not influence the ranking.
  update private.stockflow_customers set active=true where id=v_inactive;
  perform public.stockflow_wallet_gateway('overview-test-key','overview-admin@example.test','record_wallet_estimate',
    jsonb_build_object('customerId',v_inactive,'divisionId',v_division,'monthlyWalletPaise','999999','asOf',v_today,
      'method','manager_estimate','confidence','high','note','Overview inactive estimate','idempotencyKey','overview-inactive-estimate'));
  update private.stockflow_customers set active=false where id=v_inactive;
  for v_i in 1..2 loop
    perform public.stockflow_market_gateway('overview-test-key','overview-admin@example.test','set_customer_location',
      jsonb_build_object('customerId',v_ids[v_i],'latitude','12.971599','longitude','77.5946','source','manual_pin','idempotencyKey','overview-location-pin-'||v_i));
  end loop;
  select count(*) into v_commands from private.stockflow_command_results;
  select count(*) into v_active_divisions from private.stockflow_wallet_divisions where active;
  foreach v_actor in array array['overview-admin@example.test','overview-manager@example.test'] loop
    v_read:=public.stockflow_market_overview_gateway('overview-test-key',v_actor,'get_market_overview','{"search":"OVERVIEW CITY"}');
    if v_read->'pareto' is distinct from '{"basis":"estimated_wallet","focusCustomers":2,"focusWalletPaise":"8000","totalWalletPaise":"10000","estimatedCustomers":5,"activeCustomers":6}'::jsonb
      or v_read->'counts' is distinct from '{"all":6,"noPin":4,"noEstimate":1,"staleEstimate":3}'::jsonb
      or (v_read->>'activeDivisions')::integer<>v_active_divisions then raise exception 'Overview summary incorrect: %',v_read; end if;
    if (select array_agg(value->>'id' order by ordinality) from jsonb_array_elements(v_read->'customers') with ordinality)
      is distinct from array[v_ids[1]::text,v_ids[2]::text,v_ids[3]::text,v_ids[4]::text,v_ids[6]::text,v_ids[5]::text] then raise exception 'Wallet ordering incorrect'; end if;
    if (select count(*) from jsonb_array_elements(v_read->'customers') where (value->>'inFocus')::boolean)<>2
      or v_read->'customers'->0->>'inFocus'<>'true' or v_read->'customers'->1->>'inFocus'<>'true' then raise exception 'Focus flags incorrect'; end if;
    v_row:=v_read->'customers'->0;
    if v_row->>'divisionsEstimated'<>'2' or v_row->>'latestAsOf'<>v_today::text or v_row->>'oldestAsOf'<>v_stale::text
      or v_row->>'staleEstimate'<>'true' or v_row->>'latitude'<>'12.971599' or v_row->>'longitude'<>'77.594600'
      or v_row->'locationVersion' is distinct from '1'::jsonb
      or jsonb_typeof(v_row->'walletTotalPaise')<>'string' then raise exception 'Customer projection incorrect'; end if;
    v_row:=v_read->'customers'->5;
    if v_row->'walletTotalPaise'<>'null'::jsonb or v_row->'latestAsOf'<>'null'::jsonb or v_row->'oldestAsOf'<>'null'::jsonb
      or v_row->>'divisionsEstimated'<>'0' or v_row->>'staleEstimate'<>'false'
      or v_row ? 'latitude' or v_row ? 'longitude' or v_row ? 'locationVersion' then raise exception 'Missing values incorrect'; end if;
  end loop;
  foreach v_filter in array array['focus','no_pin','no_estimate','stale_estimate'] loop
    v_read:=public.stockflow_market_overview_gateway('overview-test-key','overview-admin@example.test','get_market_overview',jsonb_build_object('search','Overview City','filter',v_filter));
    v_count:=case v_filter when 'focus' then 2 when 'no_pin' then 4 when 'no_estimate' then 1 else 3 end;
    if jsonb_array_length(v_read->'customers')<>v_count or (v_read->'page'->>'total')::integer<>v_count
      or v_read->'counts' is distinct from '{"all":6,"noPin":4,"noEstimate":1,"staleEstimate":3}'::jsonb
      or v_read->'pareto'->>'totalWalletPaise'<>'10000' then raise exception 'Filter counts incorrect: %',v_filter; end if;
    if exists(select 1 from jsonb_array_elements(v_read->'customers') where
      (v_filter='focus' and not (value->>'inFocus')::boolean) or (v_filter='no_pin' and (value->>'hasPin')::boolean)
      or (v_filter='no_estimate' and value->'walletTotalPaise'<>'null'::jsonb)
      or (v_filter='stale_estimate' and not (value->>'staleEstimate')::boolean)) then raise exception 'Wrong filter rows: %',v_filter; end if;
  end loop;
  if (select count(*) from private.stockflow_command_results)<>v_commands then raise exception 'Overview reads wrote commands'; end if;

  -- The second division's value is excluded after deactivation, including its zero estimates.
  perform public.stockflow_wallet_gateway('overview-test-key','overview-admin@example.test','record_wallet_estimate',
    jsonb_build_object('customerId',v_ids[1],'divisionId',v_extra,'monthlyWalletPaise','900000','asOf',v_today,
      'method','manager_estimate','confidence','high','note','Overview extra estimate','idempotencyKey','overview-extra-estimate'));
  perform public.stockflow_wallet_gateway('overview-test-key','overview-manager@example.test','set_wallet_division',
    jsonb_build_object('divisionId',v_extra,'name','Overview extra','active',false,'expectedVersion',1,'idempotencyKey','overview-deactivate-extra'));
  v_read:=public.stockflow_market_overview_gateway('overview-test-key','overview-admin@example.test','get_market_overview','{"search":"Overview City"}');
  if v_read->'pareto'->>'totalWalletPaise'<>'10000' or v_read->'customers'->0->>'divisionsEstimated'<>'1'
    or v_read->'customers'->0->>'staleEstimate'<>'false' or v_read->'counts'->>'noEstimate'<>'2'
    or v_read->'counts'->>'staleEstimate'<>'1' or (v_read->>'activeDivisions')::integer<>v_active_divisions-1 then raise exception 'Inactive division counted'; end if;
  -- Search scopes both the focus base and coverage counts.
  v_read:=public.stockflow_market_overview_gateway('overview-test-key','overview-admin@example.test','get_market_overview','{"search":"fixture 3"}');
  if v_read->'counts'->>'all'<>'1' or v_read->'pareto'->>'totalWalletPaise'<>'1500'
    or v_read->'pareto'->>'focusCustomers'<>'1' then raise exception 'Search did not scope aggregates'; end if;
  -- 50 + 30 + 15 = 95 rupees: 50 + 30 crosses (rather than equals) 80%.
  update private.stockflow_customers set active=false where id=v_ids[4];
  v_read:=public.stockflow_market_overview_gateway('overview-test-key','overview-admin@example.test','get_market_overview','{"search":"Overview City","filter":"focus"}');
  if v_read->'pareto'->>'focusCustomers'<>'2' or v_read->'pareto'->>'focusWalletPaise'<>'8000'
    or v_read->'pareto'->>'totalWalletPaise'<>'9500' then raise exception 'Pareto crossing row incorrect'; end if;
  update private.stockflow_customers set active=true where id=v_ids[4];
  for v_i in 1..51 loop
    insert into private.stockflow_customers(name,city,created_by_email)
      values('Overview paging '||lpad(v_i::text,2,'0'),'Overview Paging City','overview-admin@example.test');
  end loop;
  v_read:=public.stockflow_market_overview_gateway('overview-test-key','overview-admin@example.test','get_market_overview','{"search":"overview paging city"}');
  if jsonb_array_length(v_read->'customers')<>50 or v_read->'page' is distinct from '{"page":1,"pageSize":50,"total":51}'::jsonb
    or v_read->'customers'->49->>'name'<>'Overview paging 50' then raise exception 'First page incorrect'; end if;
  v_read:=public.stockflow_market_overview_gateway('overview-test-key','overview-admin@example.test','get_market_overview','{"search":"overview paging city","page":2}');
  if jsonb_array_length(v_read->'customers')<>1 or v_read->'customers'->0->>'name'<>'Overview paging 51' then raise exception 'Second page incorrect'; end if;
  v_read:=public.stockflow_market_overview_gateway('overview-test-key','overview-admin@example.test','get_market_overview','{"search":"overview paging city","page":2147483647}');
  if v_read->'customers'<>'[]'::jsonb or v_read->'page'->>'total'<>'51' then raise exception 'Large page incorrect'; end if;
  if has_function_privilege('authenticated','public.stockflow_market_overview_gateway(text,text,text,jsonb)','EXECUTE')
    or has_function_privilege('anon','public.stockflow_market_overview_gateway(text,text,text,jsonb)','EXECUTE')
    or not has_function_privilege('service_role','public.stockflow_market_overview_gateway(text,text,text,jsonb)','EXECUTE') then raise exception 'Overview grants incorrect'; end if;
end $test$;
rollback;
