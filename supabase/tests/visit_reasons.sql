begin;
set local lock_timeout='60s';
set local statement_timeout='120s';

insert into private.stockflow_gateway_config(name,secret_sha256)
values('orders',encode(extensions.digest('visit-reasons-test-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,roles,status) values
 ('visit-reasons-manager@test.local','management',array['management'],'active'),
 ('visit-reasons-sales@test.local','sales',array['sales'],'active')
on conflict(email) do update set role=excluded.role,roles=excluded.roles,status=excluded.status;
insert into private.stockflow_customers(id,name,tally_key,created_by_email)
values('b2900000-0000-4000-8000-000000000001','Visit Reasons Fixture','visit-reasons-fixture','test');

create function pg_temp.reason_action(p_opp uuid,p_key text,p_type text default 'visit') returns uuid language plpgsql as $$
declare output jsonb;
begin
 output:=public.stockflow_action_gateway('visit-reasons-test-key','visit-reasons-manager@test.local','create_action',
  jsonb_build_object('requestId',p_key,'opportunityId',p_opp,'actionType',p_type,'detail','Visit reasons fixture action',
   'ownerEmail','visit-reasons-sales@test.local','dueOn',(now() at time zone 'Asia/Kolkata')::date+1,'expectedMonthlyGainPaise',null));
 return (output->>'id')::uuid;
end$$;
create function pg_temp.reason_close(p_action uuid,p_key text,p_visit jsonb,p_result text default 'done') returns jsonb language sql as $$
 select public.stockflow_my_actions_gateway('visit-reasons-test-key','visit-reasons-sales@test.local','close_my_action',
  jsonb_build_object('requestId',p_key,'actionId',p_action,'result',p_result,'note','Visit reasons fixture close','visit',p_visit))
$$;
create function pg_temp.reason_rejected(p_action uuid,p_key text,p_reason jsonb,p_result text default 'done',p_message text default 'Invalid visit reason')
returns void language plpgsql as $$
declare visits_before bigint; reasons_before bigint; results_before bigint; rejected boolean:=false;
begin
 select count(*) into visits_before from private.stockflow_customer_visits;
 select count(*) into reasons_before from private.stockflow_visit_reasons;
 select count(*) into results_before from private.stockflow_commercial_action_results;
 begin
  perform pg_temp.reason_close(p_action,p_key,jsonb_build_object('outcome','met','nextVisitOn',null,'reason',p_reason),p_result);
 exception when sqlstate '22023' then
  if sqlerrm<>p_message then raise exception 'Unexpected reason rejection for %: %',p_key,sqlerrm;end if;
  rejected:=true;
 end;
 if not rejected then raise exception 'Expected 22023 for %',p_key;end if;
 if (select count(*) from private.stockflow_customer_visits)<>visits_before
  or (select count(*) from private.stockflow_visit_reasons)<>reasons_before
  or (select count(*) from private.stockflow_commercial_action_results)<>results_before
  or exists(select 1 from private.stockflow_commercial_action_results where action_id=p_action) then
  raise exception 'Rejected reason left a visit, hint or action result for %',p_key;
 end if;
end$$;

do $checks$
declare customer uuid:='b2900000-0000-4000-8000-000000000001'; opp uuid; act uuid; plain_act uuid; invalid_act uuid; demo_act uuid;
 output jsonb; original jsonb; visit uuid; none_visit uuid; old_visit uuid; hints jsonb; expected jsonb;
 visits_before bigint; reasons_before bigint; constraints_before bigint; i int; reason jsonb; denied boolean:=false;
 today date:=(now() at time zone 'Asia/Kolkata')::date;
begin
 output:=public.stockflow_opportunity_gateway('visit-reasons-test-key','visit-reasons-manager@test.local','open_opportunity',
  jsonb_build_object('requestId','visit-reasons-open-0001','customerId',customer,'kind','capture','reason','Visit hints fixture'));
 opp:=(output->>'id')::uuid;
 select count(*) into constraints_before from private.stockflow_commercial_constraints where opportunity_id=opp;
 select count(*) into visits_before from private.stockflow_customer_visits where customer_id=customer;
 select count(*) into reasons_before from private.stockflow_visit_reasons where customer_id=customer;
 act:=pg_temp.reason_action(opp,'visit-reasons-create-0001');
 -- V1: the sales-owned action, visit and hint commit together with actor/account identity.
 original:=pg_temp.reason_close(act,'visit-reasons-close-0001','{"outcome":"met","nextVisitOn":null,"reason":{"category":"price","source":"lab_said"}}');
 visit:=(original->>'visitId')::uuid;
 if visit is null or (select count(*) from private.stockflow_customer_visits where customer_id=customer)<>visits_before+1
  or (select count(*) from private.stockflow_visit_reasons where customer_id=customer)<>reasons_before+1
  or not exists(select 1 from private.stockflow_visit_reasons r join private.stockflow_customer_visits v on v.id=r.visit_id
   where r.visit_id=visit and r.customer_id=customer and v.customer_id=customer and r.category='price'
    and r.source='lab_said' and r.recorded_by='visit-reasons-sales@test.local' and v.visited_by=r.recorded_by) then
  raise exception 'V1 visit hint identity/count mismatch';end if;
 -- V2: outer receipt replay and the underlying accounts receipt both remain idempotent.
 output:=pg_temp.reason_close(act,'visit-reasons-close-0001','{"outcome":"met","nextVisitOn":null,"reason":{"category":"price","source":"lab_said"}}');
 if output is distinct from original or (select count(*) from private.stockflow_visit_reasons where customer_id=customer)<>reasons_before+1
  or (select count(*) from private.stockflow_customer_visits where customer_id=customer)<>visits_before+1 then
  raise exception 'V2 close replay changed receipt or inserted rows';end if;
 output:=public.stockflow_accounts_gateway('visit-reasons-test-key','visit-reasons-sales@test.local','log_visit',
  jsonb_build_object('idempotencyKey','visit-reasons-close-0001:visit','customerId',customer,'visitedOn',today,
   'outcome','met','note','Visit reasons fixture close','nextVisitOn',null,'reason',jsonb_build_object('category','price','source','lab_said')));
 if output->>'visitId' is distinct from visit::text or (select count(*) from private.stockflow_visit_reasons where customer_id=customer)<>reasons_before+1 then
  raise exception 'V2 accounts replay inserted another hint';end if;
 -- V3: the original two-key visit remains supported; explicit JSON null also means no hint.
 plain_act:=pg_temp.reason_action(opp,'visit-reasons-create-0002');
 output:=pg_temp.reason_close(plain_act,'visit-reasons-close-0002','{"outcome":"met","nextVisitOn":null}');
 if not exists(select 1 from private.stockflow_customer_visits where id=(output->>'visitId')::uuid)
  or exists(select 1 from private.stockflow_visit_reasons where visit_id=(output->>'visitId')::uuid) then
  raise exception 'V3 two-key visit was not saved without a hint';end if;
 plain_act:=pg_temp.reason_action(opp,'visit-reasons-create-null');
 output:=pg_temp.reason_close(plain_act,'visit-reasons-close-null','{"outcome":"met","nextVisitOn":null,"reason":null}');
 if not exists(select 1 from private.stockflow_customer_visits where id=(output->>'visitId')::uuid)
  or exists(select 1 from private.stockflow_visit_reasons where visit_id=(output->>'visitId')::uuid) then
  raise exception 'V3 JSON null hint handling failed';end if;
 -- V4: none is explicit, with no attribution.
 act:=pg_temp.reason_action(opp,'visit-reasons-create-0003');
 output:=pg_temp.reason_close(act,'visit-reasons-close-0003','{"outcome":"met","nextVisitOn":null,"reason":{"category":"none","source":null}}');
 none_visit:=(output->>'visitId')::uuid;
 if not exists(select 1 from private.stockflow_visit_reasons where visit_id=none_visit and category='none' and source is null) then
  raise exception 'V4 none hint missing';end if;
 invalid_act:=pg_temp.reason_action(opp,'visit-reasons-create-invalid');
 perform pg_temp.reason_rejected(invalid_act,'visit-reasons-invalid-none','{"category":"none","source":"our_view"}');
 -- V5: every malformed reason is rejected before any durable visit/action result.
 i:=0;
 for reason in select value from jsonb_array_elements('[{"category":"price","source":null},{"category":"clinical","source":"our_view"},{"category":"price","source":"customer_stated"},{"category":"price"},{"category":"price","source":"our_view","extra":1},[],"price",42,true,{}, {"category":null,"source":"our_view"},{"category":"none"}]') loop
  i:=i+1;
  perform pg_temp.reason_rejected(invalid_act,'visit-reasons-invalid-'||i,reason);
 end loop;
 -- V6: preserve the completed-visit-only rule.
 perform pg_temp.reason_rejected(invalid_act,'visit-reasons-invalid-dropped','{"category":"price","source":"our_view"}','dropped','Visit details require a completed visit action');
 -- One open action per opportunity: finish this fixture before creating the demo.
 perform pg_temp.reason_close(invalid_act,'visit-reasons-drop-fixture','null'::jsonb,'dropped');
 demo_act:=pg_temp.reason_action(opp,'visit-reasons-create-demo','demo');
 perform pg_temp.reason_rejected(demo_act,'visit-reasons-invalid-demo','{"category":"price","source":"our_view"}','done','Visit details require a completed visit action');
 -- V7: prove V1/V4 projection first, then prove ordering, the cap and the age window.
 update private.stockflow_visit_reasons set recorded_at=now()-interval '1 minute' where visit_id=visit;
 output:=public.stockflow_opportunity_gateway('visit-reasons-test-key','visit-reasons-manager@test.local','get_account_signals',jsonb_build_object('customerId',customer));
 if output->'visitReasons' is distinct from jsonb_build_array(
  jsonb_build_object('visitedOn',today,'visitedBy','visit-reasons-sales@test.local','category','none','source',null),
  jsonb_build_object('visitedOn',today,'visitedBy','visit-reasons-sales@test.local','category','price','source','lab_said')) then
  raise exception 'V7 initial hints missing, misordered or wrong public shape: %',output->'visitReasons';end if;
 for i in 1..6 loop
  output:=public.stockflow_accounts_gateway('visit-reasons-test-key','visit-reasons-sales@test.local','log_visit',
   jsonb_build_object('idempotencyKey','visit-reasons-signal-'||i,'customerId',customer,'visitedOn',today-(i%3),
    'outcome','met','note','Signal ordering fixture','reason',jsonb_build_object('category',
     (array['portfolio','instrument','service','relationship','credit','availability'])[i],'source','our_view')));
  if i=6 then old_visit:=(output->>'visitId')::uuid;end if;
 end loop;
 update private.stockflow_visit_reasons set recorded_at=now()-interval '181 days' where visit_id=old_visit;
 output:=public.stockflow_opportunity_gateway('visit-reasons-test-key','visit-reasons-manager@test.local','get_account_signals',jsonb_build_object('customerId',customer));
 hints:=output->'visitReasons';
 select jsonb_agg(item order by visited_on desc,recorded_at desc,visit_id desc) into expected from (
  select jsonb_build_object('visitedOn',v.visited_on,'visitedBy',v.visited_by,'category',r.category,'source',r.source) item,
   v.visited_on,r.recorded_at,r.visit_id
  from private.stockflow_visit_reasons r join private.stockflow_customer_visits v on v.id=r.visit_id
  where r.customer_id=customer and r.recorded_at>=now()-interval '180 days'
  order by v.visited_on desc,r.recorded_at desc,r.visit_id desc limit 5
 ) ranked;
 if jsonb_array_length(hints)<>5 or hints is distinct from expected
  or exists(select 1 from jsonb_array_elements(hints) h where h->>'category'='availability') then
  raise exception 'V7 hint cap/window/order failed: %',hints;end if;
 -- The expired row would sort first by date if the age predicate were omitted.
 update private.stockflow_visit_reasons set recorded_at=now()-interval '181 days' where customer_id=customer;
 output:=public.stockflow_opportunity_gateway('visit-reasons-test-key','visit-reasons-manager@test.local','get_account_signals',jsonb_build_object('customerId',customer));
 if output->'visitReasons' is distinct from '[]'::jsonb then raise exception 'V7 expired hints must return []';end if;
 -- V8: sales cannot read management account signals.
 begin
  perform public.stockflow_opportunity_gateway('visit-reasons-test-key','visit-reasons-sales@test.local','get_account_signals',jsonb_build_object('customerId',customer));
 exception when sqlstate 'PT403' then denied:=true;end;
 if not denied then raise exception 'V8 sales admitted to account signals';end if;
 -- V9: hints never become opportunity constraints.
 if (select count(*) from private.stockflow_commercial_constraints where opportunity_id=opp)<>constraints_before then
  raise exception 'V9 visit hints changed commercial constraints';end if;
 raise notice 'PASS visit reasons V1-V9';
end$checks$;
rollback;
