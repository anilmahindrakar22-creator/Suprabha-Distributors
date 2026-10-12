begin;
insert into public.stockflow_members(email,role,roles,status) values
 ('market-admin@example.test','administrator',array['administrator'],'active'),
 ('market-manager@example.test','management',array['management'],'active'),
 ('market-sales@example.test','sales',array['sales'],'active'),
 ('market-viewer@example.test','viewer',array['viewer'],'active'),
 ('market-union@example.test','sales',array['sales','management'],'active');
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('market-test-key','sha256'),'hex') where name='orders';

do $test$
declare
  v_customer uuid; v_inactive uuid; v_location uuid; v_unknown uuid:=extensions.gen_random_uuid();
  v_payload jsonb; v_result jsonb; v_replay jsonb; v_read jsonb; v_bad jsonb;
  v_actor text; v_action text; v_count integer:=0; v_commands bigint;
begin
  insert into private.stockflow_customers(name,city,created_by_email) values('Market fixture orderless','Market City Exact Fixture','market-admin@example.test') returning id into v_customer;
  insert into private.stockflow_customers(name,city,active,created_by_email) values('Market inactive fixture','Market City Exact Fixture',false,'market-admin@example.test') returning id into v_inactive;
  insert into private.stockflow_customers(name,city,created_by_email)
    select 'Market pagination fixture '||lpad(n::text,3,'0'),'Market Pagination City','market-admin@example.test' from generate_series(1,55) n;
  if exists(select 1 from private.stockflow_orders where customer_id=v_customer) then raise exception 'Historical fixture has orders'; end if;
  v_payload:=jsonb_build_object('customerId',v_customer,'latitude','12.971599','longitude','77.594600','source','manual_pin','idempotencyKey','market-place-test-001');

  foreach v_action in array array['get_customer_locations','set_customer_location'] loop
    foreach v_actor in array array['market-viewer@example.test','market-sales@example.test','market-missing@example.test'] loop
      begin
        perform public.stockflow_market_gateway('market-test-key',v_actor,v_action,v_payload);
        raise exception 'Forbidden member allowed: %, %',v_actor,v_action;
      exception when insufficient_privilege then null; end;
    end loop;
    begin
      perform public.stockflow_market_gateway('wrong','market-admin@example.test',v_action,v_payload);
      raise exception 'Wrong gateway key allowed';
    exception when insufficient_privilege then null; end;
  end loop;
  foreach v_actor in array array['market-admin@example.test','market-manager@example.test','market-union@example.test'] loop
    perform public.stockflow_market_gateway('market-test-key',v_actor,'get_customer_locations','{}');
  end loop;

  v_result:=public.stockflow_market_gateway('market-test-key','market-admin@example.test','set_customer_location',v_payload);
  if v_result->>'ok'<>'true' or v_result->'location'->>'version'<>'1' or v_result->>'customerId'<>v_customer::text then raise exception 'Pin placement failed'; end if;
  select id into v_location from private.stockflow_customer_locations where customer_id=v_customer;
  if (select count(*) from private.stockflow_customer_location_events where location_id=v_location)<>1
    or not exists(select 1 from private.stockflow_customer_location_events where location_id=v_location and event_type='placed'
      and old_latitude is null and old_longitude is null and new_latitude=12.971599 and new_longitude=77.594600
      and actor_email='market-admin@example.test' and request_id='market-place-test-001') then raise exception 'Placement audit incorrect'; end if;
  v_replay:=public.stockflow_market_gateway('market-test-key','market-admin@example.test','set_customer_location',v_payload);
  if v_replay is distinct from v_result or (select count(*) from private.stockflow_customer_location_events where location_id=v_location)<>1 then raise exception 'Replay changed result or duplicated audit'; end if;
  begin
    perform public.stockflow_market_gateway('market-test-key','market-admin@example.test','set_customer_location',v_payload||'{"latitude":"13"}');
    raise exception 'Changed idempotent payload allowed';
  exception when invalid_parameter_value then null; end;

  v_result:=public.stockflow_market_gateway('market-test-key','market-manager@example.test','set_customer_location',
    v_payload||'{"latitude":"13.123456","longitude":"78.654321","source":"pasted_link","expectedVersion":1,"idempotencyKey":"market-move-test-001"}');
  if v_result->'location'->>'version'<>'2' or (select count(*) from private.stockflow_customer_location_events where location_id=v_location)<>2
    or not exists(select 1 from private.stockflow_customer_location_events where location_id=v_location and event_type='moved'
      and old_latitude=12.971599 and old_longitude=77.594600 and new_latitude=13.123456 and new_longitude=78.654321
      and source='pasted_link' and actor_email='market-manager@example.test') then raise exception 'Move or audit incorrect'; end if;
  begin
    perform public.stockflow_market_gateway('market-test-key','market-admin@example.test','set_customer_location',v_payload||'{"expectedVersion":1,"idempotencyKey":"market-stale-test-001"}');
    raise exception 'Stale move allowed';
  exception when sqlstate 'PT409' then null; end;
  begin
    perform public.stockflow_market_gateway('market-test-key','market-admin@example.test','set_customer_location',v_payload||'{"idempotencyKey":"market-create-existing-001"}');
    raise exception 'Existing pin overwritten without a version';
  exception when sqlstate 'PT409' then null; end;

  for v_bad in select value from jsonb_array_elements(jsonb_build_array(
    '{"latitude":"91"}'::jsonb,'{"longitude":"181"}'::jsonb,'{"latitude":"0","longitude":"0"}'::jsonb,
    '{"latitude":"12.1234567"}'::jsonb,'{"longitude":"77.1234567"}'::jsonb,'{"latitude":"abc"}'::jsonb,
    '{"source":"unknown"}'::jsonb,jsonb_build_object('customerId',v_inactive),jsonb_build_object('customerId',v_unknown),
    '{"latitude":12}'::jsonb,'{"customerId":"bad"}'::jsonb,'{"expectedVersion":0}'::jsonb)) loop
    v_count:=v_count+1;
    begin
      perform public.stockflow_market_gateway('market-test-key','market-admin@example.test','set_customer_location',
        v_payload||v_bad||jsonb_build_object('idempotencyKey','market-invalid-test-'||v_count));
      raise exception 'Invalid input allowed: %',v_bad;
    exception when invalid_parameter_value then null; end;
  end loop;
  begin
    update private.stockflow_customer_location_events set actor_email='changed' where location_id=v_location;
    raise exception 'Audit update allowed';
  exception when insufficient_privilege then null; end;
  begin
    delete from private.stockflow_customer_location_events where location_id=v_location;
    raise exception 'Audit deletion allowed';
  exception when insufficient_privilege then null; end;
  begin
    delete from private.stockflow_customer_locations where id=v_location;
    raise exception 'Location deletion allowed';
  exception when insufficient_privilege then null; end;

  select count(*) into v_commands from private.stockflow_command_results;
  v_read:=public.stockflow_market_gateway('market-test-key','market-admin@example.test','get_customer_locations','{"search":"market pagination city","page":1}');
  if jsonb_array_length(v_read->'customers')<>50 or v_read->'page'<> '{"page":1,"pageSize":50,"total":55}'::jsonb then raise exception 'First page not bounded'; end if;
  v_read:=public.stockflow_market_gateway('market-test-key','market-admin@example.test','get_customer_locations','{"search":"MARKET PAGINATION CITY","page":2}');
  if jsonb_array_length(v_read->'customers')<>5 or v_read->'customers'->0->'location'<>'null'::jsonb then raise exception 'Second page incorrect'; end if;
  v_read:=public.stockflow_market_gateway('market-test-key','market-manager@example.test','get_customer_locations','{"search":"market city exact fixture"}');
  if jsonb_array_length(v_read->'customers')<>1 or v_read->'customers'->0->>'id'<>v_customer::text
    or v_read->'customers'->0->'location'->'latitude'<>'"13.123456"'::jsonb
    or v_read->'customers'->0->'location'->'longitude'<>'"78.654321"'::jsonb
    or v_read->'customers'->0->'location'->>'updatedBy'<>'market-manager@example.test' then raise exception 'City search, exact string or inactive filtering incorrect'; end if;
  if (select count(*) from private.stockflow_command_results)<>v_commands then raise exception 'Read wrote a command record'; end if;
  begin
    perform public.stockflow_market_gateway('market-test-key','market-admin@example.test','unknown','{}');
    raise exception 'Unknown action allowed';
  exception when invalid_parameter_value then null; end;
  if has_function_privilege('authenticated','public.stockflow_market_gateway(text,text,text,jsonb)','EXECUTE')
    or has_function_privilege('anon','public.stockflow_market_gateway(text,text,text,jsonb)','EXECUTE')
    or not has_function_privilege('service_role','public.stockflow_market_gateway(text,text,text,jsonb)','EXECUTE') then raise exception 'Gateway grants incorrect'; end if;
end $test$;
rollback;
