begin;
insert into public.stockflow_members(email,role,roles,status) values
  ('power-sales@example.test','sales',array['sales'],'active'),
  ('power-manager@example.test','management',array['management'],'active'),
  ('power-admin@example.test','administrator',array['administrator'],'active');
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('power-test-key','sha256'),'hex') where name='orders';

do $test$
declare
  v_customer uuid; v_other uuid; v_contact uuid; v_other_contact uuid; v_removed uuid; v_old_contact uuid; v_visit uuid;
  v_today date:=(now() at time zone 'Asia/Kolkata')::date;
  v_payload jsonb; v_result jsonb; v_first jsonb; v_replay jsonb; v_read jsonb; v_row jsonb; v_actor text; v_value text; v_alert text;
begin
  insert into public.stockflow_snapshots(id,company,fetched_at,payload)
    values('suprabha','POWER MAP TEST',now()::text,'{"customers":[{"tallyKey":"power-main","name":"Power main","city":"Power fixture"},{"tallyKey":"power-other","name":"Power other","city":"Power fixture"},{"tallyKey":"power-old","name":"Power old","city":"Power fixture"}]}'::jsonb)
    on conflict(id) do update set payload=excluded.payload;
  select id into strict v_customer from private.stockflow_customers where tally_key='power-main';
  select id into strict v_other from private.stockflow_customers where tally_key='power-other';
  v_result:=public.stockflow_accounts_gateway('power-test-key','power-sales@example.test','add_contact',
    jsonb_build_object('customerId',v_customer,'name','Unique erased name','businessRole','Unique erased role',
      'phone','919876543210','email','unique-erased@example.test','idempotencyKey','power-contact-add-0001'));
  v_contact:=(v_result->>'contactId')::uuid;
  insert into private.stockflow_account_contacts(customer_id,name,added_by) values(v_other,'Other contact','power-sales@example.test') returning id into v_other_contact;
  insert into private.stockflow_account_contacts(customer_id,name,added_by,removed_at)
    values(v_customer,'Removed contact','power-sales@example.test',now()) returning id into v_removed;
  insert into private.stockflow_account_contacts(customer_id,name,added_by)
    select id,'Old decision maker','power-sales@example.test' from private.stockflow_customers where tally_key='power-old' returning id into v_old_contact;

  v_payload:=jsonb_build_object('contactId',v_contact,'decisionRole','user','stance','neutral','influence','low',
    'reason','Unique erased assessment reason','idempotencyKey','power-assessment-0001');
  begin
    perform public.stockflow_accounts_gateway('power-test-key','power-sales@example.test','set_assessment',v_payload);
    raise exception 'Sales assessment allowed';
  exception when sqlstate '42501' then null; end;
  v_result:=public.stockflow_accounts_gateway('power-test-key','power-manager@example.test','set_assessment',v_payload);
  v_first:=v_result;
  v_replay:=public.stockflow_accounts_gateway('power-test-key','power-manager@example.test','set_assessment',v_payload);
  if v_result is distinct from v_replay or (select count(*) from private.stockflow_contact_assessments where contact_id=v_contact)<>1 then
    raise exception 'Assessment replay appended history'; end if;
  v_read:=public.stockflow_accounts_gateway('power-test-key','power-manager@example.test','get_accounts','{"search":"Power main"}');
  if not (v_read->'accounts'->0->'powerAlerts' ? 'no_decision_maker') then raise exception 'Missing no decision maker alert'; end if;
  v_payload:=v_payload||'{"decisionRole":"decision_maker","stance":"supporter","influence":"high","idempotencyKey":"power-assessment-0002"}'::jsonb;
  perform public.stockflow_accounts_gateway('power-test-key','power-manager@example.test','set_assessment',v_payload);
  foreach v_actor in array array['power-sales@example.test','power-manager@example.test'] loop
    v_read:=public.stockflow_accounts_gateway('power-test-key',v_actor,'get_accounts','{"search":"Power main"}');
    v_row:=v_read->'accounts'->0;
    if v_read->'canSeePowerMap' is distinct from to_jsonb(v_actor='power-manager@example.test') then raise exception 'Incorrect visibility flag'; end if;
    if v_actor='power-sales@example.test' then
      if v_row ? 'powerAlerts' or exists(select 1 from jsonb_array_elements(v_row->'appContacts') k where k ? 'assessment' or k ? 'lastMetOn') then
        raise exception 'Power Map keys leaked to sales'; end if;
    else
      if not (v_row ? 'powerAlerts') or not (v_row->'appContacts'->0 ? 'assessment') or not (v_row->'appContacts'->0 ? 'lastMetOn')
        or v_row->'appContacts'->0->'assessment'->>'decisionRole'<>'decision_maker'
        or v_row->'appContacts'->0->'assessment'->>'stance'<>'supporter'
        or not (v_row->'powerAlerts' ? 'decision_maker_not_met') then raise exception 'Latest assessment or never met alert missing'; end if;
    end if;
  end loop;
  v_payload:=jsonb_build_object('customerId',v_customer,'visitedOn',v_today,'outcome','met','metContactIds',jsonb_build_array(v_contact),'idempotencyKey','power-visit-today-0001');
  v_result:=public.stockflow_accounts_gateway('power-test-key','power-sales@example.test','log_visit',v_payload);
  v_replay:=public.stockflow_accounts_gateway('power-test-key','power-sales@example.test','log_visit',v_payload);
  if v_result is distinct from v_replay or (select count(*) from private.stockflow_visit_contacts where contact_id=v_contact)<>1 then raise exception 'Visit replay duplicated links'; end if;
  v_read:=public.stockflow_accounts_gateway('power-test-key','power-manager@example.test','get_accounts','{"search":"Power main"}');
  if v_read->'accounts'->0->'powerAlerts' ? 'decision_maker_not_met'
    or v_read->'accounts'->0->'appContacts'->0->>'lastMetOn'<>v_today::text then raise exception 'Recent visit did not clear alert'; end if;
  if not (private.stockflow_power_alerts(v_customer,v_today+61) ? 'decision_maker_not_met') then
    raise exception 'Decision maker not met alert did not return after 61 days'; end if;
  v_read:=public.stockflow_accounts_gateway('power-test-key','power-sales@example.test','get_accounts','{"search":"Power main"}');
  if v_read->'accounts'->0->'lastVisit'->'metContacts'->0->>'name'<>'Unique erased name' then raise exception 'Met contact names missing for sales'; end if;
  -- Separate fixture preserves immutable visits while exercising the 61-day boundary.
  insert into private.stockflow_contact_assessments(contact_id,decision_role,stance,influence,actor)
    values(v_old_contact,'decision_maker','neutral','medium','power-manager@example.test');
  insert into private.stockflow_customer_visits(customer_id,visited_on,visited_by,outcome,request_id)
    select customer_id,v_today-61,'power-sales@example.test','met','power-old-visit-0001' from private.stockflow_account_contacts where id=v_old_contact returning id into v_visit;
  insert into private.stockflow_visit_contacts values(v_visit,v_old_contact);
  v_read:=public.stockflow_accounts_gateway('power-test-key','power-manager@example.test','get_accounts','{"search":"Power old"}');
  if not (v_read->'accounts'->0->'powerAlerts' ? 'decision_maker_not_met') then raise exception 'Old visit alert missing'; end if;
  perform public.stockflow_accounts_gateway('power-test-key','power-manager@example.test','set_assessment',
    jsonb_build_object('contactId',v_other_contact,'decisionRole','influencer','stance','sceptical','influence','high','idempotencyKey','power-sceptic-key-0001'));
  foreach v_alert in array array['no_decision_maker','decision_maker_not_met','influential_blocker'] loop
    v_read:=public.stockflow_accounts_gateway('power-test-key','power-manager@example.test','get_accounts',jsonb_build_object('search','Power fixture','alert',v_alert));
    if jsonb_array_length(v_read->'accounts')=0 or exists(select 1 from jsonb_array_elements(v_read->'accounts') k where not (k->'powerAlerts' ? v_alert)) then
      raise exception 'Alert filter incorrect: %',v_alert; end if;
  end loop;
  begin
    perform public.stockflow_accounts_gateway('power-test-key','power-sales@example.test','get_accounts','{"alert":"no_decision_maker"}');
    raise exception 'Sales alert filter allowed';
  exception when sqlstate '42501' then null; end;
  begin
    perform public.stockflow_accounts_gateway('power-test-key','power-manager@example.test','get_accounts','{"alert":"bad"}');
    raise exception 'Invalid alert allowed';
  exception when sqlstate '22023' then null; end;
  foreach v_value in array array[v_other_contact::text,v_removed::text] loop
    begin
      perform public.stockflow_accounts_gateway('power-test-key','power-sales@example.test','log_visit',
        v_payload||jsonb_build_object('metContactIds',jsonb_build_array(v_value),'idempotencyKey','power-bad-visit-'||v_value));
      raise exception 'Invalid met contact allowed';
    exception when sqlstate '22023' then null; end;
  end loop;
  begin
    perform public.stockflow_accounts_gateway('power-test-key','power-manager@example.test','set_assessment',
      jsonb_build_object('contactId',v_removed,'decisionRole','user','stance','neutral','influence','low','idempotencyKey','power-removed-set-0001'));
    raise exception 'Removed contact assessed';
  exception when sqlstate 'PT409' then null; end;
  v_payload:=jsonb_build_object('contactId',v_contact,'reason','Unique erased assessment reason','idempotencyKey','power-erasure-key-0001');
  begin
    perform public.stockflow_accounts_gateway('power-test-key','power-manager@example.test','erase_contact',v_payload);
    raise exception 'Management erasure allowed';
  exception when sqlstate '42501' then null; end;
  v_result:=public.stockflow_accounts_gateway('power-test-key','power-admin@example.test','erase_contact',v_payload);
  v_replay:=public.stockflow_accounts_gateway('power-test-key','power-admin@example.test','erase_contact',v_payload);
  if v_result is distinct from v_replay or (select count(*) from private.stockflow_account_contact_events where contact_id=v_contact and action='erased')<>1 then raise exception 'Erasure replay changed rows'; end if;
  foreach v_value in array array['Unique erased name','Unique erased role','919876543210','unique-erased@example.test','Unique erased assessment reason'] loop
    if exists(select 1 from private.stockflow_account_contacts k where k.id=v_contact and strpos(row_to_json(k)::text,v_value)>0)
      or exists(select 1 from private.stockflow_account_contact_events k where k.contact_id=v_contact and strpos(row_to_json(k)::text,v_value)>0)
      or exists(select 1 from private.stockflow_contact_assessments k where k.contact_id=v_contact and strpos(row_to_json(k)::text,v_value)>0) then
      raise exception 'Personal value survived erasure: %',v_value; end if;
  end loop;
  if not exists(select 1 from private.stockflow_account_contacts where id=v_contact and name='Erased contact' and removed_at is not null and version=2) then raise exception 'Contact erasure incomplete'; end if;
  -- Successful assessment replay remains valid even after contact removal.
  v_payload:=jsonb_build_object('contactId',v_contact,'decisionRole','user','stance','neutral','influence','low',
    'reason','Unique erased assessment reason','idempotencyKey','power-assessment-0001');
  v_result:=public.stockflow_accounts_gateway('power-test-key','power-manager@example.test','set_assessment',v_payload);
  if v_result is distinct from v_first or (select count(*) from private.stockflow_contact_assessments where contact_id=v_contact)<>2 then raise exception 'Replay after removal changed result or appended history'; end if;
  begin
    perform public.stockflow_accounts_gateway('power-test-key','power-manager@example.test','set_assessment',v_payload||'{"idempotencyKey":"power-after-erasure-0001"}'::jsonb);
    raise exception 'Erased contact assessed';
  exception when sqlstate 'PT409' then null; end;
  v_read:=public.stockflow_accounts_gateway('power-test-key','power-sales@example.test','get_accounts','{"search":"Power main"}');
  if v_read->'accounts'->0->'lastVisit'->'metContacts'<>'[]'::jsonb then raise exception 'Erased name visible in visits'; end if;
  begin
    update private.stockflow_contact_assessments set stance='blocker' where contact_id=v_contact;
    raise exception 'Assessment mutation allowed';
  exception when sqlstate '42501' then null; end;
  begin
    delete from private.stockflow_contact_assessments where contact_id=v_contact;
    raise exception 'Assessment deletion allowed';
  exception when sqlstate '42501' then null; end;
  begin
    update private.stockflow_account_contact_events set actor='tampered' where contact_id=v_contact;
    raise exception 'Contact event mutation allowed';
  exception when sqlstate '42501' then null; end;
  begin
    update private.stockflow_visit_contacts set contact_id=v_removed where contact_id=v_contact;
    raise exception 'Visit link mutation allowed';
  exception when sqlstate '42501' then null; end;
  begin
    delete from private.stockflow_visit_contacts where contact_id=v_contact;
    raise exception 'Visit link deletion allowed';
  exception when sqlstate '42501' then null; end;
  if not (select relrowsecurity from pg_class where oid='private.stockflow_contact_assessments'::regclass)
    or not (select relrowsecurity from pg_class where oid='private.stockflow_visit_contacts'::regclass)
    or has_table_privilege('anon','private.stockflow_contact_assessments','SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated','private.stockflow_contact_assessments','SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('anon','private.stockflow_visit_contacts','SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated','private.stockflow_visit_contacts','SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'Power Map privilege boundary incorrect'; end if;
end $test$;
rollback;
