begin;
insert into private.stockflow_gateway_config(name,secret_sha256) values('orders',encode(extensions.digest('actions-test-key','sha256'),'hex')) on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,status) values('actions-manager@test.local','management','active'),('actions-owner@test.local','sales','active'),('actions-inactive@test.local','sales','suspended') on conflict(email) do update set status=excluded.status;
insert into private.stockflow_customers(id,name,tally_key,created_by_email) values('b2700000-0000-4000-8000-000000000001','Actions Fixture','actions-fixture','test') on conflict(id) do nothing;
create function pg_temp.action_call(p_action text,p_payload jsonb,p_actor text default 'actions-manager@test.local') returns jsonb language sql as $$ select public.stockflow_action_gateway('actions-test-key',p_actor,p_action,p_payload) $$;
create function pg_temp.action_error(p_action text,p_payload jsonb,p_expected text,p_actor text default 'actions-manager@test.local') returns void language plpgsql as $$
begin begin perform pg_temp.action_call(p_action,p_payload,p_actor); exception when others then if sqlstate=p_expected then return;end if;raise;end; raise exception 'Expected SQLSTATE %',p_expected;end$$;
do $checks$
declare opp uuid; second_opp uuid; fixture_action_uuid uuid; output jsonb; current_id uuid; role_name text; action_name text; denied boolean; due_output jsonb;
begin
 output:=public.stockflow_opportunity_gateway('actions-test-key','actions-manager@test.local','open_opportunity',jsonb_build_object('requestId','wallet-actions-a-open','customerId','b2700000-0000-4000-8000-000000000001','kind','capture','reason','Action fixture account')); opp:=(output->>'id')::uuid;
 output:=pg_temp.action_call('create_action',jsonb_build_object('requestId','wallet-actions-a-create','opportunityId',opp,'actionType','visit','detail','Visit the laboratory','ownerEmail','ACTIONS-OWNER@test.local','dueOn',(now() at time zone 'Asia/Kolkata')::date+3,'expectedMonthlyGainPaise',10000)); fixture_action_uuid:=(output->>'id')::uuid;
 -- A1 both immutable tables reject updates and deletes.
 begin update private.stockflow_commercial_actions set detail=detail where id=fixture_action_uuid; raise exception 'A1 update admitted'; exception when raise_exception then if sqlerrm='A1 update admitted' then raise;end if;end;
 begin delete from private.stockflow_commercial_actions where id=fixture_action_uuid; raise exception 'A1 delete admitted'; exception when raise_exception then if sqlerrm='A1 delete admitted' then raise;end if;end;
 perform pg_temp.action_error('create_action',jsonb_build_object('requestId','wallet-actions-a-conflict','opportunityId',opp,'actionType','demo','detail','Demonstrate the product','ownerEmail','actions-owner@test.local','dueOn',(now() at time zone 'Asia/Kolkata')::date,'expectedMonthlyGainPaise',null),'PT409');
 -- Close first action, which is verified below through a unique request.
 perform pg_temp.action_call('close_action',jsonb_build_object('requestId','wallet-actions-a-close','actionId',fixture_action_uuid,'result','done','note','Visit completed'));
 begin update private.stockflow_commercial_action_results set note=note where action_id=fixture_action_uuid; raise exception 'A1 result update admitted'; exception when raise_exception then if sqlerrm='A1 result update admitted' then raise;end if;end;
 begin delete from private.stockflow_commercial_action_results where action_id=fixture_action_uuid; raise exception 'A1 result delete admitted'; exception when raise_exception then if sqlerrm='A1 result delete admitted' then raise;end if;end;
 perform pg_temp.action_error('close_action',jsonb_build_object('requestId','wallet-actions-a-close-twice','actionId',fixture_action_uuid,'result','done','note','Second close attempt'),'PT409');
 -- A3 proven price constraint is required. Constraint payloads use the diagnosis gateway contract.
 perform pg_temp.action_error('create_action',jsonb_build_object('requestId','wallet-actions-a-price-none','opportunityId',opp,'actionType','price_review','detail','Review competitor price','ownerEmail','actions-owner@test.local','dueOn',(now() at time zone 'Asia/Kolkata')::date,'expectedMonthlyGainPaise',null),'22023');
 perform public.stockflow_opportunity_gateway('actions-test-key','actions-manager@test.local','record_constraint',jsonb_build_object('requestId','wallet-actions-a-price-document','opportunityId',opp,'category','price','evidence','Competitor quote is documented','source','document','sourcePerson',null,'observedOn',(now() at time zone 'Asia/Kolkata')::date,'facts','{"competitor":"Acme Lab","product":"Glucose kit","competitorPricePaise":120000,"ourPricePaise":140000}'::jsonb,'expectedCurrentConstraintId',null));
 output:=pg_temp.action_call('create_action',jsonb_build_object('requestId','wallet-actions-a-price-good','opportunityId',opp,'actionType','price_review','detail','Review competitor price','ownerEmail','actions-owner@test.local','dueOn',(now() at time zone 'Asia/Kolkata')::date,'expectedMonthlyGainPaise',null));
 -- A4 date and owner validation.
 perform pg_temp.action_error('create_action',jsonb_build_object('requestId','wallet-actions-a-past','opportunityId',opp,'actionType','visit','detail','Past due check','ownerEmail','actions-owner@test.local','dueOn',(now() at time zone 'Asia/Kolkata')::date-1,'expectedMonthlyGainPaise',null),'22023');
 perform pg_temp.action_error('create_action',jsonb_build_object('requestId','wallet-actions-a-inactive','opportunityId',opp,'actionType','visit','detail','Inactive owner check','ownerEmail','actions-inactive@test.local','dueOn',(now() at time zone 'Asia/Kolkata')::date,'expectedMonthlyGainPaise',null),'22023');
 -- A5 closure is blocked while the price review action remains open.
 perform pg_temp.action_error('close_opportunity',jsonb_build_object('requestId','wallet-actions-a-block-close','opportunityId',opp,'outcome','lost','reason','Close attempt with open action'),'22023');
 fixture_action_uuid:=(output->>'id')::uuid;
 perform pg_temp.action_call('close_action',jsonb_build_object('requestId','wallet-actions-a-close-price','actionId',fixture_action_uuid,'result','dropped','note','Review no longer needed'));
 -- A6 due helper returns rows bounded to fixture opportunity and supplied day.
 due_output:=private.stockflow_actions_due_read((now() at time zone 'Asia/Kolkata')::date+2,1);
 if not (due_output ? 'overdueCount') or not (due_output ? 'rows') then raise exception 'A6 helper shape failure';end if;
 -- A7 all excluded roles receive PT403 for each of the five actions.
 foreach role_name in array array['sales','operations','warehouse','billing','accounts','viewer'] loop
  foreach action_name in array array['create_action','close_action','get_actions_due','get_opportunity_actions','get_action_owners'] loop
   denied:=false; begin perform public.stockflow_action_gateway('actions-test-key','diagnosis-'||role_name||'@test.local',action_name,'{}'); exception when sqlstate 'PT403' then denied:=true;end;
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
