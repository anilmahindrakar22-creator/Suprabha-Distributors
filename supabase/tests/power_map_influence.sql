begin;
insert into private.stockflow_gateway_config(name,secret_sha256) values('orders',encode(extensions.digest('power-map-test-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,roles,status) values
 ('power-map-manager@test.local','management',array['management']::text[],'active'),
 ('power-map-admin@test.local','administrator',array['administrator']::text[],'active')
on conflict(email) do update set role=excluded.role,roles=array[excluded.role]::text[],status='active';
insert into private.stockflow_customers(id,name,tally_key,created_by_email) values
 ('b2a00000-0000-4000-8000-000000000001','Influence Fixture One','influence-fixture-1','test'),
 ('b2a00000-0000-4000-8000-000000000002','Influence Fixture Two','influence-fixture-2','test'),
 ('b2a00000-0000-4000-8000-000000000003','Influence Fixture Three','influence-fixture-3','test'),
 ('b2a00000-0000-4000-8000-000000000004','Influence Fixture Four','influence-fixture-4','test'),
 ('b2a00000-0000-4000-8000-000000000005','Influence Fixture Five','influence-fixture-5','test');
create or replace function pg_temp.power_call(p_action text,payload_data jsonb) returns jsonb language sql as $$
 select public.stockflow_accounts_gateway('power-map-test-key','power-map-manager@test.local',p_action,(payload_data)::jsonb);
$$;
do $checks$
declare result_data jsonb; fixture_customer uuid; contact_ids uuid[]; lab_contacts uuid[]; no_supporter_contacts uuid[]; no_dm_contacts uuid[]; contact_item uuid; alert_data jsonb; fixture_index integer:=0; role_keys text[]:=array['power-influence-neutral-0001','power-influence-neutral-0002','power-influence-neutral-0003']; action_key text; fixture_role text; territory_fixture uuid; role_influence_id uuid; incident_link_count bigint; incident_end_count bigint;
begin
 result_data:=pg_temp.power_call('create_territory',jsonb_build_object('idempotencyKey','power-influence-territory-0001','name','Influence Fixture Territory')::jsonb);
 territory_fixture:=(result_data#>>'{territory,id}')::uuid;
 if territory_fixture is null then raise exception 'Territory fixture missing';end if;
 foreach fixture_customer in array array['b2a00000-0000-4000-8000-000000000001'::uuid,'b2a00000-0000-4000-8000-000000000002'::uuid,'b2a00000-0000-4000-8000-000000000003'::uuid,'b2a00000-0000-4000-8000-000000000004'::uuid,'b2a00000-0000-4000-8000-000000000005'::uuid] loop
  perform pg_temp.power_call('assign_account',jsonb_build_object('idempotencyKey','power-influence-assignment-'||right(fixture_customer::text,2)||'-0001','customerId',fixture_customer,'ownerEmail','power-map-manager@test.local','territoryId',territory_fixture,'expectedVersion',(select assignment_row.version from private.stockflow_customer_assignments assignment_row where assignment_row.customer_id=fixture_customer and assignment_row.effective_to is null))::jsonb);
  result_data:=pg_temp.power_call('add_contact',jsonb_build_object('idempotencyKey','power-influence-fixture-add-'||right(fixture_customer::text,2)||'-0001','customerId',fixture_customer,'name','Influence Fixture Person','businessRole','Lab lead','phone',null,'email',null)::jsonb);
  if result_data->>'contactId' is null then raise exception 'contact_ids fixture missing';end if;
  contact_ids:=array_append(contact_ids,(result_data->>'contactId')::uuid);
 end loop;
 foreach contact_item in array contact_ids[1:3] loop
  fixture_index:=fixture_index+1;
  result_data:=pg_temp.power_call('set_assessment',jsonb_build_object('idempotencyKey',role_keys[fixture_index],'contactId',contact_item,'decisionRole','user','stance','neutral','influence','low','reason',null)::jsonb);
  if result_data->>'ok' is distinct from 'true' then raise exception 'P1 assessment did not save';end if;
 end loop;
 for fixture_index in 1..5 loop
  result_data:=pg_temp.power_call('add_contact',jsonb_build_object('idempotencyKey','power-influence-lab-contact-0'||fixture_index,'customerId','b2a00000-0000-4000-8000-000000000001'::uuid,'name','Influence Lab Contact '||fixture_index,'businessRole','Lab stakeholder','phone',null,'email',null)::jsonb);
  if result_data->>'contactId' is null then raise exception 'lab_contacts fixture missing';end if;
  lab_contacts:=array_append(lab_contacts,(result_data->>'contactId')::uuid);
 end loop;
 perform pg_temp.power_call('set_assessment',jsonb_build_object('idempotencyKey','power-influence-lab-assess-01','contactId',lab_contacts[1],'decisionRole','influencer','stance','supporter','influence','high','reason',null)::jsonb);
 perform pg_temp.power_call('set_assessment',jsonb_build_object('idempotencyKey','power-influence-lab-assess-02','contactId',lab_contacts[2],'decisionRole','influencer','stance','neutral','influence','medium','reason',null)::jsonb);
 perform pg_temp.power_call('set_assessment',jsonb_build_object('idempotencyKey','power-influence-lab-assess-03','contactId',lab_contacts[3],'decisionRole','decision_maker','stance','neutral','influence','high','reason',null)::jsonb);
 perform pg_temp.power_call('set_assessment',jsonb_build_object('idempotencyKey','power-influence-lab-assess-04','contactId',lab_contacts[4],'decisionRole','user','stance','neutral','influence','low','reason',null)::jsonb);
 perform pg_temp.power_call('set_assessment',jsonb_build_object('idempotencyKey','power-influence-lab-assess-05','contactId',lab_contacts[5],'decisionRole','gatekeeper','stance','sceptical','influence','low','reason',null)::jsonb);
 begin
  perform pg_temp.power_call('set_assessment',jsonb_build_object('idempotencyKey','power-influence-invalid-role-0001','contactId',lab_contacts[1],'decisionRole','invalid','stance','neutral','influence','low')::jsonb);
  raise exception 'P1 invalid role unexpectedly succeeded' using errcode='P0001';
 exception when others then if sqlstate='P0001' then raise; elsif sqlstate<>'22023' then raise; end if; end;

 for fixture_index in 1..2 loop
  result_data:=pg_temp.power_call('add_contact',jsonb_build_object('idempotencyKey','power-influence-no-supporter-0'||fixture_index,'customerId','b2a00000-0000-4000-8000-000000000003'::uuid,'name','No Supporter Contact '||fixture_index,'businessRole','Lab stakeholder','phone',null,'email',null)::jsonb);
  if result_data->>'contactId' is null then raise exception 'no_supporter_contacts fixture missing';end if;
  no_supporter_contacts:=array_append(no_supporter_contacts,(result_data->>'contactId')::uuid);
 end loop;
 perform pg_temp.power_call('set_assessment',jsonb_build_object('idempotencyKey','power-influence-no-supporter-dm-01','contactId',no_supporter_contacts[2],'decisionRole','decision_maker','stance','neutral','influence','high','reason',null)::jsonb);
 perform pg_temp.power_call('set_assessment',jsonb_build_object('idempotencyKey','power-influence-no-supporter-neutral-01','contactId',no_supporter_contacts[1],'decisionRole','user','stance','neutral','influence','low','reason',null)::jsonb);
 for fixture_index in 1..2 loop
  result_data:=pg_temp.power_call('add_contact',jsonb_build_object('idempotencyKey','power-influence-no-dm-contact-0'||fixture_index,'customerId','b2a00000-0000-4000-8000-000000000002'::uuid,'name','No Decision Maker Contact '||fixture_index,'businessRole','Lab stakeholder','phone',null,'email',null)::jsonb);
  if result_data->>'contactId' is null then raise exception 'no_dm_contacts fixture missing';end if;
  no_dm_contacts:=array_append(no_dm_contacts,(result_data->>'contactId')::uuid);
 end loop;
 perform pg_temp.power_call('set_assessment',jsonb_build_object('idempotencyKey','power-influence-no-dm-supporter-01','contactId',no_dm_contacts[1],'decisionRole','influencer','stance','supporter','influence','high','reason',null)::jsonb);
 perform pg_temp.power_call('set_assessment',jsonb_build_object('idempotencyKey','power-influence-no-dm-neutral-01','contactId',no_dm_contacts[2],'decisionRole','user','stance','neutral','influence','low','reason',null)::jsonb);

 -- I1 immutable history, with only the trigger-driven evidence erasure exception.
 result_data:=public.stockflow_power_map_gateway('power-map-test-key','power-map-manager@test.local','set_influence',jsonb_build_object('requestId','power-influence-i1-link-000001','customerId','b2a00000-0000-4000-8000-000000000001','fromContactId',lab_contacts[1],'toContactId',lab_contacts[3],'strength','medium','evidence','Observed owner listens to champion')::jsonb);
 alert_data:=public.stockflow_power_map_gateway('power-map-test-key','power-map-manager@test.local','end_influence',jsonb_build_object('requestId','power-influence-i1-end-000001','influenceId',result_data->>'id','reason','I1 immutability check')::jsonb);
 if not exists(select 1 from private.stockflow_contact_influences where id=(result_data->>'id')::uuid)
  or not exists(select 1 from private.stockflow_contact_influence_ends where influence_id=(result_data->>'id')::uuid) then raise exception 'I1 end row was not created';end if;
 begin update private.stockflow_contact_influences set strength='low' where id=(result_data->>'id')::uuid; raise exception 'I1 link update unexpectedly succeeded' using errcode='P0001';
 exception when others then if sqlstate='P0001' then raise; elsif sqlstate<>'42501' then raise; end if; end;
 begin update private.stockflow_contact_influence_ends set reason='Tampered reason' where influence_id=(result_data->>'id')::uuid; raise exception 'I1 end update unexpectedly succeeded' using errcode='P0001';
 exception when others then if sqlstate='P0001' then raise; elsif sqlstate<>'42501' then raise; end if; end;
 begin delete from private.stockflow_contact_influences where id=(result_data->>'id')::uuid; raise exception 'I1 link delete unexpectedly succeeded' using errcode='P0001';
 exception when others then if sqlstate='P0001' then raise; elsif sqlstate<>'42501' then raise; end if; end;
 begin delete from private.stockflow_contact_influence_ends where influence_id=(result_data->>'id')::uuid; raise exception 'I1 end delete unexpectedly succeeded' using errcode='P0001';
 exception when others then if sqlstate='P0001' then raise; elsif sqlstate<>'42501' then raise; end if; end;

 -- I2 invalid endpoint cases.
 begin perform public.stockflow_power_map_gateway('power-map-test-key','power-map-manager@test.local','set_influence',jsonb_build_object('requestId','power-influence-i2-self-000001','customerId','b2a00000-0000-4000-8000-000000000001','fromContactId',lab_contacts[1],'toContactId',lab_contacts[1],'strength','strong','evidence','Self link evidence')::jsonb); raise exception 'I2 self link unexpectedly succeeded' using errcode='P0001';
 exception when others then if sqlstate='P0001' then raise; elsif sqlstate<>'22023' then raise; end if; end;
 begin perform public.stockflow_power_map_gateway('power-map-test-key','power-map-manager@test.local','set_influence',jsonb_build_object('requestId','power-influence-i2-other-0001','customerId','b2a00000-0000-4000-8000-000000000001','fromContactId',lab_contacts[1],'toContactId',contact_ids[2],'strength','strong','evidence','Other customer endpoint')::jsonb); raise exception 'I2 other customer unexpectedly succeeded' using errcode='P0001';
 exception when others then if sqlstate='P0001' then raise; elsif sqlstate<>'22023' then raise; end if; end;
 perform pg_temp.power_call('remove_contact',jsonb_build_object('idempotencyKey','power-influence-remove-contact-0001','contactId',lab_contacts[5],'expectedVersion',(select contact_row.version from private.stockflow_account_contacts contact_row where contact_row.id=lab_contacts[5]))::jsonb);
 begin perform public.stockflow_power_map_gateway('power-map-test-key','power-map-manager@test.local','set_influence',jsonb_build_object('requestId','power-influence-i2-removed-0001','customerId','b2a00000-0000-4000-8000-000000000001','fromContactId',lab_contacts[1],'toContactId',lab_contacts[5],'strength','strong','evidence','Removed endpoint test')::jsonb); raise exception 'I2 removed contact unexpectedly succeeded' using errcode='P0001';
 exception when others then if sqlstate='P0001' then raise; elsif sqlstate<>'22023' then raise; end if; end;

 -- I3 replacement produces one current edge; repeated end returns PT409.
 result_data:=public.stockflow_power_map_gateway('power-map-test-key','power-map-manager@test.local','set_influence',jsonb_build_object('requestId','power-influence-i3-first-link-001','customerId','b2a00000-0000-4000-8000-000000000001','fromContactId',lab_contacts[1],'toContactId',lab_contacts[2],'strength','low','evidence','First replacement evidence')::jsonb);
 alert_data:=public.stockflow_power_map_gateway('power-map-test-key','power-map-manager@test.local','set_influence',jsonb_build_object('requestId','power-influence-i3-second-link-01','customerId','b2a00000-0000-4000-8000-000000000001','fromContactId',lab_contacts[1],'toContactId',lab_contacts[2],'strength','strong','evidence','Second replacement evidence')::jsonb);
 if (select count(*) from private.stockflow_contact_influences i left join private.stockflow_contact_influence_ends e on e.influence_id=i.id where i.from_contact_id=lab_contacts[1] and i.to_contact_id=lab_contacts[2] and e.influence_id is null)<>1
  or not exists(select 1 from private.stockflow_contact_influence_ends e join private.stockflow_contact_influences i on i.id=e.influence_id where i.from_contact_id=lab_contacts[1] and i.to_contact_id=lab_contacts[2] and e.reason='Replaced') then raise exception 'I3 replacement failed';end if;
 perform public.stockflow_power_map_gateway('power-map-test-key','power-map-manager@test.local','end_influence',jsonb_build_object('requestId','power-influence-i3-end-first-001','influenceId',alert_data->>'id','reason','No longer current')::jsonb);
 begin perform public.stockflow_power_map_gateway('power-map-test-key','power-map-manager@test.local','end_influence',jsonb_build_object('requestId','power-influence-i3-end-second-01','influenceId',alert_data->>'id','reason','Repeated end request')::jsonb); raise exception 'I3 second end unexpectedly succeeded' using errcode='P0001';
 exception when others then if sqlstate='P0001' then raise; elsif sqlstate<>'PT409' then raise; end if; end;

 -- I4 route uses forward links, prefers fewer hops, and terminates on cycles.
 perform public.stockflow_power_map_gateway('power-map-test-key','power-map-manager@test.local','set_influence',jsonb_build_object('requestId','power-influence-i4-chain-one-0001','customerId','b2a00000-0000-4000-8000-000000000001','fromContactId',lab_contacts[1],'toContactId',lab_contacts[2],'strength','medium','evidence','Champion influences contact')::jsonb);
 perform public.stockflow_power_map_gateway('power-map-test-key','power-map-manager@test.local','set_influence',jsonb_build_object('requestId','power-influence-i4-chain-two-0001','customerId','b2a00000-0000-4000-8000-000000000001','fromContactId',lab_contacts[2],'toContactId',lab_contacts[3],'strength','strong','evidence','Contact influences decider')::jsonb);
 alert_data:=public.stockflow_power_map_gateway('power-map-test-key','power-map-manager@test.local','get_power_map',jsonb_build_object('customerId','b2a00000-0000-4000-8000-000000000001')::jsonb);
 if (select array_agg(step_row.value->>'contactId' order by step_row.ordinality) from jsonb_array_elements(alert_data#>'{route,steps}') with ordinality step_row(value,ordinality)) is distinct from array[lab_contacts[1]::text,lab_contacts[2]::text,lab_contacts[3]::text] then raise exception 'I4 chain route incorrect';end if;
 perform public.stockflow_power_map_gateway('power-map-test-key','power-map-manager@test.local','set_influence',jsonb_build_object('requestId','power-influence-i4-cycle-a-b-001','customerId','b2a00000-0000-4000-8000-000000000001','fromContactId',lab_contacts[1],'toContactId',lab_contacts[3],'strength','strong','evidence','Cycle tie direct option')::jsonb);
 result_data:=public.stockflow_power_map_gateway('power-map-test-key','power-map-manager@test.local','set_influence',jsonb_build_object('requestId','power-influence-i4-cycle-b-a-001','customerId','b2a00000-0000-4000-8000-000000000001','fromContactId',lab_contacts[3],'toContactId',lab_contacts[1],'strength','strong','evidence','Cycle return edge')::jsonb);
 alert_data:=public.stockflow_power_map_gateway('power-map-test-key','power-map-manager@test.local','get_power_map',jsonb_build_object('customerId','b2a00000-0000-4000-8000-000000000001')::jsonb);
 if (select array_agg(step_row.value->>'contactId' order by step_row.ordinality) from jsonb_array_elements(alert_data#>'{route,steps}') with ordinality step_row(value,ordinality)) is distinct from array[lab_contacts[1]::text,lab_contacts[3]::text] then raise exception 'I4 shortest route/cycle handling failed';end if;
 perform public.stockflow_power_map_gateway('power-map-test-key','power-map-manager@test.local','set_influence',jsonb_build_object('requestId','power-influence-i4-no-dm-link-001','customerId','b2a00000-0000-4000-8000-000000000002','fromContactId',no_dm_contacts[1],'toContactId',no_dm_contacts[2],'strength','strong','evidence','No decision maker graph')::jsonb);
 alert_data:=public.stockflow_power_map_gateway('power-map-test-key','power-map-manager@test.local','get_power_map',jsonb_build_object('customerId','b2a00000-0000-4000-8000-000000000002')::jsonb);
 if alert_data->'route' is distinct from 'null'::jsonb then raise exception 'I4 no decision maker should have null route';end if;
 perform public.stockflow_power_map_gateway('power-map-test-key','power-map-manager@test.local','set_influence',jsonb_build_object('requestId','power-influence-i4-no-supporter-link','customerId','b2a00000-0000-4000-8000-000000000003','fromContactId',no_supporter_contacts[1],'toContactId',no_supporter_contacts[2],'strength','medium','evidence','No supporter graph link')::jsonb);
 alert_data:=public.stockflow_power_map_gateway('power-map-test-key','power-map-manager@test.local','get_power_map',jsonb_build_object('customerId','b2a00000-0000-4000-8000-000000000003')::jsonb);
 if alert_data->'route' is distinct from 'null'::jsonb then raise exception 'I4 no supporter should have null route';end if;

 -- I5 unauthorized roles are denied for each action, using an existing current link.
 role_influence_id:=(result_data->>'id')::uuid;
 if not exists(select 1 from private.stockflow_contact_influences i where i.id=role_influence_id and not exists(select 1 from private.stockflow_contact_influence_ends e where e.influence_id=i.id)) then raise exception 'I5 current influence fixture missing';end if;
 insert into public.stockflow_members(email,role,roles,status) values
 ('power-influence-sales@test.local','sales',array['sales']::text[],'active'),('power-influence-operations@test.local','operations',array['operations']::text[],'active'),
 ('power-influence-warehouse@test.local','warehouse',array['warehouse']::text[],'active'),('power-influence-billing@test.local','billing',array['billing']::text[],'active'),('power-influence-accounts@test.local','accounts',array['accounts']::text[],'active'),('power-influence-viewer@test.local','viewer',array['viewer']::text[],'active')
 on conflict(email) do update set role=excluded.role,roles=excluded.roles,status='active';
 foreach action_key in array array['get_power_map','set_influence','end_influence'] loop
  foreach fixture_role in array array['sales','operations','warehouse','billing','accounts','viewer'] loop
   begin
    if action_key='get_power_map' then perform public.stockflow_power_map_gateway('power-map-test-key','power-influence-'||fixture_role||'@test.local',action_key,jsonb_build_object('customerId','b2a00000-0000-4000-8000-000000000001')::jsonb);
    elsif action_key='set_influence' then perform public.stockflow_power_map_gateway('power-map-test-key','power-influence-'||fixture_role||'@test.local',action_key,jsonb_build_object('requestId','power-influence-i5-'||fixture_role||'-set-001','customerId','b2a00000-0000-4000-8000-000000000001','fromContactId',lab_contacts[1],'toContactId',lab_contacts[4],'strength','low','evidence','Role check evidence')::jsonb);
    else perform public.stockflow_power_map_gateway('power-map-test-key','power-influence-'||fixture_role||'@test.local',action_key,jsonb_build_object('requestId','power-influence-i5-'||fixture_role||'-end-001','influenceId',role_influence_id,'reason','Role check reason')::jsonb);end if;
    raise exception 'I5 role unexpectedly succeeded' using errcode='P0001';
   exception when others then if sqlstate='P0001' then raise; elsif sqlstate<>'PT403' then raise;end if;end;
  end loop;
 end loop;

 -- I6 erasure goes through the unchanged accounts gateway and retains edge audit rows.
 perform public.stockflow_power_map_gateway('power-map-test-key','power-map-manager@test.local','set_influence',jsonb_build_object('requestId','power-influence-i6-erasure-link-01','customerId','b2a00000-0000-4000-8000-000000000001','fromContactId',lab_contacts[1],'toContactId',lab_contacts[4],'strength','medium','evidence','Private contact-specific evidence')::jsonb);
 if not exists(select 1 from private.stockflow_contact_influences where from_contact_id=lab_contacts[1])
  or not exists(select 1 from private.stockflow_contact_influences where to_contact_id=lab_contacts[1]) then raise exception 'I6 incoming/outgoing fixtures missing';end if;
 select count(*) into incident_link_count from private.stockflow_contact_influences where from_contact_id=lab_contacts[1] or to_contact_id=lab_contacts[1];
 select count(*) into incident_end_count from private.stockflow_contact_influence_ends e join private.stockflow_contact_influences i on i.id=e.influence_id where i.from_contact_id=lab_contacts[1] or i.to_contact_id=lab_contacts[1];
 result_data:=public.stockflow_accounts_gateway('power-map-test-key','power-map-admin@test.local','erase_contact',jsonb_build_object('contactId',lab_contacts[1],'reason','Privacy erasure request','idempotencyKey','power-influence-i6-erase-contact-01')::jsonb);
 if result_data->>'ok' is distinct from 'true'
  or (select count(*) from private.stockflow_contact_influences where from_contact_id=lab_contacts[1] or to_contact_id=lab_contacts[1])<>incident_link_count
  or (select count(*) from private.stockflow_contact_influence_ends e join private.stockflow_contact_influences i on i.id=e.influence_id where i.from_contact_id=lab_contacts[1] or i.to_contact_id=lab_contacts[1])<>incident_end_count
  or exists(select 1 from private.stockflow_contact_influences where (from_contact_id=lab_contacts[1] or to_contact_id=lab_contacts[1]) and evidence is not null)
  then raise exception 'I6 erasure did not null all evidence and keep audit rows';end if;

 -- I7 replay is identical and writes only one link.
 result_data:=public.stockflow_power_map_gateway('power-map-test-key','power-map-manager@test.local','set_influence',jsonb_build_object('requestId','power-influence-i7-replay-link-001','customerId','b2a00000-0000-4000-8000-000000000001','fromContactId',lab_contacts[2],'toContactId',lab_contacts[4],'strength','low','evidence','Replay evidence assertion')::jsonb);
 alert_data:=public.stockflow_power_map_gateway('power-map-test-key','power-map-manager@test.local','set_influence',jsonb_build_object('requestId','power-influence-i7-replay-link-001','customerId','b2a00000-0000-4000-8000-000000000001','fromContactId',lab_contacts[2],'toContactId',lab_contacts[4],'strength','low','evidence','Replay evidence assertion')::jsonb);
 if result_data->>'id' is null or result_data is distinct from alert_data
  or not exists(select 1 from private.stockflow_contact_influences where id=(result_data->>'id')::uuid and from_contact_id=lab_contacts[2] and to_contact_id=lab_contacts[4])
  or (select count(*) from private.stockflow_contact_influences where from_contact_id=lab_contacts[2] and to_contact_id=lab_contacts[4])<>1 then raise exception 'I7 replay changed result or wrote twice';end if;
end $checks$;
rollback;
