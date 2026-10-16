begin;

insert into public.stockflow_members(email,role,roles,status) values
 ('accounts-admin@example.test','administrator',array['administrator'],'active'),
 ('accounts-manager@example.test','management',array['management'],'active'),
 ('accounts-sales@example.test','sales',array['sales'],'active'),
 ('accounts-ops@example.test','operations',array['operations'],'active'),
 ('accounts-viewer@example.test','viewer',array['viewer'],'active'),
 ('accounts-inactive@example.test','sales',array['sales'],'suspended');
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('accounts-test-key','sha256'),'hex') where name='orders';

do $test$
declare
  v_today date:=(now() at time zone 'Asia/Kolkata')::date;
  v_overdue uuid; v_never uuid; v_oldest uuid; v_north uuid; v_south uuid; v_order uuid; v_visit uuid;
  v_result jsonb; v_replay jsonb; v_payload jsonb; v_read jsonb; v_bad jsonb;
  v_actor text; v_action text; v_table text; v_count integer:=0; v_before bigint;
begin
  insert into private.stockflow_customers(name,city,created_by_email) values
    ('Accounts fixture overdue','Accounts Exact Fixture City','accounts-admin@example.test') returning id into v_overdue;
  insert into private.stockflow_customers(name,city,created_by_email) values
    ('Accounts fixture never','Accounts Exact Fixture City','accounts-admin@example.test') returning id into v_never;
  insert into private.stockflow_customers(name,city,created_by_email) values
    ('Accounts fixture oldest','Accounts Exact Fixture City','accounts-admin@example.test') returning id into v_oldest;
  insert into private.stockflow_orders(customer_id,customer_name,status,idempotency_key,created_by_email,updated_by_email,created_at)
    values(v_overdue,'Accounts fixture overdue','phone_order_received','accounts-order-fixture-001','accounts-admin@example.test','accounts-admin@example.test',
      (v_today::timestamp + interval '00:15') at time zone 'Asia/Kolkata') returning id into v_order;
  insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,quantity) values(v_order,'ACCOUNTS-FIXTURE-ITEM','Accounts fixture item',1);
  insert into private.stockflow_orders(customer_id,customer_name,status,idempotency_key,created_by_email,updated_by_email,created_at)
    values(v_overdue,'Accounts fixture overdue','phone_order_received','accounts-order-fixture-002','accounts-admin@example.test','accounts-admin@example.test',
      ((v_today-5)::timestamp + interval '23:45') at time zone 'Asia/Kolkata') returning id into v_order;
  insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,quantity) values(v_order,'ACCOUNTS-FIXTURE-ITEM','Accounts fixture item',1);

  v_payload:='{"name":"Accounts fixture North","idempotencyKey":"accounts-territory-north-001"}';
  v_result:=public.stockflow_accounts_gateway('accounts-test-key','accounts-manager@example.test','create_territory',v_payload);
  v_north:=(v_result->'territory'->>'id')::uuid;
  v_replay:=public.stockflow_accounts_gateway('accounts-test-key','accounts-manager@example.test','create_territory',v_payload);
  if v_replay is distinct from v_result or (select count(*) from private.stockflow_territories where id=v_north)<>1 then raise exception 'Territory replay failed'; end if;
  v_result:=public.stockflow_accounts_gateway('accounts-test-key','accounts-admin@example.test','create_territory',
    '{"name":"Accounts fixture South","idempotencyKey":"accounts-territory-south-001"}');
  v_south:=(v_result->'territory'->>'id')::uuid;
  begin
    perform public.stockflow_accounts_gateway('accounts-test-key','accounts-manager@example.test','create_territory',
      '{"name":"ACCOUNTS FIXTURE NORTH","idempotencyKey":"accounts-territory-duplicate-001"}');
    raise exception 'Duplicate territory allowed';
  exception when sqlstate 'PT409' then
    if sqlerrm<>'Territory already exists' then raise; end if;
  end;

  foreach v_actor in array array['accounts-viewer@example.test','accounts-inactive@example.test','accounts-missing@example.test'] loop
    begin
      perform public.stockflow_accounts_gateway('accounts-test-key',v_actor,'get_accounts','{}');
      raise exception 'Forbidden reader allowed: %',v_actor;
    exception when insufficient_privilege then null; end;
  end loop;
  foreach v_actor in array array['accounts-admin@example.test','accounts-manager@example.test','accounts-sales@example.test','accounts-ops@example.test'] loop
    perform public.stockflow_accounts_gateway('accounts-test-key',v_actor,'get_accounts','{}');
  end loop;
  begin
    perform public.stockflow_accounts_gateway('wrong-key','accounts-admin@example.test','get_accounts','{}');
    raise exception 'Wrong gateway key allowed';
  exception when insufficient_privilege then null; end;

  v_payload:=jsonb_build_object('customerId',v_overdue,'ownerEmail','accounts-sales@example.test','territoryId',v_north,
    'expectedVersion',null,'idempotencyKey','accounts-assignment-first-001');
  foreach v_action in array array['assign_account','create_territory'] loop
    foreach v_actor in array array['accounts-sales@example.test','accounts-ops@example.test'] loop
      begin
        perform public.stockflow_accounts_gateway('accounts-test-key',v_actor,v_action,v_payload);
        raise exception 'Management action allowed: %, %',v_actor,v_action;
      exception when insufficient_privilege then null; end;
    end loop;
  end loop;
  v_result:=public.stockflow_accounts_gateway('accounts-test-key','accounts-manager@example.test','assign_account',v_payload);
  if v_result->'owner'->>'version'<>'1' or v_result->'owner'->>'territoryId'<>v_north::text then raise exception 'Initial assignment failed'; end if;
  v_replay:=public.stockflow_accounts_gateway('accounts-test-key','accounts-manager@example.test','assign_account',v_payload);
  if v_replay is distinct from v_result or (select count(*) from private.stockflow_customer_assignments where customer_id=v_overdue)<>1 then raise exception 'Assignment replay duplicated history'; end if;
  v_result:=public.stockflow_accounts_gateway('accounts-test-key','accounts-manager@example.test','assign_account',v_payload||
    jsonb_build_object('territoryId',v_south,'expectedVersion',1,'idempotencyKey','accounts-assignment-second-001'));
  if v_result->'owner'->>'version'<>'2'
    or (select count(*) from private.stockflow_customer_assignments where customer_id=v_overdue)<>2
    or not exists(select 1 from private.stockflow_customer_assignments where customer_id=v_overdue and version=1
      and effective_from=v_today and effective_to=v_today and territory_id=v_north)
    or not exists(select 1 from private.stockflow_customer_assignments where customer_id=v_overdue and version=2 and effective_to is null and territory_id=v_south) then
    raise exception 'Same-day reassignment lost history'; end if;
  begin
    perform public.stockflow_accounts_gateway('accounts-test-key','accounts-manager@example.test','assign_account',v_payload||
      '{"expectedVersion":1,"idempotencyKey":"accounts-assignment-stale-001"}');
    raise exception 'Stale assignment allowed';
  exception when sqlstate 'PT409' then
    if sqlerrm<>'Owner changed; refresh and try again' then raise; end if;
  end;
  begin
    update private.stockflow_customer_assignments set owner_email='accounts-manager@example.test' where customer_id=v_overdue and effective_to is null;
    raise exception 'Assignment history edited';
  exception when insufficient_privilege then null; end;
  begin
    update private.stockflow_customer_assignments set effective_to=null where customer_id=v_overdue and version=1;
    raise exception 'Closed assignment reopened';
  exception when insufficient_privilege then null; end;
  perform public.stockflow_accounts_gateway('accounts-test-key','accounts-manager@example.test','assign_account',v_payload||
    jsonb_build_object('customerId',v_never,'idempotencyKey','accounts-assign-never-001'));
  perform public.stockflow_accounts_gateway('accounts-test-key','accounts-manager@example.test','assign_account',v_payload||
    jsonb_build_object('customerId',v_oldest,'ownerEmail','accounts-manager@example.test','idempotencyKey','accounts-assign-oldest-001'));
  for v_actor in select unnest(array['accounts-ops@example.test','accounts-inactive@example.test']) loop
    begin
      perform public.stockflow_accounts_gateway('accounts-test-key','accounts-manager@example.test','assign_account',v_payload||
        jsonb_build_object('ownerEmail',v_actor,'expectedVersion',2,'idempotencyKey','accounts-invalid-owner-001'));
      raise exception 'Ineligible owner assigned';
    exception when invalid_parameter_value then null; end;
  end loop;

  v_payload:=jsonb_build_object('customerId',v_overdue,'precision','pin','latitude','12.9716','longitude','77.5946','source','manual_pin',
    'expectedVersion',null,'idempotencyKey','accounts-location-first-001');
  v_result:=public.stockflow_accounts_gateway('accounts-test-key','accounts-sales@example.test','set_location',v_payload);
  v_replay:=public.stockflow_accounts_gateway('accounts-test-key','accounts-sales@example.test','set_location',v_payload);
  if v_result is distinct from v_replay or v_result->'location'->>'version'<>'1'
    or (select count(*) from private.stockflow_customer_location_events where customer_id=v_overdue)<>1 then raise exception 'Location placement/replay failed'; end if;
  v_result:=public.stockflow_accounts_gateway('accounts-test-key','accounts-ops@example.test','set_location',
    jsonb_build_object('customerId',v_overdue,'precision','town','town','Mysuru','source','town','expectedVersion',1,'idempotencyKey','accounts-location-town-001'));
  if v_result->'location'->>'version'<>'2' or v_result->'location'->>'town'<>'Mysuru'
    or v_result->'location'->'latitude'<>'null'::jsonb
    or not exists(select 1 from private.stockflow_customer_location_events where customer_id=v_overdue and event_type='moved'
      and old_values->>'precision'='pin' and new_values->>'precision'='town'
      and actor_email='accounts-ops@example.test' and request_id='accounts-location-town-001') then raise exception 'Town update/audit failed'; end if;
  begin
    perform public.stockflow_accounts_gateway('accounts-test-key','accounts-sales@example.test','set_location',v_payload||
      '{"expectedVersion":1,"idempotencyKey":"accounts-location-stale-001"}');
    raise exception 'Stale location allowed';
  exception when sqlstate 'PT409' then null; end;
  for v_bad in select value from jsonb_array_elements(jsonb_build_array(
    '{"latitude":"91"}'::jsonb,'{"longitude":"181"}'::jsonb,'{"latitude":"0","longitude":"0"}'::jsonb,
    '{"latitude":"12.1234567"}'::jsonb,'{"latitude":12}'::jsonb,'{"source":"unknown"}'::jsonb,
    '{"precision":"town","town":"Mysuru","source":"town"}'::jsonb,
    '{"precision":"town","town":"x","latitude":null,"longitude":null,"source":"town"}'::jsonb)) loop
    v_count:=v_count+1;
    begin
      perform public.stockflow_accounts_gateway('accounts-test-key','accounts-sales@example.test','set_location',v_payload||v_bad||
        jsonb_build_object('expectedVersion',2,'idempotencyKey','accounts-invalid-location-'||v_count));
      raise exception 'Invalid location allowed: %',v_bad;
    exception when invalid_parameter_value then null; end;
  end loop;
  begin
    update private.stockflow_customer_location_events set actor_email='changed' where customer_id=v_overdue;
    raise exception 'Location audit edited';
  exception when insufficient_privilege then null; end;

  v_payload:=jsonb_build_object('customerId',v_overdue,'visitedOn',v_today-2,'nextVisitOn',v_today-1,'outcome','met','note','Fixture visit',
    'idempotencyKey','accounts-visit-overdue-001');
  v_result:=public.stockflow_accounts_gateway('accounts-test-key','accounts-sales@example.test','log_visit',v_payload);
  v_visit:=(v_result->>'visitId')::uuid;
  v_replay:=public.stockflow_accounts_gateway('accounts-test-key','accounts-sales@example.test','log_visit',v_payload);
  if v_result is distinct from v_replay or (select count(*) from private.stockflow_customer_visits where customer_id=v_overdue)<>1 then raise exception 'Visit replay duplicated row'; end if;
  begin
    perform public.stockflow_accounts_gateway('accounts-test-key','accounts-sales@example.test','log_visit',v_payload||'{"note":"Changed payload"}');
    raise exception 'Changed replay payload allowed';
  exception when invalid_parameter_value then null; end;
  perform public.stockflow_accounts_gateway('accounts-test-key','accounts-ops@example.test','log_visit',
    jsonb_build_object('customerId',v_oldest,'visitedOn',v_today-30,'outcome','not_available','idempotencyKey','accounts-visit-oldest-001'));
  -- An older backfilled visit cannot replace the latest visit's follow-up.
  perform public.stockflow_accounts_gateway('accounts-test-key','accounts-ops@example.test','log_visit',v_payload||
    jsonb_build_object('visitedOn',v_today-10,'nextVisitOn',v_today+10,'idempotencyKey','accounts-visit-backfill-001'));
  for v_bad in select value from jsonb_array_elements(jsonb_build_array(
    jsonb_build_object('visitedOn',v_today-31),jsonb_build_object('visitedOn',v_today+1),
    jsonb_build_object('nextVisitOn',v_today-2),jsonb_build_object('nextVisitOn',v_today+181),
    '{"visitedOn":"2026-02-30"}'::jsonb,'{"outcome":"bad"}'::jsonb,jsonb_build_object('note',repeat('x',501)))) loop
    v_count:=v_count+1;
    begin
      perform public.stockflow_accounts_gateway('accounts-test-key','accounts-sales@example.test','log_visit',v_payload||v_bad||
        jsonb_build_object('idempotencyKey','accounts-invalid-visit-'||v_count));
      raise exception 'Invalid visit allowed: %',v_bad;
    exception when invalid_parameter_value then null; end;
  end loop;
  begin
    update private.stockflow_customer_visits set note='Edited' where id=v_visit;
    raise exception 'Visit update allowed';
  exception when insufficient_privilege then null; end;
  begin
    delete from private.stockflow_customer_visits where id=v_visit;
    raise exception 'Visit deletion allowed';
  exception when insufficient_privilege then null; end;

  select count(*) into v_before from private.stockflow_command_results;
  v_read:=public.stockflow_accounts_gateway('accounts-test-key','accounts-sales@example.test','get_accounts','{"search":"ACCOUNTS EXACT FIXTURE CITY"}');
  if jsonb_array_length(v_read->'accounts')<>3 or v_read->'accounts'->0->>'id'<>v_overdue::text
    or v_read->'accounts'->1->>'id'<>v_never::text or v_read->'accounts'->2->>'id'<>v_oldest::text then
    raise exception 'Coverage order must be overdue, never visited, oldest visit: %',v_read; end if;
  if v_read->>'today'<>v_today::text or v_read->'page'<>'{"page":1,"pageSize":50,"total":3}'::jsonb
    or v_read->'accounts'->0->>'lastOrderOn'<>v_today::text or v_read->'accounts'->0->>'nextVisitOn'<>(v_today-1)::text
    or v_read->'accounts'->0->'lastVisit'->>'visitedBy'<>'accounts-sales@example.test'
    or v_read->'accounts'->0->'location'->>'verifiedBy'<>'accounts-ops@example.test'
    or v_read->'accounts'->1->'lastVisit'<>'null'::jsonb or v_read->'accounts'->1->'lastOrderOn'<>'null'::jsonb then
    raise exception 'Coverage shape, latest visit or business date incorrect'; end if;
  if not exists(select 1 from jsonb_array_elements(v_read->'owners') v_owner where v_owner->>'email'='accounts-sales@example.test' and v_owner->'name'='null'::jsonb)
    or exists(select 1 from jsonb_array_elements(v_read->'owners') v_owner where v_owner->>'email' in ('accounts-ops@example.test','accounts-inactive@example.test')) then raise exception 'Owner eligibility incorrect'; end if;
  v_read:=public.stockflow_accounts_gateway('accounts-test-key','accounts-sales@example.test','get_accounts','{"search":"Accounts Exact Fixture City","scope":"mine"}');
  if jsonb_array_length(v_read->'accounts')<>2 or exists(select 1 from jsonb_array_elements(v_read->'accounts') v_account where v_account->'owner'->>'email'<>'accounts-sales@example.test') then raise exception 'Mine scope failed'; end if;
  v_read:=public.stockflow_accounts_gateway('accounts-test-key','accounts-ops@example.test','get_accounts',jsonb_build_object('territoryId',v_south,'search','Accounts Exact Fixture City'));
  if jsonb_array_length(v_read->'accounts')<>1 or v_read->'accounts'->0->>'id'<>v_overdue::text then raise exception 'Territory filter failed'; end if;
  v_read:=public.stockflow_accounts_gateway('accounts-test-key','accounts-sales@example.test','get_accounts',jsonb_build_object('ownerEmail','accounts-manager@example.test','search','Accounts Exact Fixture City'));
  if jsonb_array_length(v_read->'accounts')<>1 or v_read->'accounts'->0->>'id'<>v_oldest::text then raise exception 'Owner filter for another reader failed'; end if;
  v_read:=public.stockflow_accounts_gateway('accounts-test-key','accounts-sales@example.test','get_accounts','{"search":"FIXTURE NEVER"}');
  if jsonb_array_length(v_read->'accounts')<>1 or v_read->'accounts'->0->>'id'<>v_never::text then raise exception 'Name search failed'; end if;
  v_read:=public.stockflow_accounts_gateway('accounts-test-key','accounts-sales@example.test','get_accounts','{"search":"Accounts Exact Fixture City","page":2}');
  if jsonb_array_length(v_read->'accounts')<>0 or v_read->'page'->>'total'<>'3' then raise exception 'Page offset/count failed'; end if;
  update private.stockflow_customers set active=false where id=v_never;
  v_read:=public.stockflow_accounts_gateway('accounts-test-key','accounts-sales@example.test','get_accounts','{"search":"Accounts Exact Fixture City"}');
  if jsonb_array_length(v_read->'accounts')<>2 then raise exception 'Inactive customer included'; end if;
  begin
    perform public.stockflow_accounts_gateway('accounts-test-key','accounts-sales@example.test','log_visit',v_payload||jsonb_build_object('customerId',v_never,'idempotencyKey','accounts-inactive-visit-001'));
    raise exception 'Inactive customer mutation allowed';
  exception when invalid_parameter_value then null; end;
  if (select count(*) from private.stockflow_command_results)<>v_before then raise exception 'Read/failed mutation wrote command result'; end if;

  foreach v_table in array array['stockflow_territories','stockflow_customer_assignments','stockflow_customer_locations','stockflow_customer_location_events','stockflow_customer_visits'] loop
    if not (select relrowsecurity from pg_class where oid=('private.'||v_table)::regclass)
      or has_table_privilege('authenticated','private.'||v_table,'SELECT,INSERT,UPDATE,DELETE')
      or has_table_privilege('anon','private.'||v_table,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'Table security incorrect: %',v_table; end if;
    begin
      execute format('delete from private.%I',v_table);
      raise exception 'Business deletion allowed: %',v_table;
    exception when insufficient_privilege then null; end;
  end loop;
  if has_function_privilege('authenticated','public.stockflow_accounts_gateway(text,text,text,jsonb)','EXECUTE')
    or has_function_privilege('anon','public.stockflow_accounts_gateway(text,text,text,jsonb)','EXECUTE')
    or not has_function_privilege('service_role','public.stockflow_accounts_gateway(text,text,text,jsonb)','EXECUTE') then raise exception 'Gateway grants incorrect'; end if;
end $test$;

rollback;
