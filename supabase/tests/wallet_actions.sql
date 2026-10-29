begin;
insert into private.stockflow_gateway_config(name,secret_sha256) values('orders',encode(extensions.digest('actions-test-key','sha256'),'hex')) on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,status) values('actions-manager@test.local','management','active'),('actions-owner@test.local','sales','active'),('actions-inactive@test.local','sales','suspended'),('wallet-actions-sales@test.local','sales','active'),('wallet-actions-operations@test.local','operations','active'),('wallet-actions-warehouse@test.local','warehouse','active'),('wallet-actions-billing@test.local','billing','active'),('wallet-actions-accounts@test.local','accounts','active'),('wallet-actions-viewer@test.local','viewer','active') on conflict(email) do update set status=excluded.status;
insert into private.stockflow_customers(id,name,tally_key,created_by_email) values('b2700000-0000-4000-8000-000000000001','Actions Fixture','actions-fixture','test') on conflict(id) do nothing;
insert into private.stockflow_customers(id,name,tally_key,created_by_email) values
 ('b2700000-0000-4000-8000-000000000010','Actions A5 Fixture','actions-a5-fixture','test'),
 ('b2700000-0000-4000-8000-000000000011','Actions Due Today','actions-due-today','test'),
 ('b2700000-0000-4000-8000-000000000012','Actions Due Three','actions-due-three','test'),
 ('b2700000-0000-4000-8000-000000000013','Actions Due Twenty','actions-due-twenty','test'),
 ('b2700000-0000-4000-8000-000000000014','Actions Closed Due','actions-closed-due','test') on conflict(id) do nothing;
create function pg_temp.action_call(p_action text,p_payload jsonb,p_actor text default 'actions-manager@test.local') returns jsonb language sql as $$ select public.stockflow_action_gateway('actions-test-key',p_actor,p_action,p_payload) $$;
create function pg_temp.action_error(p_action text,p_payload jsonb,p_expected text,p_actor text default 'actions-manager@test.local') returns void language plpgsql as $$
begin begin perform pg_temp.action_call(p_action,p_payload,p_actor); exception when others then if sqlstate=p_expected then return;end if;raise;end; raise exception 'Expected SQLSTATE %',p_expected;end$$;
do $checks$
declare opp uuid; a5_opportunity_uuid uuid; due_today_opportunity_uuid uuid; due_three_opportunity_uuid uuid; due_twenty_opportunity_uuid uuid; closed_due_opportunity_uuid uuid;
 fixture_action_uuid uuid; due_today_action_uuid uuid; due_three_action_uuid uuid; due_twenty_action_uuid uuid; closed_due_action_uuid uuid;
 output jsonb; current_id uuid; role_name text; action_name text; denied boolean; due_output jsonb; due_row jsonb; due_today_position int; due_three_position int;
 fixture_today date:=(now() at time zone 'Asia/Kolkata')::date; fixture_due_today_count int; fixture_overdue_count int;
begin
 output:=public.stockflow_opportunity_gateway('actions-test-key','actions-manager@test.local','open_opportunity',jsonb_build_object('requestId','wallet-actions-a-open','customerId','b2700000-0000-4000-8000-000000000001','kind','capture','reason','Action fixture account')); opp:=(output->>'id')::uuid;
 output:=pg_temp.action_call('create_action',jsonb_build_object('requestId','wallet-actions-a-create','opportunityId',opp,'actionType','visit','detail','Visit the laboratory','ownerEmail','ACTIONS-OWNER@test.local','dueOn',(now() at time zone 'Asia/Kolkata')::date+3,'expectedMonthlyGainPaise',10000)); fixture_action_uuid:=(output->>'id')::uuid;
 -- A1 both immutable tables reject updates and deletes.
 begin
  update private.stockflow_commercial_actions set detail=detail where id=fixture_action_uuid;
  raise exception 'A1 update admitted';
 exception when others then
  if sqlerrm like '% admitted' then raise; end if;
 end;
 begin
  delete from private.stockflow_commercial_actions where id=fixture_action_uuid;
  raise exception 'A1 delete admitted';
 exception when others then
  if sqlerrm like '% admitted' then raise; end if;
 end;
 perform pg_temp.action_error('create_action',jsonb_build_object('requestId','wallet-actions-a-conflict','opportunityId',opp,'actionType','demo','detail','Demonstrate the product','ownerEmail','actions-owner@test.local','dueOn',(now() at time zone 'Asia/Kolkata')::date,'expectedMonthlyGainPaise',null),'PT409');
 -- Close first action, which is verified below through a unique request.
 perform pg_temp.action_call('close_action',jsonb_build_object('requestId','wallet-actions-a-close','actionId',fixture_action_uuid,'result','done','note','Visit completed'));
 begin
  update private.stockflow_commercial_action_results set note=note where action_id=fixture_action_uuid;
  raise exception 'A1 result update admitted';
 exception when others then
  if sqlerrm like '% admitted' then raise; end if;
 end;
 begin
  delete from private.stockflow_commercial_action_results where action_id=fixture_action_uuid;
  raise exception 'A1 result delete admitted';
 exception when others then
  if sqlerrm like '% admitted' then raise; end if;
 end;
 perform pg_temp.action_error('close_action',jsonb_build_object('requestId','wallet-actions-a-close-twice','actionId',fixture_action_uuid,'result','done','note','Second close attempt'),'PT409');
 -- A4 dates and owners are validated while no action is open.
 perform pg_temp.action_error('create_action',jsonb_build_object('requestId','wallet-actions-a-past','opportunityId',opp,'actionType','visit','detail','Past due check','ownerEmail','actions-owner@test.local','dueOn',fixture_today-1,'expectedMonthlyGainPaise',null)::jsonb,'22023');
 perform pg_temp.action_error('create_action',jsonb_build_object('requestId','wallet-actions-a-far-future','opportunityId',opp,'actionType','visit','detail','Far future check','ownerEmail','actions-owner@test.local','dueOn',fixture_today+181,'expectedMonthlyGainPaise',null)::jsonb,'22023');
 perform pg_temp.action_error('create_action',jsonb_build_object('requestId','wallet-actions-a-inactive','opportunityId',opp,'actionType','visit','detail','Inactive owner check','ownerEmail','actions-inactive@test.local','dueOn',fixture_today,'expectedMonthlyGainPaise',null)::jsonb,'22023');
 perform pg_temp.action_error('create_action',jsonb_build_object('requestId','wallet-actions-a-unknown-owner','opportunityId',opp,'actionType','visit','detail','Unknown owner check','ownerEmail','nobody@test.local','dueOn',fixture_today,'expectedMonthlyGainPaise',null)::jsonb,'22023');
 -- A3 proven price constraint is required. Constraint payloads use the diagnosis gateway contract.
 perform pg_temp.action_error('create_action',jsonb_build_object('requestId','wallet-actions-a-price-none','opportunityId',opp,'actionType','price_review','detail','Review competitor price','ownerEmail','actions-owner@test.local','dueOn',(now() at time zone 'Asia/Kolkata')::date,'expectedMonthlyGainPaise',null),'22023');
 perform public.stockflow_opportunity_gateway('actions-test-key','actions-manager@test.local','record_constraint',jsonb_build_object('requestId','wallet-actions-a-price-document','opportunityId',opp,'category','price','evidence','Competitor quote is documented','source','document','sourcePerson',null,'observedOn',(now() at time zone 'Asia/Kolkata')::date,'facts','{"competitor":"Acme Lab","product":"Glucose kit","competitorPricePaise":120000,"ourPricePaise":140000}'::jsonb,'expectedCurrentConstraintId',null));
 output:=pg_temp.action_call('create_action',jsonb_build_object('requestId','wallet-actions-a-price-good','opportunityId',opp,'actionType','price_review','detail','Review competitor price','ownerEmail','actions-owner@test.local','dueOn',(now() at time zone 'Asia/Kolkata')::date,'expectedMonthlyGainPaise',null));
 perform pg_temp.action_call('close_action',jsonb_build_object('requestId','wallet-actions-a-close-price','actionId',(output->>'id')::uuid,'result','dropped','note','Review no longer needed')::jsonb);
 -- A5 closure is blocked by the opportunity gateway while its fixture action is open.
 output:=public.stockflow_opportunity_gateway('actions-test-key','actions-manager@test.local','open_opportunity',jsonb_build_object('requestId','wallet-actions-a5-open-opportunity','customerId','b2700000-0000-4000-8000-000000000010','kind','capture','reason','A5 close guard fixture')::jsonb);
 a5_opportunity_uuid:=(output->>'id')::uuid;
 output:=pg_temp.action_call('create_action',jsonb_build_object('requestId','wallet-actions-a5-create-action','opportunityId',a5_opportunity_uuid,'actionType','visit','detail','Visit A5 fixture account','ownerEmail','actions-owner@test.local','dueOn',fixture_today,'expectedMonthlyGainPaise',null)::jsonb);
 fixture_action_uuid:=(output->>'id')::uuid;
 begin
  perform public.stockflow_opportunity_gateway('actions-test-key','actions-manager@test.local','close_opportunity',jsonb_build_object('requestId','wallet-actions-a5-block-close','opportunityId',a5_opportunity_uuid,'outcome','lost','reason','Close attempt with open action')::jsonb);
  raise exception 'A5 close admitted';
 exception when others then
  if sqlerrm like '%A5 close admitted' then raise; end if;
  if sqlstate<>'22023' or position('Close the open action first' in sqlerrm)=0 then raise exception 'A5 expected 22023 Close the open action first, got % %',sqlstate,sqlerrm; end if;
 end;
 fixture_action_uuid:=(output->>'id')::uuid;
 perform pg_temp.action_call('close_action',jsonb_build_object('requestId','wallet-actions-a5-close-action','actionId',fixture_action_uuid,'result','dropped','note','Close A5 fixture action')::jsonb);
 perform public.stockflow_opportunity_gateway('actions-test-key','actions-manager@test.local','close_opportunity',jsonb_build_object('requestId','wallet-actions-a5-close-opportunity','opportunityId',a5_opportunity_uuid,'outcome','lost','reason','A5 fixture closed after action')::jsonb);
 -- A6 fixture rows use separate opportunities so each opportunity has at most one open action.
 output:=public.stockflow_opportunity_gateway('actions-test-key','actions-manager@test.local','open_opportunity',jsonb_build_object('requestId','wallet-actions-a6-open-today','customerId','b2700000-0000-4000-8000-000000000011','kind','capture','reason','A6 due today fixture')::jsonb);
 due_today_opportunity_uuid:=(output->>'id')::uuid;
 output:=pg_temp.action_call('create_action',jsonb_build_object('requestId','wallet-actions-a6-create-today','opportunityId',due_today_opportunity_uuid,'actionType','visit','detail','A6 action due today','ownerEmail','actions-owner@test.local','dueOn',fixture_today,'expectedMonthlyGainPaise',null)::jsonb);
 due_today_action_uuid:=(output->>'id')::uuid;
 output:=public.stockflow_opportunity_gateway('actions-test-key','actions-manager@test.local','open_opportunity',jsonb_build_object('requestId','wallet-actions-a6-open-three','customerId','b2700000-0000-4000-8000-000000000012','kind','capture','reason','A6 due three fixture')::jsonb);
 due_three_opportunity_uuid:=(output->>'id')::uuid;
 output:=pg_temp.action_call('create_action',jsonb_build_object('requestId','wallet-actions-a6-create-three','opportunityId',due_three_opportunity_uuid,'actionType','demo','detail','A6 action due in three','ownerEmail','actions-owner@test.local','dueOn',fixture_today+3,'expectedMonthlyGainPaise',null)::jsonb);
 due_three_action_uuid:=(output->>'id')::uuid;
 output:=public.stockflow_opportunity_gateway('actions-test-key','actions-manager@test.local','open_opportunity',jsonb_build_object('requestId','wallet-actions-a6-open-twenty','customerId','b2700000-0000-4000-8000-000000000013','kind','capture','reason','A6 due twenty fixture')::jsonb);
 due_twenty_opportunity_uuid:=(output->>'id')::uuid;
 output:=pg_temp.action_call('create_action',jsonb_build_object('requestId','wallet-actions-a6-create-twenty','opportunityId',due_twenty_opportunity_uuid,'actionType','demo','detail','A6 action due in twenty','ownerEmail','actions-owner@test.local','dueOn',fixture_today+20,'expectedMonthlyGainPaise',null)::jsonb);
 due_twenty_action_uuid:=(output->>'id')::uuid;
 output:=public.stockflow_opportunity_gateway('actions-test-key','actions-manager@test.local','open_opportunity',jsonb_build_object('requestId','wallet-actions-a6-open-closed','customerId','b2700000-0000-4000-8000-000000000014','kind','capture','reason','A6 closed action fixture')::jsonb);
 closed_due_opportunity_uuid:=(output->>'id')::uuid;
 output:=pg_temp.action_call('create_action',jsonb_build_object('requestId','wallet-actions-a6-create-closed','opportunityId',closed_due_opportunity_uuid,'actionType','visit','detail','A6 closed action due in one','ownerEmail','actions-owner@test.local','dueOn',fixture_today+1,'expectedMonthlyGainPaise',null)::jsonb);
 closed_due_action_uuid:=(output->>'id')::uuid;
 perform pg_temp.action_call('close_action',jsonb_build_object('requestId','wallet-actions-a6-close-fixture','actionId',closed_due_action_uuid,'result','done','note','A6 closed action fixture')::jsonb);
 due_output:=private.stockflow_actions_due_read(fixture_today+2,1);
 due_today_position:=null; due_three_position:=null; fixture_due_today_count:=0; fixture_overdue_count:=0;
 for due_row in select value from jsonb_array_elements(due_output->'rows') as due_rows(value) loop
  if due_row->>'actionId'=due_today_action_uuid::text then
   fixture_due_today_count:=fixture_due_today_count+1; due_today_position:=fixture_due_today_count;
   if due_row->>'overdue'<>'true' then raise exception 'A6 today fixture must be overdue';end if;
   fixture_overdue_count:=fixture_overdue_count+1;
  elsif due_row->>'actionId'=due_three_action_uuid::text then
   fixture_due_today_count:=fixture_due_today_count+1; due_three_position:=fixture_due_today_count;
   if due_row->>'overdue'<>'false' then raise exception 'A6 day three fixture must not be overdue';end if;
  elsif due_row->>'actionId' in (due_twenty_action_uuid::text,closed_due_action_uuid::text) then
   raise exception 'A6 excluded fixture action appeared: %',due_row->>'actionId';
  end if;
 end loop;
 if due_today_position is null or due_three_position is null or due_today_position>=due_three_position or fixture_overdue_count<>1 then raise exception 'A6 fixture inclusion/order/overdue check failed: %, %, %',due_today_position,due_three_position,fixture_overdue_count;end if;
 -- A7 all excluded roles receive PT403 for each of the five actions.
 foreach role_name in array array['sales','operations','warehouse','billing','accounts','viewer'] loop
  foreach action_name in array array['create_action','close_action','get_actions_due','get_opportunity_actions','get_action_owners'] loop
   denied:=false; begin perform public.stockflow_action_gateway('actions-test-key','wallet-actions-'||role_name||'@test.local',action_name,'{}'); exception when sqlstate 'PT403' then denied:=true;end;
   if not denied then raise exception 'A7 role % admitted to %',role_name,action_name;end if;
  end loop;
 end loop;
 -- A8 same request id returns the original creation receipt.
 output:=pg_temp.action_call('create_action',jsonb_build_object('requestId','wallet-actions-a-replay-same','opportunityId',opp,'actionType','visit','detail','Create replay action','ownerEmail','actions-owner@test.local','dueOn',(now() at time zone 'Asia/Kolkata')::date,'expectedMonthlyGainPaise',null));
 current_id:=(output->>'id')::uuid;
 if output is distinct from pg_temp.action_call('create_action',jsonb_build_object('requestId','wallet-actions-a-replay-same','opportunityId',opp,'actionType','visit','detail','Create replay action','ownerEmail','actions-owner@test.local','dueOn',(now() at time zone 'Asia/Kolkata')::date,'expectedMonthlyGainPaise',null)) or current_id is null then raise exception 'A8 replay mismatch';end if;
 perform pg_temp.action_call('close_action',jsonb_build_object('requestId','wallet-actions-a-close-replay','actionId',current_id,'result','dropped','note','Replay fixture cleanup'));
 perform public.stockflow_opportunity_gateway('actions-test-key','actions-manager@test.local','close_opportunity',jsonb_build_object('requestId','wallet-actions-a-close-opportunity','opportunityId',opp,'outcome','lost','reason','Opportunity closed'));
end$checks$;
rollback;
