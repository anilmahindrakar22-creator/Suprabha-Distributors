-- Fully migrated disposable replay database only. All changes roll back.
-- CDR1-CDR5: contact decision roles, champion stance, inside-information flag.
begin;
set local timezone='Asia/Kolkata';
insert into private.stockflow_gateway_config(name,secret_sha256)
values('orders',encode(extensions.digest('cdr-test-key-20261130','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,roles,status) values('cdr-manager@test.local','management',array['management'],'active')
on conflict(email) do update set role='management',roles=array['management']::text[],status='active';
insert into private.stockflow_customers(id,name,tally_key,created_by_email)
select ('b3000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'CDR Fixture '||n,'cdr-fixture-'||n,'test' from generate_series(1,9) n;

create function pg_temp.cdr_id(p_n int) returns uuid language sql immutable as $$
 select ('b3000000-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid;
$$;
create function pg_temp.cdr_call(p_action text,p_payload jsonb) returns jsonb language sql as $$
 select public.stockflow_accounts_gateway('cdr-test-key-20261130','cdr-manager@test.local',p_action,p_payload);
$$;
create function pg_temp.cdr_power(p_action text,p_payload jsonb) returns jsonb language sql as $$
 select public.stockflow_power_map_gateway('cdr-test-key-20261130','cdr-manager@test.local',p_action,p_payload);
$$;
create function pg_temp.cdr_contact(p_n int,p_name text) returns uuid language plpgsql as $$
begin
 return (pg_temp.cdr_call('add_contact',jsonb_build_object('idempotencyKey','cdr-add-'||extensions.gen_random_uuid(),
  'customerId',pg_temp.cdr_id(p_n),'name',p_name,'businessRole','Lab','phone',null,'email',null))->>'contactId')::uuid;
end$$;
create function pg_temp.cdr_assess(p_contact uuid,p_role text,p_stance text,p_influence text,p_extra jsonb default '{}') returns jsonb language sql as $$
 select pg_temp.cdr_call('set_assessment',jsonb_build_object('idempotencyKey','cdr-assess-'||extensions.gen_random_uuid(),'contactId',p_contact,
  'decisionRole',p_role,'stance',p_stance,'influence',p_influence,'reason',null)||p_extra);
$$;
create function pg_temp.cdr_state(p_contact uuid,p_role text,p_stance text,p_extra jsonb default '{}') returns text language plpgsql as $$
begin
 perform pg_temp.cdr_assess(p_contact,p_role,p_stance,'medium',p_extra);
 return 'ok';
exception when others then return sqlstate;
end$$;
create function pg_temp.cdr_alerts(p_n int) returns jsonb language sql as $$
 select private.stockflow_power_alerts(pg_temp.cdr_id(p_n),(now() at time zone 'Asia/Kolkata')::date);
$$;
create function pg_temp.cdr_meet(p_n int,p_contact uuid) returns void language plpgsql as $$
begin
 perform pg_temp.cdr_call('log_visit',jsonb_build_object('idempotencyKey','cdr-visit-'||extensions.gen_random_uuid(),'customerId',pg_temp.cdr_id(p_n),
  'visitedOn',(now() at time zone 'Asia/Kolkata')::date,'outcome','met','metContactIds',jsonb_build_array(p_contact)));
end$$;
create function pg_temp.cdr_latest(p_contact uuid) returns private.stockflow_contact_assessments language sql as $$
 select a from private.stockflow_contact_assessments a where a.contact_id=p_contact order by a.recorded_at desc,a.id desc limit 1;
$$;

do $checks$
declare
 v_contact uuid; v_rows int; v_pass int; v_latest private.stockflow_contact_assessments; v_case record; v_role text; v_state text; v_data jsonb;
 v_champion uuid; v_approver uuid; v_orderer uuid; v_payments uuid; v_other uuid; v_legacy uuid; v_history uuid; v_before int; v_erased uuid; v_removed uuid;
begin
 -- CDR1: append-only move of every legacy latest role, with original actor and history kept.
 for v_case in select * from (values
   ('decision_maker','final_approver','blocker','blocker',false,false),
   ('technical_evaluator','technical_decider','neutral','neutral',false,false),
   ('influencer','unknown','sceptical','sceptical',false,false),
   ('influencer','unknown','supporter','supporter',true,true),
   ('champion','unknown','supporter','champion',false,false),
   ('coach','unknown','neutral','neutral',false,true)
  ) x(legacy,expected_role,old_stance,expected_stance,old_shares,expected_shares)
 loop
  v_contact:=pg_temp.cdr_contact(1,'Legacy '||v_case.legacy||v_case.old_shares::text);
  insert into private.stockflow_contact_assessments(contact_id,decision_role,stance,influence,reason,actor)
   values(v_contact,'user','neutral','low','older note','cdr-original-actor@test.local');
  insert into private.stockflow_contact_assessments(contact_id,decision_role,stance,influence,reason,actor,shares_inside_info)
   values(v_contact,v_case.legacy,v_case.old_stance,'high','legacy note','cdr-original-actor@test.local',v_case.old_shares);
 end loop;
 v_history:=pg_temp.cdr_contact(1,'Already moved');
 insert into private.stockflow_contact_assessments(contact_id,decision_role,stance,influence,actor)
  values(v_history,'champion','supporter','high','cdr-original-actor@test.local');
 insert into private.stockflow_contact_assessments(contact_id,decision_role,stance,influence,actor)
  values(v_history,'user','neutral','low','cdr-original-actor@test.local');
 v_erased:=pg_temp.cdr_contact(1,'Erased legacy');
 insert into private.stockflow_contact_assessments(contact_id,decision_role,stance,influence,actor)
  values(v_erased,'decision_maker','supporter','high','cdr-original-actor@test.local');
 insert into private.stockflow_account_contact_events(contact_id,action,old_values,new_values,actor,request_id)
  values(v_erased,'erased',null,'{}'::jsonb,'cdr-original-actor@test.local','cdr-erase-'||extensions.gen_random_uuid());
 v_removed:=pg_temp.cdr_contact(1,'Removed legacy');
 insert into private.stockflow_contact_assessments(contact_id,decision_role,stance,influence,actor)
  values(v_removed,'decision_maker','supporter','high','cdr-original-actor@test.local');
 update private.stockflow_account_contacts set removed_at=now(),removed_by='cdr-original-actor@test.local' where id=v_removed;
 select count(*) into v_before from private.stockflow_contact_assessments;

 for v_pass in 1..2 loop
  -- Same statement as the migration; a second run must find nothing left to move.
  insert into private.stockflow_contact_assessments(contact_id,decision_role,stance,influence,reason,actor,shares_inside_info)
  select latest.contact_id,
    case latest.decision_role when 'decision_maker' then 'final_approver' when 'technical_evaluator' then 'technical_decider' else 'unknown' end,
    case when latest.decision_role='champion' then 'champion' else latest.stance end,
    latest.influence,
    'Role list changed 14 Nov 2026',
    latest.actor,
    case when latest.decision_role='coach' then true else latest.shares_inside_info end
  from (
    select distinct on (contact_id) contact_id,decision_role,stance,influence,reason,actor,shares_inside_info
    from private.stockflow_contact_assessments a
    where not exists(select 1 from private.stockflow_account_contact_events e where e.contact_id=a.contact_id and e.action='erased')
    order by contact_id,recorded_at desc,id desc
  ) latest
  where latest.decision_role in ('decision_maker','influencer','champion','technical_evaluator','coach');
  if v_pass=1 and (select count(*) from private.stockflow_contact_assessments)<>v_before+7 then raise exception 'CDR1 moved wrong number of contacts'; end if;
 end loop;
 if (select count(*) from private.stockflow_contact_assessments)<>v_before+7 then raise exception 'CDR1 second run appended rows'; end if;

 for v_case in select c.id,x.* from private.stockflow_account_contacts c
   join (values
    ('decision_maker','false','final_approver','blocker',false),
    ('technical_evaluator','false','technical_decider','neutral',false),
    ('influencer','false','unknown','sceptical',false),
    ('influencer','true','unknown','supporter',true),
    ('champion','false','unknown','champion',false),
    ('coach','false','unknown','neutral',true)
   ) x(legacy,old_shares,expected_role,expected_stance,expected_shares)
   on c.name='Legacy '||x.legacy||x.old_shares where c.customer_id=pg_temp.cdr_id(1)
 loop
  v_latest:=pg_temp.cdr_latest(v_case.id);
  if v_latest.decision_role is distinct from v_case.expected_role or v_latest.stance is distinct from v_case.expected_stance
   or v_latest.shares_inside_info is distinct from v_case.expected_shares or v_latest.influence<>'high'
   or v_latest.actor<>'cdr-original-actor@test.local' or v_latest.reason<>'Role list changed 14 Nov 2026' then
   raise exception 'CDR1 mapping wrong for %: %',v_case.legacy,to_jsonb(v_latest); end if;
  select count(*) into v_rows from private.stockflow_contact_assessments where contact_id=v_case.id;
  if v_rows<>3 or not exists(select 1 from private.stockflow_contact_assessments a where a.contact_id=v_case.id and a.decision_role=v_case.legacy and a.reason='legacy note') then
   raise exception 'CDR1 legacy history not kept for %',v_case.legacy; end if;
 end loop;
 if (select count(*) from private.stockflow_contact_assessments where contact_id=v_erased)<>1 or (pg_temp.cdr_latest(v_erased)).decision_role<>'decision_maker' then raise exception 'CDR1 erased contact was re-copied'; end if;
 if (select count(*) from private.stockflow_contact_assessments where contact_id=v_removed)<>2 or (pg_temp.cdr_latest(v_removed)).decision_role<>'final_approver' then raise exception 'CDR1 removed contact was not moved'; end if;
 if (select count(*) from private.stockflow_contact_assessments where contact_id=v_history)<>2
  or (pg_temp.cdr_latest(v_history)).decision_role<>'user' then raise exception 'CDR1 moved a contact whose latest role was already new'; end if;
 raise notice 'PASS CDR1 legacy roles moved append-only with history, actor and flag';

 -- CDR2: gateway accepts only the new role list, stance champion, and a boolean flag.
 v_contact:=pg_temp.cdr_contact(2,'Gateway contact');
 foreach v_role in array array['final_approver','technical_decider','daily_orderer','purchase_payments','user','gatekeeper','unknown'] loop
  if pg_temp.cdr_state(v_contact,v_role,'neutral')<>'ok' then raise exception 'CDR2 role rejected: %',v_role; end if;
  if (pg_temp.cdr_latest(v_contact)).decision_role<>v_role then raise exception 'CDR2 role not stored: %',v_role; end if;
 end loop;
 foreach v_role in array array['decision_maker','influencer','champion','technical_evaluator','coach','invalid'] loop
  if pg_temp.cdr_state(v_contact,v_role,'neutral')<>'22023' then raise exception 'CDR2 legacy or invalid role accepted: %',v_role; end if;
 end loop;
 if pg_temp.cdr_state(v_contact,'user','champion')<>'ok' or (pg_temp.cdr_latest(v_contact)).stance<>'champion' then raise exception 'CDR2 champion stance rejected'; end if;
 if pg_temp.cdr_state(v_contact,'user','coach')<>'22023' then raise exception 'CDR2 invalid stance accepted'; end if;
 perform pg_temp.cdr_assess(v_contact,'user','neutral','low');
 if (pg_temp.cdr_latest(v_contact)).shares_inside_info then raise exception 'CDR2 absent flag was not false'; end if;
 perform pg_temp.cdr_assess(v_contact,'user','neutral','low','{"sharesInsideInfo":true}');
 if not (pg_temp.cdr_latest(v_contact)).shares_inside_info then raise exception 'CDR2 true flag not stored'; end if;
 perform pg_temp.cdr_assess(v_contact,'user','neutral','low','{"sharesInsideInfo":false}');
 if (pg_temp.cdr_latest(v_contact)).shares_inside_info then raise exception 'CDR2 false flag not stored'; end if;
 foreach v_role in array array['"yes"','1','null','"true"','[]'] loop
  if pg_temp.cdr_state(v_contact,'user','neutral',('{"sharesInsideInfo":'||v_role||'}')::jsonb)<>'22023' then raise exception 'CDR2 non-boolean flag accepted: %',v_role; end if;
 end loop;
 perform pg_temp.cdr_assess(v_contact,'gatekeeper','champion','high','{"sharesInsideInfo":true}');
 v_data:=pg_temp.cdr_call('get_accounts','{"search":"CDR Fixture 2"}');
 if not exists(select 1 from jsonb_array_elements(v_data->'accounts') a,jsonb_array_elements(a->'appContacts') k
   where k->>'id'=v_contact::text and k#>>'{assessment,decisionRole}'='gatekeeper' and k#>>'{assessment,stance}'='champion'
   and k#>>'{assessment,sharesInsideInfo}'='true') then raise exception 'CDR2 accounts read lacks the flag: %',v_data; end if;
 v_data:=pg_temp.cdr_power('get_power_map',jsonb_build_object('customerId',pg_temp.cdr_id(2)));
 if not exists(select 1 from jsonb_array_elements(v_data->'contacts') k
   where k->>'id'=v_contact::text and k->>'decisionRole'='gatekeeper' and k->>'sharesInsideInfo'='true') then raise exception 'CDR2 power map read lacks the flag: %',v_data; end if;
 v_other:=pg_temp.cdr_contact(2,'Unassessed contact');
 v_data:=pg_temp.cdr_power('get_power_map',jsonb_build_object('customerId',pg_temp.cdr_id(2)));
 if not exists(select 1 from jsonb_array_elements(v_data->'contacts') k where k->>'id'=v_other::text and k->>'sharesInsideInfo'='false' and k->>'decisionRole'='unknown') then
  raise exception 'CDR2 unassessed contact flag missing'; end if;
 raise notice 'PASS CDR2 new role list, champion stance and boolean flag validation';

 -- CDR3: the three changed alerts fire and clear; the other two keep their logic.
 v_contact:=pg_temp.cdr_contact(3,'Orderer only');
 perform pg_temp.cdr_assess(v_contact,'daily_orderer','neutral','low');
 if not pg_temp.cdr_alerts(3) ? 'no_decision_maker' then raise exception 'CDR3 no final approver alert missing'; end if;
 insert into private.stockflow_contact_assessments(contact_id,decision_role,stance,influence,actor)
  values(v_contact,'decision_maker','neutral','low','cdr-original-actor@test.local');
 if not pg_temp.cdr_alerts(3) ? 'no_decision_maker' then raise exception 'CDR3 legacy decision maker still counted'; end if;
 perform pg_temp.cdr_assess(v_contact,'final_approver','neutral','low');
 if pg_temp.cdr_alerts(3) ? 'no_decision_maker' then raise exception 'CDR3 final approver did not clear the alert'; end if;

 v_approver:=pg_temp.cdr_contact(4,'Approver'); v_orderer:=pg_temp.cdr_contact(4,'Orderer'); v_payments:=pg_temp.cdr_contact(4,'Payments');
 perform pg_temp.cdr_assess(v_approver,'final_approver','neutral','low');
 perform pg_temp.cdr_assess(v_orderer,'daily_orderer','neutral','low');
 perform pg_temp.cdr_assess(v_payments,'purchase_payments','neutral','low');
 if not pg_temp.cdr_alerts(4) ? 'decision_maker_not_met' then raise exception 'CDR3 not met alert missing'; end if;
 perform pg_temp.cdr_meet(4,v_payments);
 if not pg_temp.cdr_alerts(4) ? 'decision_maker_not_met' then raise exception 'CDR3 purchase and payments meeting cleared the alert'; end if;
 perform pg_temp.cdr_meet(4,v_orderer);
 if pg_temp.cdr_alerts(4) ? 'decision_maker_not_met' then raise exception 'CDR3 daily orderer meeting did not clear the alert'; end if;
 v_contact:=pg_temp.cdr_contact(5,'Only approver');
 perform pg_temp.cdr_assess(v_contact,'final_approver','neutral','low');
 if not pg_temp.cdr_alerts(5) ? 'decision_maker_not_met' then raise exception 'CDR3 approver not met alert missing'; end if;
 perform pg_temp.cdr_meet(5,v_contact);
 if pg_temp.cdr_alerts(5) ? 'decision_maker_not_met' then raise exception 'CDR3 approver meeting did not clear the alert'; end if;
 v_contact:=pg_temp.cdr_contact(6,'Technical only');
 perform pg_temp.cdr_assess(v_contact,'technical_decider','neutral','low');
 if pg_temp.cdr_alerts(6) ? 'decision_maker_not_met' then raise exception 'CDR3 technical decider alone raised not met'; end if;

 v_contact:=pg_temp.cdr_contact(7,'Supporter');
 perform pg_temp.cdr_assess(v_contact,'user','champion','low');
 if not pg_temp.cdr_alerts(7) ? 'no_influential_supporter' then raise exception 'CDR3 low user champion should not count'; end if;
 perform pg_temp.cdr_assess(v_contact,'user','champion','high');
 if pg_temp.cdr_alerts(7) ? 'no_influential_supporter' then raise exception 'CDR3 high influence champion did not clear'; end if;
 perform pg_temp.cdr_assess(v_contact,'user','neutral','high');
 if not pg_temp.cdr_alerts(7) ? 'no_influential_supporter' then raise exception 'CDR3 neutral did not fire'; end if;
 perform pg_temp.cdr_assess(v_contact,'technical_decider','supporter','low');
 if pg_temp.cdr_alerts(7) ? 'no_influential_supporter' then raise exception 'CDR3 technical decider supporter did not clear'; end if;
 perform pg_temp.cdr_assess(v_contact,'final_approver','supporter','low');
 if pg_temp.cdr_alerts(7) ? 'no_influential_supporter' then raise exception 'CDR3 final approver supporter did not clear'; end if;
 perform pg_temp.cdr_assess(v_contact,'final_approver','blocker','high');
 if not pg_temp.cdr_alerts(7) ? 'no_influential_supporter' or not pg_temp.cdr_alerts(7) ? 'influential_blocker' then raise exception 'CDR3 blocker handling changed'; end if;
 perform pg_temp.cdr_assess(v_contact,'user','unknown','high');
 if not pg_temp.cdr_alerts(7) ? 'influential_unknown' then raise exception 'CDR3 unknown stance alert changed'; end if;
 if pg_temp.cdr_alerts(9) is distinct from '["no_decision_maker"]'::jsonb then raise exception 'CDR3 empty account alerts changed: %',pg_temp.cdr_alerts(9); end if;
 raise notice 'PASS CDR3 final approver, orderer-or-approver met and influential supporter alerts';

 -- CDR4: champions count by stance, deciders by final approver.
 v_champion:=pg_temp.cdr_contact(8,'Stance champion');
 perform pg_temp.cdr_assess(v_champion,'user','champion','medium');
 v_other:=pg_temp.cdr_contact(8,'Plain supporter');
 perform pg_temp.cdr_assess(v_other,'unknown','supporter','medium');
 v_legacy:=pg_temp.cdr_contact(8,'Legacy champion role');
 insert into private.stockflow_contact_assessments(contact_id,decision_role,stance,influence,actor)
  values(v_legacy,'champion','supporter','high','cdr-original-actor@test.local');
 v_history:=pg_temp.cdr_contact(8,'Superseded champion role');
 insert into private.stockflow_contact_assessments(contact_id,decision_role,stance,influence,actor)
  values(v_history,'champion','champion','high','cdr-original-actor@test.local');
 perform pg_temp.cdr_assess(v_history,'user','neutral','low');
 v_approver:=pg_temp.cdr_contact(8,'Sheet approver');
 perform pg_temp.cdr_assess(v_approver,'final_approver','neutral','medium','{"sharesInsideInfo":true}');
 v_data:=public.stockflow_customer_map_gateway('cdr-test-key-20261130','cdr-manager@test.local','get_customer_sheet',jsonb_build_object('customerId',pg_temp.cdr_id(8)));
 if v_data#>>'{contacts,total}'<>'5' or v_data#>>'{contacts,champions}'<>'1' or v_data#>>'{decisionMaker,name}'<>'Sheet approver' then
  raise exception 'CDR4 sheet champion or decider count wrong: %',v_data; end if;
 v_data:=public.stockflow_customer_map_gateway('cdr-test-key-20261130','cdr-manager@test.local','get_customer_sheet',jsonb_build_object('customerId',pg_temp.cdr_id(7)));
 if v_data#>>'{decisionMaker,label}' is distinct from 'No decider known' or v_data#>>'{contacts,champions}'<>'0' then
  raise exception 'CDR4 no-champion or no-decider sheet wrong: %',v_data; end if;
 if not exists(select 1 from private.stockflow_customer_map_deciders(array[pg_temp.cdr_id(8)])) or not exists(select 1 from private.stockflow_customer_map_deciders(array[pg_temp.cdr_id(3)])) then
  raise exception 'CDR4 deciders helper missed final approvers'; end if;
 if exists(select 1 from private.stockflow_customer_map_deciders(array[pg_temp.cdr_id(7)])) then raise exception 'CDR4 deciders helper counted a non-approver'; end if;
 raise notice 'PASS CDR4 champions counted by stance and decider by final approver';

 -- CDR5: Power Map route starts at a champion stance and ends at the final approver.
 v_champion:=pg_temp.cdr_contact(9,'Route champion'); v_other:=pg_temp.cdr_contact(9,'Route supporter'); v_approver:=pg_temp.cdr_contact(9,'Route approver');
 perform pg_temp.cdr_assess(v_champion,'user','champion','low','{"sharesInsideInfo":true}');
 perform pg_temp.cdr_assess(v_other,'user','supporter','high');
 perform pg_temp.cdr_assess(v_approver,'final_approver','neutral','medium');
 perform pg_temp.cdr_power('set_influence',jsonb_build_object('requestId','cdr-link-champion-'||extensions.gen_random_uuid(),'customerId',pg_temp.cdr_id(9),
  'fromContactId',v_champion,'toContactId',v_approver,'strength','strong','evidence','Champion reaches approver'));
 perform pg_temp.cdr_power('set_influence',jsonb_build_object('requestId','cdr-link-supporter-'||extensions.gen_random_uuid(),'customerId',pg_temp.cdr_id(9),
  'fromContactId',v_other,'toContactId',v_approver,'strength','strong','evidence','Supporter reaches approver'));
 v_data:=private.stockflow_power_route(pg_temp.cdr_id(9));
 if v_data#>>'{steps,0,name}'<>'Route champion' or v_data#>>'{steps,0,decisionRole}'<>'user' or v_data#>>'{steps,0,stance}'<>'champion'
  or v_data#>>'{steps,1,name}'<>'Route approver' or v_data#>>'{steps,1,decisionRole}'<>'final_approver' then
  raise exception 'CDR5 route wrong: %',v_data; end if;
 raise notice 'PASS CDR5 route from champion stance to final approver';
end
$checks$;
rollback;
