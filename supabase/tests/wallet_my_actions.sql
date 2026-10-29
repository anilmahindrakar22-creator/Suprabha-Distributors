begin;

insert into private.stockflow_gateway_config(name,secret_sha256) values('orders',encode(extensions.digest('actions-test-key','sha256'),'hex')) on conflict(name) do update set secret_sha256=excluded.secret_sha256;

insert into public.stockflow_members(email,role,status) values
 ('my-actions-manager@test.local','management','active'),('my-actions-sales@test.local','sales','active'),
 ('my-actions-other@test.local','sales','active'),('my-actions-operations@test.local','operations','active'),
 ('my-actions-inactive@test.local','sales','suspended'),('diagnosis-warehouse@test.local','warehouse','active'),
 ('diagnosis-billing@test.local','billing','active'),('diagnosis-accounts@test.local','accounts','active'),
 ('diagnosis-viewer@test.local','viewer','active') on conflict(email) do update set role=excluded.role,status=excluded.status;
insert into private.stockflow_customers(id,name,tally_key,created_by_email) values
 ('b2700000-0000-4000-8000-000000000021','My Actions Fixture One','my-actions-fixture-one','test'),
 ('b2700000-0000-4000-8000-000000000022','My Actions Fixture Two','my-actions-fixture-two','test'),
 ('b2700000-0000-4000-8000-000000000023','My Actions Fixture Three','my-actions-fixture-three','test'),
 ('b2700000-0000-4000-8000-000000000024','My Actions Fixture Four','my-actions-fixture-four','test'),
 ('b2700000-0000-4000-8000-000000000025','My Actions Fixture Five','my-actions-fixture-five','test') on conflict(id) do nothing;
create function pg_temp.my_action_call(p_action text,p_payload jsonb,p_actor text default 'my-actions-sales@test.local') returns jsonb language sql as $$
 select public.stockflow_my_actions_gateway('actions-test-key',p_actor,p_action,p_payload)
$$;
create function pg_temp.manager_action_call(p_action text,p_payload jsonb) returns jsonb language sql as $$
 select public.stockflow_action_gateway('actions-test-key','my-actions-manager@test.local',p_action,p_payload)
$$;
create function pg_temp.my_action_error(p_action text,p_payload jsonb,p_expected text,p_message text default null,p_actor text default 'my-actions-sales@test.local') returns void language plpgsql as $$
begin
 begin perform pg_temp.my_action_call(p_action,p_payload,p_actor);
 exception when others then
  if sqlstate=p_expected and (p_message is null or sqlerrm=p_message) then return;end if;
  raise;
 end;
 raise exception 'Expected SQLSTATE %',p_expected;
end$$;
do $checks$
declare opp_one uuid; opp_two uuid; opp_three uuid; opp_four uuid; opp_five uuid; own_first uuid; own_second uuid; other_action uuid; closed_action uuid; visit_action uuid;
 output jsonb; listed jsonb; denied boolean; role_name text; action_name text; retry_result jsonb; expected_keys text[]; visit_id uuid; visit_count int; visit_signals jsonb; fixture_today date:=(now() at time zone 'Asia/Kolkata')::date;
begin
 output:=public.stockflow_opportunity_gateway('actions-test-key','my-actions-manager@test.local','open_opportunity',jsonb_build_object('requestId','wallet-my-actions-open-first-0001','customerId','b2700000-0000-4000-8000-000000000021','kind','capture','reason','Fixture for own actions'))::jsonb;
 opp_one:=(output->>'id')::uuid;
 output:=public.stockflow_opportunity_gateway('actions-test-key','my-actions-manager@test.local','open_opportunity',jsonb_build_object('requestId','wallet-my-actions-open-second-0002','customerId','b2700000-0000-4000-8000-000000000022','kind','defend','reason','Fixture for another owner'))::jsonb;
 opp_two:=(output->>'id')::uuid;
 output:=public.stockflow_opportunity_gateway('actions-test-key','my-actions-manager@test.local','open_opportunity',jsonb_build_object('requestId','wallet-my-actions-open-third-0003','customerId','b2700000-0000-4000-8000-000000000023','kind','recover','reason','Fixture for closed row'))::jsonb;
 opp_three:=(output->>'id')::uuid;
 output:=public.stockflow_opportunity_gateway('actions-test-key','my-actions-manager@test.local','open_opportunity',jsonb_build_object('requestId','wallet-my-actions-open-fourth-0013','customerId','b2700000-0000-4000-8000-000000000024','kind','capture','reason','Second fixture for owner ordering'))::jsonb;
 opp_four:=(output->>'id')::uuid;
 output:=public.stockflow_opportunity_gateway('actions-test-key','my-actions-manager@test.local','open_opportunity',jsonb_build_object('requestId','wallet-my-actions-open-fifth-0017','customerId','b2700000-0000-4000-8000-000000000025','kind','capture','reason','Fixture for visit action'))::jsonb;
 opp_five:=(output->>'id')::uuid;
 output:=public.stockflow_opportunity_gateway('actions-test-key','my-actions-manager@test.local','record_constraint',jsonb_build_object('requestId','wallet-my-actions-constraint-first-0004','opportunityId',opp_one,'category','price','evidence','Competitor price was documented','source','document','sourcePerson',null,'observedOn',(now() at time zone 'Asia/Kolkata')::date,'facts','{"competitor":"Fixture Competitor","product":"Fixture Reagent","competitorPricePaise":120000,"ourPricePaise":140000}'::jsonb,'expectedCurrentConstraintId',null))::jsonb;
 if not (output ? 'id') then raise exception 'Fixture constraint missing';end if;
 output:=pg_temp.manager_action_call('create_action',jsonb_build_object('requestId','wallet-my-actions-create-own-first-0005','opportunityId',opp_one,'actionType','visit','detail','Visit the fixture laboratory','ownerEmail','my-actions-sales@test.local','dueOn',(now() at time zone 'Asia/Kolkata')::date+1,'expectedMonthlyGainPaise',10000)::jsonb);
 own_first:=(output->>'id')::uuid;
 output:=pg_temp.manager_action_call('create_action',jsonb_build_object('requestId','wallet-my-actions-create-other-second-0006','opportunityId',opp_two,'actionType','demo','detail','Demonstrate fixture product','ownerEmail','my-actions-other@test.local','dueOn',(now() at time zone 'Asia/Kolkata')::date+2,'expectedMonthlyGainPaise',20000)::jsonb);
 other_action:=(output->>'id')::uuid;
 output:=pg_temp.manager_action_call('create_action',jsonb_build_object('requestId','wallet-my-actions-create-own-third-0007','opportunityId',opp_three,'actionType','visit','detail','Visit closed fixture action','ownerEmail','my-actions-sales@test.local','dueOn',(now() at time zone 'Asia/Kolkata')::date+3,'expectedMonthlyGainPaise',null)::jsonb);
 closed_action:=(output->>'id')::uuid;
 output:=pg_temp.manager_action_call('create_action',jsonb_build_object('requestId','wallet-my-actions-create-own-fourth-0014','opportunityId',opp_four,'actionType','demo','detail','Demonstrate second fixture','ownerEmail','my-actions-sales@test.local','dueOn',(now() at time zone 'Asia/Kolkata')::date+2,'expectedMonthlyGainPaise',30000)::jsonb);
 own_second:=(output->>'id')::uuid;
 perform pg_temp.manager_action_call('close_action',jsonb_build_object('requestId','wallet-my-actions-close-fixture-0008','actionId',closed_action,'result','done','note','Fixture already closed')::jsonb);
 -- M1 and M4: only the sales owner's open fixtures are returned, sorted by due date, with the exact public contract.
 listed:=private.stockflow_my_actions_read('my-actions-sales@test.local',(now() at time zone 'Asia/Kolkata')::date+2,1);
 if (listed->>'total')::int<>2 or (listed->>'overdueCount')::int<>1 or jsonb_array_length(listed->'rows')<>2 then raise exception 'M1 owner/open filtering failed';end if;
 if listed->'rows'->0->>'actionId'<>own_first::text or listed->'rows'->0->>'customerName'<>'My Actions Fixture One' or listed->'rows'->0->>'constraintCategory'<>'price' or listed->'rows'->0->>'overdue'<>'true' or listed->'rows'->1->>'actionId'<>own_second::text or listed->'rows'->1->>'overdue'<>'false' then raise exception 'M1 order/overdue/constraint failed';end if;
 select array_agg(key order by key) into expected_keys from jsonb_object_keys(listed->'rows'->0) as row_keys(key);
 if expected_keys is distinct from array['actionId','actionType','city','constraintCategory','customerId','customerName','detail','dueOn','overdue']::text[] then raise exception 'M4 row key set mismatch: %',expected_keys;end if;
 -- M2: ownership is opaque, own action closes, and duplicate close is a conflict.
 perform pg_temp.my_action_error('close_my_action',jsonb_build_object('requestId','wallet-my-actions-close-other-error-0009','actionId',other_action,'result','done','note','Attempt other owner fixture')::jsonb,'22023','Action not found');
 retry_result:=pg_temp.my_action_call('close_my_action',jsonb_build_object('requestId','wallet-my-actions-close-own-success-0010','actionId',own_first,'result','done','note','Completed fixture visit')::jsonb);
 if retry_result->>'actionId'<>own_first::text then raise exception 'M2 close result mismatch';end if;
 perform pg_temp.my_action_error('close_my_action',jsonb_build_object('requestId','wallet-my-actions-close-own-twice-0011','actionId',own_first,'result','done','note','Duplicate fixture close')::jsonb,'PT409');
 -- M3 both operations are forbidden for non-member roles; allowed roles pass on fixture-only reads.
 foreach role_name in array array['warehouse','billing','accounts','viewer'] loop
  foreach action_name in array array['get_my_actions','close_my_action'] loop
   denied:=false;
   begin perform public.stockflow_my_actions_gateway('actions-test-key','diagnosis-'||role_name||'@test.local',action_name,'{}'::jsonb);
   exception when sqlstate 'PT403' then denied:=true;end;
   if not denied then raise exception 'M3 role % admitted to %',role_name,action_name;end if;
  end loop;
 end loop;
 if jsonb_typeof(public.stockflow_my_actions_gateway('actions-test-key','my-actions-operations@test.local','get_my_actions','{"page":1}'::jsonb)) is distinct from 'object' then raise exception 'M3 operations denied';end if;
 if jsonb_typeof(public.stockflow_my_actions_gateway('actions-test-key','my-actions-sales@test.local','get_my_actions','{"page":1}'::jsonb)) is distinct from 'object' then raise exception 'M3 sales denied';end if;
 perform pg_temp.my_action_error('close_my_action',jsonb_build_object('requestId','wallet-my-actions-close-ops-owned-0015','actionId',own_first,'result','done','note','Operations access role check')::jsonb,'22023','Action not found','my-actions-operations@test.local');
 denied:=false;begin perform public.stockflow_my_actions_gateway('actions-test-key','my-actions-inactive@test.local','get_my_actions','{"page":1}'::jsonb);exception when sqlstate 'PT403' or sqlstate '42501' then denied:=true;end;
 if not denied then raise exception 'M3 inactive member admitted';end if;
 -- M5 receipt replay preserves the original close result.
 retry_result:=pg_temp.my_action_call('close_my_action',jsonb_build_object('requestId','wallet-my-actions-close-replay-0012','actionId',other_action,'result','dropped','note','Close other fixture as its owner')::jsonb,'my-actions-other@test.local');
 output:=pg_temp.my_action_call('close_my_action',jsonb_build_object('requestId','wallet-my-actions-close-replay-0012','actionId',other_action,'result','dropped','note','Close other fixture as its owner')::jsonb,'my-actions-other@test.local');
 if output is distinct from retry_result then raise exception 'M5 replay mismatch';end if;
 -- M6 management due list excludes the action closed by its owner.
 output:=pg_temp.manager_action_call('get_actions_due',jsonb_build_object('page',1)::jsonb);
 if exists(select 1 from jsonb_array_elements(output->'rows') as action_rows(row_data) where row_data->>'actionId'=own_first::text) then raise exception 'M6 closed action remains due';end if;
 -- M8 visit data is rejected for non-visit actions and dropped visit actions; neither action closes.
 perform pg_temp.my_action_error('close_my_action',jsonb_build_object('requestId','wallet-my-actions-nonvisit-reject-0021','actionId',own_second,'result','done','note','Non-visit action attempt','visit',jsonb_build_object('outcome','met','nextVisitOn',null))::jsonb,'22023');
 perform pg_temp.my_action_error('close_my_action',jsonb_build_object('requestId','wallet-my-actions-dropped-visit-reject-0022','actionId',visit_action,'result','dropped','note','Dropped visit attempt','visit',jsonb_build_object('outcome','met','nextVisitOn',null))::jsonb,'22023');
 if exists(select 1 from private.stockflow_commercial_action_results ar where ar.action_id in (own_second,visit_action)) then raise exception 'M8 rejected visit closed a fixture action';end if;
 -- M9 account gateway rejection must roll back the action close as part of the same transaction.
 begin
  perform pg_temp.my_action_call('close_my_action',jsonb_build_object('requestId','wallet-my-actions-invalid-next-visit-0023','actionId',visit_action,'result','done','note','Invalid next visit date attempt','visit',jsonb_build_object('outcome','met','nextVisitOn',fixture_today::text))::jsonb);
  raise exception 'M9 invalid next visit admitted';
 exception when others then
  if sqlerrm like '% admitted' then raise; end if;
 end;
 if exists(select 1 from private.stockflow_commercial_action_results ar where ar.action_id=visit_action) then raise exception 'M9 rejected visit closed fixture action';end if;
 -- M7 successful close records one account visit and advances the diagnosis signal.
 output:=pg_temp.manager_action_call('create_action',jsonb_build_object('requestId','wallet-my-actions-create-visit-fifth-0018','opportunityId',opp_five,'actionType','visit','detail','Visit fifth fixture laboratory','ownerEmail','my-actions-sales@test.local','dueOn',(now() at time zone 'Asia/Kolkata')::date+5,'expectedMonthlyGainPaise',null)::jsonb);
 visit_action:=(output->>'id')::uuid;
 retry_result:=pg_temp.my_action_call('close_my_action',jsonb_build_object('requestId','wallet-my-actions-visit-success-0024','actionId',visit_action,'result','done','note','Met the laboratory contact','visit',jsonb_build_object('outcome','met','nextVisitOn',(fixture_today+1)::text))::jsonb);
 visit_id:=(retry_result->>'visitId')::uuid;
 if visit_id is null then raise exception 'M7 close result omitted visit id';end if;
 select count(*) into visit_count from private.stockflow_customer_visits v where v.customer_id='b2700000-0000-4000-8000-000000000025' and v.visited_on=fixture_today and v.visited_by='my-actions-sales@test.local';
 if visit_count<>1 or not exists(select 1 from private.stockflow_customer_visits v where v.id=visit_id and v.customer_id='b2700000-0000-4000-8000-000000000025') then raise exception 'M7 expected exactly one actor visit for fixture customer';end if;
 visit_signals:=public.stockflow_opportunity_gateway('actions-test-key','my-actions-manager@test.local','get_account_signals',jsonb_build_object('customerId','b2700000-0000-4000-8000-000000000025')::jsonb);
 if visit_signals->>'lastVisitOn'<>fixture_today::text then raise exception 'M7 account signal did not advance';end if;
 -- M10 close receipt replay returns the original visit result without adding a visit.
 output:=pg_temp.my_action_call('close_my_action',jsonb_build_object('requestId','wallet-my-actions-visit-success-0024','actionId',visit_action,'result','done','note','Met the laboratory contact','visit',jsonb_build_object('outcome','met','nextVisitOn',(fixture_today+1)::text))::jsonb);
 if output is distinct from retry_result then raise exception 'M10 replay changed the close receipt';end if;
 select count(*) into visit_count from private.stockflow_customer_visits v where v.customer_id='b2700000-0000-4000-8000-000000000025' and v.visited_on=fixture_today and v.visited_by='my-actions-sales@test.local';
 if visit_count<>1 then raise exception 'M10 replay inserted another visit';end if;
end$checks$;
rollback;
