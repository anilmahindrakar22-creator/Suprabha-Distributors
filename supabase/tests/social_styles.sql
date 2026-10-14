begin;
insert into public.stockflow_members(email,role,roles,status) values
  ('style-owner@example.test','sales',array['sales'],'active'),
  ('style-other@example.test','sales',array['sales'],'active'),
  ('style-manager@example.test','management',array['management'],'active'),
  ('style-admin@example.test','administrator',array['administrator'],'active'),
  ('style-ops@example.test','operations',array['operations'],'active');
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('style-test-key','sha256'),'hex') where name='orders';
do $test$
declare
  v_customer uuid; v_contact uuid; v_removed uuid; v_visit uuid; v_old uuid; v_unmet uuid; v_territory uuid;
  v_today date:=(now() at time zone 'Asia/Kolkata')::date;
  v_payload jsonb; v_first jsonb; v_read jsonb; v_row jsonb; v_style jsonb; v_invalid jsonb;
  v_actor text; v_case text; v_i integer; v_a integer; v_r integer; v_expected text; v_table text;
begin
  insert into public.stockflow_snapshots(id,company,fetched_at,payload)
    values('suprabha','SOCIAL STYLES TEST',now()::text,'{"customers":[{"tallyKey":"style-main","name":"Social Styles main","city":"Style fixture"}]}'::jsonb)
    on conflict(id) do update set payload=excluded.payload;
  select id into strict v_customer from private.stockflow_customers where tally_key='style-main';
  insert into private.stockflow_territories(name,created_by) values('Style territory','style-manager@example.test') returning id into v_territory;
  insert into private.stockflow_customer_assignments(customer_id,owner_email,territory_id,effective_from,version,created_by)
    values(v_customer,'style-owner@example.test',v_territory,v_today,1,'style-manager@example.test');
  insert into private.stockflow_account_contacts(customer_id,name,added_by) values(v_customer,'Style contact','style-owner@example.test') returning id into v_contact;
  v_style:=private.stockflow_contact_style(v_contact);
  if v_style->>'state'<>'not_enough' or v_style->>'observations'<>'0'
    or v_style->'assertiveness'<>'null'::jsonb or v_style->'cues'<>'{}'::jsonb then raise exception 'Empty style incorrect'; end if;
  insert into private.stockflow_account_contacts(customer_id,name,added_by,removed_at) values(v_customer,'Removed','style-owner@example.test',now()) returning id into v_removed;
  v_payload:=jsonb_build_object('customerId',v_customer,'visitedOn',v_today,'outcome','met','metContactIds',jsonb_build_array(v_contact),'idempotencyKey','social-visit-replay-0001');
  v_first:=public.stockflow_accounts_gateway('style-test-key','style-owner@example.test','log_visit',v_payload);
  if v_first is distinct from public.stockflow_accounts_gateway('style-test-key','style-owner@example.test','log_visit',v_payload)
    or not (v_first ? 'visitId') or (select count(*) from private.stockflow_customer_visits where customer_id=v_customer)<>1 then
    raise exception 'Visit id or idempotency missing'; end if;
  v_visit:=(v_first->>'visitId')::uuid;
  v_payload:=jsonb_build_object('contactId',v_contact,'visitId',v_visit,'a',jsonb_build_array(4,4,4,4),'r',jsonb_build_array(1,1,1,1),
    'cues',jsonb_build_array('cost_per_test','cost_per_test','uptime_tat'),'idempotencyKey','social-observation-0001');
  for v_invalid in select value from jsonb_array_elements('[{"a":null},{"a":[1,2,3]},{"r":[1,2,3,4,1]},
    {"a":[1,2,3,5]},{"r":[1,2,3,2.5]},{"a":["1",2,3,4]},{"cues":null},{"cues":["bad"]},{"cues":[null]}]'::jsonb) loop
    begin
      perform public.stockflow_accounts_gateway('style-test-key','style-owner@example.test','record_style_observation',v_payload||v_invalid);
      raise exception 'Invalid ratings or cues accepted: %',v_invalid;
    exception when sqlstate '22023' then null; end;
  end loop;
  v_first:=public.stockflow_accounts_gateway('style-test-key','style-owner@example.test','record_style_observation',v_payload);
  if v_first is distinct from public.stockflow_accounts_gateway('style-test-key','style-owner@example.test','record_style_observation',v_payload) then
    raise exception 'Observation replay changed'; end if;
  begin
    perform public.stockflow_accounts_gateway('style-test-key','style-owner@example.test','record_style_observation',v_payload||'{"idempotencyKey":"social-duplicate-0001"}');
    raise exception 'Duplicate observation allowed';
  exception when sqlstate 'PT409' then if sqlerrm<>'Already rated for this visit' then raise; end if; end;
  begin
    perform public.stockflow_accounts_gateway('style-test-key','style-other@example.test','record_style_observation',v_payload);
    raise exception 'Another visitor rated someone elses visit';
  exception when sqlstate '22023' then null; end;
  v_first:=public.stockflow_accounts_gateway('style-test-key','style-other@example.test','log_visit',
    jsonb_build_object('customerId',v_customer,'visitedOn',v_today,'outcome','met','metContactIds',jsonb_build_array(v_contact),'idempotencyKey','social-other-visit-0001'));
  perform public.stockflow_accounts_gateway('style-test-key','style-other@example.test','record_style_observation',
    v_payload||jsonb_build_object('visitId',v_first->>'visitId'));
  if private.stockflow_contact_style(v_contact)->>'state'<>'not_enough' then raise exception 'Two observations classified'; end if;
  v_first:=public.stockflow_accounts_gateway('style-test-key','style-ops@example.test','log_visit',
    jsonb_build_object('customerId',v_customer,'visitedOn',v_today,'outcome','met','metContactIds',jsonb_build_array(v_contact),'idempotencyKey','social-ops-visit-0001'));
  perform public.stockflow_accounts_gateway('style-test-key','style-ops@example.test','record_style_observation',
    v_payload||jsonb_build_object('visitId',v_first->>'visitId'));
  if private.stockflow_contact_style(v_contact)->>'state'<>'not_enough' then raise exception 'Same-date observations classified'; end if;
  for v_i in 1..2 loop
    insert into private.stockflow_customer_visits(customer_id,visited_on,visited_by,outcome,request_id)
      values(v_customer,v_today-v_i,'style-owner@example.test','met','social-date-visit-000'||v_i) returning id into v_visit;
    insert into private.stockflow_visit_contacts values(v_visit,v_contact);
    perform public.stockflow_accounts_gateway('style-test-key','style-owner@example.test','record_style_observation',
      v_payload||jsonb_build_object('visitId',v_visit,'idempotencyKey','social-date-observation-000'||v_i));
  end loop;
  v_style:=private.stockflow_contact_style(v_contact);
  if v_style->>'state'<>'driving' or v_style->>'computedStyle'<>'driving' or v_style->>'confidence'<>'high'
    or v_style->>'distinctDates'<>'3' or v_style->'cues'->>'cost_per_test'<>'5' then raise exception 'Style summary incorrect: %',v_style; end if;
  insert into private.stockflow_customer_visits(customer_id,visited_on,visited_by,outcome,request_id)
    values(v_customer,v_today-31,'style-owner@example.test','met','social-old-visit-0001') returning id into v_old;
  insert into private.stockflow_visit_contacts values(v_old,v_contact);
  insert into private.stockflow_customer_visits(customer_id,visited_on,visited_by,outcome,request_id,created_at)
    values(v_customer,v_today,'style-owner@example.test','met','social-unmet-visit-0001',clock_timestamp()) returning id into v_unmet;
  foreach v_visit in array array[v_old,v_unmet] loop
    begin
      perform public.stockflow_accounts_gateway('style-test-key','style-owner@example.test','record_style_observation',
        v_payload||jsonb_build_object('visitId',v_visit,'idempotencyKey','social-invalid-visit-'||v_visit));
      raise exception 'Invalid visit rated';
    exception when sqlstate '22023' then if sqlerrm<>'Rate only people you met on a visit in the last 30 days' then raise; end if; end;
  end loop;
  begin
    perform public.stockflow_accounts_gateway('style-test-key','style-owner@example.test','record_style_observation',v_payload||jsonb_build_object('contactId',v_removed,'idempotencyKey','social-removed-contact-0001'));
    raise exception 'Removed contact rated';
  exception when sqlstate 'PT409' then null; end;
  -- Additional observers exercise the bounded management history response.
  insert into private.stockflow_style_observations(contact_id,visit_id,observer,a1,a2,a3,a4,r1,r2,r3,r4)
    select v_contact,(v_payload->>'visitId')::uuid,'fixture-observer-'||i,4,4,4,4,1,1,1,1 from generate_series(1,6) i;
  foreach v_actor in array array['style-owner@example.test','style-other@example.test','style-manager@example.test','style-admin@example.test','style-ops@example.test'] loop
    v_read:=public.stockflow_accounts_gateway('style-test-key',v_actor,'get_accounts','{"search":"Social Styles main"}');
    v_row:=v_read->'accounts'->0;
    if v_read ? 'canSeeStyles' or v_row->'lastVisit'->>'id' is distinct from v_unmet::text
      or v_row->'canSeeStyle' is distinct from to_jsonb(v_actor in ('style-owner@example.test','style-manager@example.test','style-admin@example.test'))
      or (v_row->'appContacts'->0 ? 'style') is distinct from (v_actor in ('style-owner@example.test','style-manager@example.test','style-admin@example.test'))
      or (v_row->'appContacts'->0 ? 'styleObservations') is distinct from (v_actor in ('style-manager@example.test','style-admin@example.test')) then
      raise exception 'Style visibility incorrect for %: %',v_actor,v_row; end if;
    if v_actor in ('style-manager@example.test','style-admin@example.test') then
      if jsonb_array_length(v_row->'appContacts'->0->'styleObservations')<>10
        or v_row->'appContacts'->0->'styleObservations'->0->'a'<>'[4,4,4,4]'::jsonb
        or v_row->'appContacts'->0->'styleObservations'->0->'r'<>'[1,1,1,1]'::jsonb then
        raise exception 'Raw observations shape or limit incorrect'; end if;
    end if;
  end loop;
  v_payload:=jsonb_build_object('contactId',v_contact,'style','amiable','reason','Style contact private evidence','idempotencyKey','social-override-set-0001');
  begin
    perform public.stockflow_accounts_gateway('style-test-key','style-owner@example.test','set_style_override',v_payload);
    raise exception 'Sales override allowed';
  exception when sqlstate '42501' then null; end;
  v_first:=public.stockflow_accounts_gateway('style-test-key','style-manager@example.test','set_style_override',v_payload);
  if v_first is distinct from public.stockflow_accounts_gateway('style-test-key','style-manager@example.test','set_style_override',v_payload)
    or private.stockflow_contact_style(v_contact)->'override'->>'style'<>'amiable' then raise exception 'Override missing or replay changed'; end if;
  perform public.stockflow_accounts_gateway('style-test-key','style-manager@example.test','set_style_override',
    v_payload||'{"style":null,"idempotencyKey":"social-override-clear-0001"}');
  if private.stockflow_contact_style(v_contact)->'override'<>'null'::jsonb then raise exception 'Override not cleared'; end if;
  perform public.stockflow_accounts_gateway('style-test-key','style-admin@example.test','erase_contact',
    jsonb_build_object('contactId',v_contact,'reason','Privacy request','idempotencyKey','social-erasure-test-0001'));
  if (select count(*) from private.stockflow_style_observations where contact_id=v_contact)<>11
    or not exists(select 1 from private.stockflow_account_contacts where id=v_contact and removed_at is not null and name='Erased contact') then
    raise exception 'Style history broke contact erasure'; end if;
  if exists(select 1 from private.stockflow_style_overrides where contact_id=v_contact and reason<>'Erased contact') then
    raise exception 'Erasure retained personal style reasons'; end if;

  -- Independent immutable fixtures for quadrants, ties and agreement shares.
  foreach v_case in array array['analytical','driving','expressive','amiable','tie_a','tie_r','tie_both','medium','low','own_tie'] loop
    insert into private.stockflow_account_contacts(customer_id,name,added_by)
      values(v_customer,'Fixture '||v_case,'style-owner@example.test') returning id into v_contact;
    for v_i in 1..(case when v_case in ('medium','low','own_tie') then 5 else 3 end) loop
      insert into private.stockflow_customer_visits(customer_id,visited_on,visited_by,outcome,request_id)
        values(v_customer,v_today-v_i,'style-owner@example.test','met','social-fixture-'||v_case||'-'||v_i) returning id into v_visit;
      v_a:=case when v_case in ('driving','expressive') then 4 else 1 end;
      v_r:=case when v_case in ('amiable','expressive') then 4 else 1 end;
      if v_case='medium' and v_i>3 then v_a:=4; v_r:=4; end if;
      -- 2/5 analytical, 2/5 driving, 1/5 amiable: means (2.2,1.6) => analytical, low.
      if v_case='low' and v_i in (3,4) then v_a:=4; end if;
      if v_case='low' and v_i=5 then v_r:=4; end if;
      -- Own ties count as no match: 3 analytical + 2 ties => 0.6, medium.
      insert into private.stockflow_style_observations(contact_id,visit_id,observer,a1,a2,a3,a4,r1,r2,r3,r4)
        values(v_contact,v_visit,'style-owner@example.test',
          case when v_case in ('tie_a','tie_both') or (v_case='own_tie' and v_i>3) then 2 else v_a end,
          case when v_case in ('tie_a','tie_both') or (v_case='own_tie' and v_i>3) then 2 else v_a end,
          case when v_case in ('tie_a','tie_both') or (v_case='own_tie' and v_i>3) then 3 else v_a end,
          case when v_case in ('tie_a','tie_both') or (v_case='own_tie' and v_i>3) then 3 else v_a end,
          case when v_case in ('tie_r','tie_both') then 2 else v_r end,
          case when v_case in ('tie_r','tie_both') then 2 else v_r end,
          case when v_case in ('tie_r','tie_both') then 3 else v_r end,
          case when v_case in ('tie_r','tie_both') then 3 else v_r end);
    end loop;
    v_style:=private.stockflow_contact_style(v_contact);
    v_expected:=case when v_case like 'tie_%' then 'not_clear' when v_case in ('medium','low','own_tie') then 'analytical' else v_case end;
    if v_style->>'state' is distinct from v_expected
      or (v_case in ('medium','low') and v_style->>'confidence' is distinct from v_case)
      or (v_case='own_tie' and v_style->>'confidence' is distinct from 'medium')
      or (v_case in ('analytical','driving','expressive','amiable') and v_style->>'confidence' is distinct from 'medium')
      or (v_case like 'tie_%' and (v_style->'computedStyle'<>'null'::jsonb or v_style->'confidence'<>'null'::jsonb)) then
      raise exception 'Computation fixture % failed: %',v_case,v_style; end if;
  end loop;
  foreach v_table in array array['stockflow_style_observations','stockflow_style_overrides'] loop
    if not (select relrowsecurity from pg_class where oid=('private.'||v_table)::regclass)
      or has_table_privilege('anon','private.'||v_table,'SELECT,INSERT,UPDATE,DELETE')
      or has_table_privilege('authenticated','private.'||v_table,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'Style table privilege leak'; end if;
    begin
      execute format('delete from private.%I',v_table);
      raise exception 'Style history deletion allowed';
    exception when sqlstate '42501' then null; end;
  end loop;
  begin
    update private.stockflow_style_observations set a1=2;
    raise exception 'Observation mutation allowed';
  exception when sqlstate '42501' then null; end;
  begin
    update private.stockflow_style_overrides set reason='Changed';
    raise exception 'Override mutation allowed';
  exception when sqlstate '42501' then null; end;
end $test$;
rollback;
