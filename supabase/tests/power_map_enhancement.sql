begin;
insert into private.stockflow_gateway_config(name,secret_sha256) values('orders',encode(extensions.digest('power-map-test-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,status) values('power-map-manager@test.local','management','active')
on conflict(email) do update set role='management',roles=array['management']::text[],status='active';
insert into private.stockflow_customers(id,name,tally_key,created_by_email) values
 ('b2900000-0000-4000-8000-000000000001','Power Fixture One','power-fixture-1','test'),
 ('b2900000-0000-4000-8000-000000000002','Power Fixture Two','power-fixture-2','test'),
 ('b2900000-0000-4000-8000-000000000003','Power Fixture Three','power-fixture-3','test'),
 ('b2900000-0000-4000-8000-000000000004','Power Fixture Four','power-fixture-4','test');
create function pg_temp.power_call(p_action text,payload_data jsonb) returns jsonb language sql as $$
 select public.stockflow_accounts_gateway('power-map-test-key','power-map-manager@test.local',p_action,payload_data||jsonb_build_object('idempotencyKey',payload_data->>'idempotencyKey'));
$$;
do $checks$
declare result_data jsonb; fixture_customer uuid; contact_ids uuid[]; contact_item uuid; alert_data jsonb; fixture_index integer:=0; role_keys text[]:=array['power-role-champion-0001','power-role-champion-0002','power-role-champion-0003']; action_key text; territory_fixture uuid;
begin
 result_data:=pg_temp.power_call('create_territory',jsonb_build_object('idempotencyKey','power-territory-create-0001','name','Power Fixture Territory'));
 territory_fixture:=(result_data#>>'{territory,id}')::uuid;
 foreach fixture_customer in array array['b2900000-0000-4000-8000-000000000001'::uuid,'b2900000-0000-4000-8000-000000000002'::uuid,'b2900000-0000-4000-8000-000000000003'::uuid] loop
  perform pg_temp.power_call('assign_account',jsonb_build_object('idempotencyKey','power-assignment-'||right(fixture_customer::text,2)||'-0001','customerId',fixture_customer,'ownerEmail','power-map-manager@test.local','territoryId',territory_fixture,'expectedVersion',null));
  result_data:=pg_temp.power_call('add_contact',jsonb_build_object('idempotencyKey','power-fixture-add-'||right(fixture_customer::text,2)||'-0001','customerId',fixture_customer,'name','Fixture Person','businessRole','Lab lead','phone',null,'email',null));
  contact_ids:=array_append(contact_ids,(result_data->>'contactId')::uuid);
 end loop;
 foreach contact_item in array contact_ids[1:3] loop
  fixture_index:=fixture_index+1;
  result_data:=pg_temp.power_call('set_assessment',jsonb_build_object('idempotencyKey',role_keys[fixture_index],'contactId',contact_item,'decisionRole','champion','stance','supporter','influence','high','reason',null));
 if result_data->>'ok'<>'true' then raise exception 'P1 assessment did not save'; end if;
 end loop;
 action_key:='power-role-technical-01';
 result_data:=pg_temp.power_call('set_assessment',jsonb_build_object('idempotencyKey',action_key,'contactId',contact_ids[2],'decisionRole','technical_evaluator','stance','neutral','influence','medium','reason',null));
 action_key:='power-role-coach-000001';
 result_data:=pg_temp.power_call('set_assessment',jsonb_build_object('idempotencyKey',action_key,'contactId',contact_ids[3],'decisionRole','coach','stance','supporter','influence','low','reason',null));
 if not exists(select 1 from private.stockflow_contact_assessments assessment_row where assessment_row.contact_id=contact_ids[2] and assessment_row.decision_role='technical_evaluator')
  or not exists(select 1 from private.stockflow_contact_assessments assessment_row where assessment_row.contact_id=contact_ids[3] and assessment_row.decision_role='coach') then raise exception 'P1 roles were not read back'; end if;
 begin
  perform pg_temp.power_call('set_assessment',jsonb_build_object('idempotencyKey','power-invalid-role-0001','contactId',contact_ids[1],'decisionRole','invalid','stance','neutral','influence','low'));
  raise exception 'P1 invalid role unexpectedly succeeded' using errcode='P0001';
 exception when others then if sqlstate='P0001' then raise; elsif sqlstate<>'22023' then raise; end if; end;
 -- Unknown high influence fires and clears after the latest assessment changes.
 perform pg_temp.power_call('set_assessment',jsonb_build_object('idempotencyKey','power-unknown-stance-01','contactId',contact_ids[1],'decisionRole','influencer','stance','unknown','influence','high'));
  alert_data:=private.stockflow_power_alerts((select customer_id from private.stockflow_account_contacts where id=contact_ids[1]),(now() at time zone 'Asia/Kolkata')::date);
 if not alert_data ? 'influential_unknown' then raise exception 'P2 unknown alert missing'; end if;
 perform pg_temp.power_call('set_assessment',jsonb_build_object('idempotencyKey','power-known-stance-001','contactId',contact_ids[1],'decisionRole','influencer','stance','neutral','influence','high'));
 if private.stockflow_power_alerts((select customer_id from private.stockflow_account_contacts where id=contact_ids[1]),(now() at time zone 'Asia/Kolkata')::date) ? 'influential_unknown' then raise exception 'P2 unknown alert did not clear'; end if;
 -- Low-only supporter has no influential supporter; a champion supporter clears it.
 perform pg_temp.power_call('set_assessment',jsonb_build_object('idempotencyKey','power-low-supporter-01','contactId',contact_ids[2],'decisionRole','user','stance','supporter','influence','low'));
 if not private.stockflow_power_alerts((select customer_id from private.stockflow_account_contacts where id=contact_ids[2]),(now() at time zone 'Asia/Kolkata')::date) ? 'no_influential_supporter' then raise exception 'P2 supporter alert missing'; end if;
 perform pg_temp.power_call('set_assessment',jsonb_build_object('idempotencyKey','power-champion-support-01','contactId',contact_ids[2],'decisionRole','champion','stance','supporter','influence','low'));
 if private.stockflow_power_alerts((select customer_id from private.stockflow_account_contacts where id=contact_ids[2]),(now() at time zone 'Asia/Kolkata')::date) ? 'no_influential_supporter' then raise exception 'P2 supporter alert did not clear'; end if;
 if private.stockflow_power_alerts('b2900000-0000-4000-8000-000000000004',(now() at time zone 'Asia/Kolkata')::date) ? 'no_influential_supporter' then raise exception 'P2 empty assessed account alert fired'; end if;
 if (select array_agg(alert_item.value order by alert_item.ordinality) from jsonb_array_elements_text(private.stockflow_power_alerts('b2900000-0000-4000-8000-000000000004',(now() at time zone 'Asia/Kolkata')::date)) with ordinality alert_item(value,ordinality)) is distinct from array['no_decision_maker']::text[] then
  raise exception 'P2 prior alert regression/order unexpected'; end if;
end$checks$;
rollback;
