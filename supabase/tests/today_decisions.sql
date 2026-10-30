-- Disposable fully migrated replay database only. All fixture changes roll back.
begin;

-- TODAY-DEC / b2d10000 do not overlap any *_concurrency.sql fixture prefix.
insert into private.stockflow_gateway_config(name,secret_sha256)
values('orders',encode(extensions.digest('today-decisions-test-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,status) values
 ('today-dec-manager@test.local','management','active'),
 ('today-dec-admin@test.local','administrator','active'),
 ('today-dec-sales@test.local','sales','active'),
 ('today-dec-operations@test.local','operations','active');
insert into private.stockflow_customers(id,name,tally_key,city,created_by_email)
select ('b2d10000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'Today Decision Lab '||n,'TODAY-DEC-LAB-'||n,'Pune','today-dec-manager@test.local'
from generate_series(1,30) n;
-- As in requirements_decision_view.sql: isolate the bounded order queue only.
-- No archive gateway exists. The outer rollback restores existing orders.
update private.stockflow_orders set archived_at=now() where archived_at is null;
insert into private.stockflow_pricing_policies(policy_version,minimum_margin_percent,target_margin_percent,
 override_approval_percent,rounding_increment,rounding_rule_version,effective_from,active,created_by_email)
values('today-dec-fixture-policy',20,30,5,1,'today-dec-rounding',
 (now() at time zone 'Asia/Kolkata')::date-30,false,'today-dec-manager@test.local');

create function pg_temp.today_dec_read() returns jsonb language sql as $$
 select public.stockflow_today_gateway('today-decisions-test-key','today-dec-manager@test.local','get_today','{}');
$$;
create function pg_temp.today_dec_id(p_n int) returns uuid language sql immutable as $$
 select ('b2d10000-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid;
$$;
create function pg_temp.today_dec_error(p_payload jsonb,p_state text,
 p_actor text default 'today-dec-manager@test.local',p_key text default 'today-decisions-test-key',
 p_action text default 'get_today') returns void language plpgsql as $$
begin
 begin
  perform public.stockflow_today_gateway(p_key,p_actor,p_action,p_payload);
 exception when others then
  if sqlstate=p_state then return;end if;
  raise;
 end;
 raise exception 'T6 expected SQLSTATE %',p_state;
end$$;

-- Constraints/triggers reviewed: order foundation, fulfilment details, transition
-- guard, pricing engine, customer-first pricing. Status is seeded on INSERT;
-- approved pointers change neither quantity nor status and do not invoke auto-price.
create function pg_temp.today_dec_line(p_order uuid,p_item text,p_rate numeric,
 p_pending boolean default false,p_quantity numeric default 3,p_fulfilled numeric default 1,
 p_exception boolean default true) returns uuid language plpgsql as $$
declare v_line uuid; v_decision uuid; v_since timestamptz;
begin
 insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,base_unit,quantity,fulfilled_quantity)
 values(p_order,p_item,'Today fixture reagent','Nos',p_quantity,p_fulfilled) returning id into v_line;
 if p_rate is null then return v_line;end if;
 select updated_at into v_since from private.stockflow_orders where id=p_order;
 insert into private.stockflow_order_pricing_decisions(order_id,order_line_id,decision_version,order_version,state,
  resolution_type,proposed_rate,approved_rate,source_type,guardrail_state,pricing_policy_id,
  pricing_policy_version,rounding_rule_version,requested_by_email,requested_at,approved_by_email,approved_at,request_id)
 select p_order,v_line,1,1,case when p_pending then 'pending_approval' else 'approved' end,
  'price_exception',p_rate,case when not p_pending then p_rate end,'manual_review','price_ok',id,
  policy_version,rounding_rule_version,'today-dec-manager@test.local',v_since,
  case when not p_pending then 'today-dec-manager@test.local' end,case when not p_pending then now() end,
  'today-dec-pricing-'||v_line from private.stockflow_pricing_policies where policy_version='today-dec-fixture-policy'
 returning id into v_decision;
 if p_pending then
  update private.stockflow_orders set pricing_state='approval_required' where id=p_order;
  update private.stockflow_order_lines set pricing_state='approval_required' where id=v_line;
  if p_exception then
   insert into private.stockflow_price_exceptions(decision_id,order_id,order_line_id,entered_rate,reason,state,requested_by_email,requested_at)
   values(v_decision,p_order,v_line,p_rate,'Today fixture approval','pending','today-dec-manager@test.local',v_since);
  end if;
 else
  update private.stockflow_order_lines set pricing_state='approved',approved_pricing_decision_id=v_decision where id=v_line;
 end if;
 return v_line;
end$$;
create function pg_temp.today_dec_order(p_n int,p_status text,p_age interval,p_rate numeric,
 p_pending boolean default false,p_item text default null) returns uuid language plpgsql as $$
declare v_order uuid:=pg_temp.today_dec_id(100+p_n);
begin
 insert into private.stockflow_orders(id,order_number,customer_id,customer_name,source,status,
  idempotency_key,created_by_email,updated_by_email,created_at,updated_at)
 values(v_order,'TODAY-DEC-ORDER-'||p_n,pg_temp.today_dec_id(1),'Today Order '||p_n,'phone',p_status,
  'today-dec-order-fixture-'||p_n,'today-dec-manager@test.local','today-dec-manager@test.local',now()-p_age,now()-p_age);
 perform pg_temp.today_dec_line(v_order,coalesce(p_item,'TODAY-DEC-ITEM-'||p_n),p_rate,p_pending);
 return v_order;
end$$;
create function pg_temp.today_dec_opportunity(p_n int) returns uuid language plpgsql as $$
declare v_result jsonb;
begin
 v_result:=public.stockflow_opportunity_gateway('today-decisions-test-key','today-dec-manager@test.local','open_opportunity',
  jsonb_build_object('requestId','today-dec-open-opportunity-'||p_n,'customerId',pg_temp.today_dec_id(p_n),
   'kind','capture','reason','Today decision fixture'));
 return (v_result->>'id')::uuid;
end$$;
create function pg_temp.today_dec_wallet(p_n int,p_amount bigint) returns void language plpgsql as $$
begin
 perform public.stockflow_wallet_gateway('today-decisions-test-key','today-dec-manager@test.local','record_wallet_snapshot',
  jsonb_build_object('requestId','today-dec-wallet-snapshot-'||p_n,'customerId',pg_temp.today_dec_id(p_n),
   'monthlyWalletPaise',p_amount,'method','manager_estimate','source','Today fixture estimate','confidence','medium',
   'asOf',(now() at time zone 'Asia/Kolkata')::date,'note','Today fixture estimate','loweredReason',null,
   'divisions','[]'::jsonb,'expectedCurrentSnapshotId',null));
end$$;

do $checks$
declare
 v_today date:=(now() at time zone 'Asia/Kolkata')::date;
 v_start date:=(date_trunc('month',now() at time zone 'Asia/Kolkata')-interval '3 months')::date;
 v_end date:=date_trunc('month',now() at time zone 'Asia/Kolkata')::date;
 v_output jsonb; v_row jsonb; v_wallet jsonb; v_catalog jsonb; v_bad jsonb;
 v_order uuid; v_other uuid; v_line uuid; v_opportunity uuid; v_action uuid; v_focus_opportunity uuid;
 v_i int; v_company text; v_month date; v_months date[]; v_net bigint;
 v_baseline_unblock bigint; v_baseline_grow bigint; v_known_position bigint; v_unknown_position bigint;
 v_expected jsonb; v_actual jsonb; v_gap numeric; v_started timestamptz; v_average_ms numeric;
 v_events bigint; v_commands bigint; v_role text;
begin
 -- T1: Pending inbox predicate and approximate customer-rate value.
 v_order:=pg_temp.today_dec_order(1,'packed',interval '26 hours',250,true);
 perform pg_temp.today_dec_line(v_order,'TODAY-DEC-APPROVED',100,false,2,1);
 v_output:=pg_temp.today_dec_read();
 select value into v_row from jsonb_array_elements(v_output#>'{unblock,rows}')
 where value#>>'{target,orderId}'=v_order::text;
 if v_row->>'type' is distinct from 'approve_price' or (v_row->>'valuePaise')::numeric is distinct from 85000::numeric
  or v_row->>'approximate' is distinct from 'true' or v_row->>'since' is null
  or v_row->>'subtitle' is distinct from '1 lines awaiting price approval'
  then raise exception 'T1 proposed 250*3 plus approved 100*(2-1), in paise: %',v_row;end if;
 -- A pending decision without a pending inbox exception must not appear in U1.
 v_other:=pg_temp.today_dec_order(2,'confirmed',interval '1 hour',null);
 perform pg_temp.today_dec_line(v_other,'TODAY-DEC-NO-EXCEPTION',999,true,3,0,false);
 v_output:=pg_temp.today_dec_read();
 if exists(select 1 from jsonb_array_elements(v_output#>'{unblock,rows}') where value#>>'{target,orderId}'=v_other::text)
  then raise exception 'T1 invented pending predicate';end if;
 perform pg_temp.today_dec_line(v_order,'TODAY-DEC-UNPRICED',null,false,1,0);
 v_output:=pg_temp.today_dec_read();
 select value into v_row from jsonb_array_elements(v_output#>'{unblock,rows}') where value#>>'{target,orderId}'=v_order::text;
 if v_row->'valuePaise' is distinct from 'null'::jsonb then raise exception 'T1 missing remaining rate became a subtotal';end if;
 update private.stockflow_orders set archived_at=now() where id in (v_order,v_other);
 raise notice 'PASS T1: pending approval predicate and approximate proposed value';

 -- T2: Current cumulative coverage, not the historical alert stockAfter.
 v_order:=pg_temp.today_dec_order(3,'confirmed',interval '2 hours',100,false,'TODAY-DEC-STOCK');
 v_other:=pg_temp.today_dec_order(4,'confirmed',interval '1 hour',200,false,'TODAY-DEC-STOCK');
 perform pg_temp.today_dec_line(v_order,'TODAY-DEC-FULFILLED',null,false,1,1);
 insert into private.stockflow_order_events(order_id,event_type,actor_email,actor_role,metadata)
 values(v_order,'stock_increase_reported','today-dec-manager@test.local','management',
  jsonb_build_object('tallyKey','TODAY-DEC-STOCK','itemName','Today stock reagent',
   'stockBefore',0,'stockAfter',10,'catalogSourceAt',now()-interval '1 hour'));
 insert into public.stockflow_snapshots(id,company,fetched_at,payload)
 values('suprabha','TODAY DECISIONS',now()::text,'{"catalog":[{"tallyKey":"TODAY-DEC-STOCK","closing":"3"}]}')
 on conflict(id) do update set payload=excluded.payload;
 v_output:=pg_temp.today_dec_read();
 if exists(select 1 from jsonb_array_elements(v_output#>'{unblock,rows}') where value#>>'{target,itemKey}'='TODAY-DEC-STOCK')
  then raise exception 'T2 partial coverage included';end if;
 update public.stockflow_snapshots set payload='{"catalog":[{"tallyKey":"TODAY-DEC-STOCK","closing":"4"}]}' where id='suprabha';
 v_output:=pg_temp.today_dec_read();
 select value into v_row from jsonb_array_elements(v_output#>'{unblock,rows}') where value#>>'{target,itemKey}'='TODAY-DEC-STOCK';
 if v_row->>'type' is distinct from 'stock_covers' or (v_row->>'valuePaise')::numeric is distinct from 60000::numeric
  or v_row->>'approximate' is distinct from 'false' then raise exception 'T2 complete coverage / remaining approved value: %',v_row;end if;
 -- Compare the fixture's coverage with the real requirements alert gateway.
 v_output:=public.stockflow_stock_alert_gateway('today-decisions-test-key','today-dec-manager@test.local','get_stock_alerts','{"page":1}');
 select value into v_row from jsonb_array_elements(v_output->'alerts') where value->>'tallyKey'='TODAY-DEC-STOCK';
 if v_row->>'waitingOrders' is distinct from '2' or v_row->>'coveredOrders' is distinct from '2'
  then raise exception 'T2 fixture differs from requirements coverage: %',v_row;end if;
 perform pg_temp.today_dec_line(v_other,'TODAY-DEC-STOCK-UNPRICED',null,false,1,0);
 v_output:=pg_temp.today_dec_read();
 select value into v_row from jsonb_array_elements(v_output#>'{unblock,rows}') where value#>>'{target,itemKey}'='TODAY-DEC-STOCK';
 if v_row->'valuePaise' is distinct from 'null'::jsonb then raise exception 'T2 unpriced covered order became a subtotal';end if;
 for v_catalog in select value from jsonb_array_elements('[[],[{"tallyKey":"TODAY-DEC-STOCK","closing":"bad"}],
  [{"tallyKey":"TODAY-DEC-STOCK","closing":"4"},{"tallyKey":"TODAY-DEC-STOCK","closing":"4"}]]'::jsonb) loop
  update public.stockflow_snapshots set payload=jsonb_build_object('catalog',v_catalog) where id='suprabha';
  v_output:=pg_temp.today_dec_read();
  if exists(select 1 from jsonb_array_elements(v_output#>'{unblock,rows}') where value#>>'{target,itemKey}'='TODAY-DEC-STOCK')
   then raise exception 'T2 missing, malformed or duplicate stock fabricated coverage';end if;
 end loop;
 v_line:=pg_temp.today_dec_order(5,'confirmed',interval '2 hours',100,false,'TODAY-DEC-OLD-STOCK');
 insert into private.stockflow_order_events(order_id,event_type,actor_email,actor_role,metadata,created_at)
 values(v_line,'stock_increase_reported','today-dec-manager@test.local','management',
  jsonb_build_object('tallyKey','TODAY-DEC-OLD-STOCK','itemName','Today old reagent','stockBefore',0,'stockAfter',9,
   'catalogSourceAt',now()-interval '8 days'),now()-interval '8 days');
 update public.stockflow_snapshots set payload='{"catalog":[{"tallyKey":"TODAY-DEC-OLD-STOCK","closing":"9"}]}' where id='suprabha';
 v_output:=pg_temp.today_dec_read();
 if exists(select 1 from jsonb_array_elements(v_output#>'{unblock,rows}') where value#>>'{target,itemKey}'='TODAY-DEC-OLD-STOCK')
  then raise exception 'T2 expired alert included';end if;
 update private.stockflow_orders set archived_at=now() where id in (v_order,v_other,v_line);
 raise notice 'PASS T2: complete current stock coverage and unknown order values';

 -- T3: Both urgent-exception states, both fulfilment states, exact age boundary,
 -- archived exclusion and U1 deduplication before the top-five cut.
 for v_i in 10..13 loop
  perform pg_temp.today_dec_order(v_i,(array['awaiting_approval','partially_reserved','packed','ready_for_picking'])[v_i-9],
   interval '25 hours',v_i*100);
 end loop;
 v_order:=pg_temp.today_dec_order(14,'packed',interval '24 hours',9000);
 v_other:=pg_temp.today_dec_order(15,'packed',interval '26 hours',9000);
 update private.stockflow_orders set archived_at=now() where id=v_other;
 v_line:=pg_temp.today_dec_order(16,'packed',interval '27 hours',5000,true);
 v_output:=pg_temp.today_dec_read();
 for v_i in 10..13 loop
  select value into v_row from jsonb_array_elements(v_output#>'{unblock,rows}') where value#>>'{target,orderId}'=pg_temp.today_dec_id(100+v_i)::text;
  if v_row->>'type' is distinct from 'stuck_order' or (v_row->>'valuePaise')::numeric is distinct from (v_i*20000)::numeric
   then raise exception 'T3 missing aged state / remaining quantity: %',v_i;end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(v_output#>'{unblock,rows}') where value#>>'{target,orderId}' in (v_order::text,v_other::text))
  or (select count(*) from jsonb_array_elements(v_output#>'{unblock,rows}') where value#>>'{target,orderId}'=v_line::text)<>1
  or not exists(select 1 from jsonb_array_elements(v_output#>'{unblock,rows}') where value#>>'{target,orderId}'=v_line::text and value->>'type'='approve_price')
  then raise exception 'T3 age, archive or U1 deduplication failed';end if;
 update private.stockflow_orders set archived_at=now() where created_by_email='today-dec-manager@test.local';
 v_order:=pg_temp.today_dec_order(17,'packed',interval '25 hours',100);
 perform pg_temp.today_dec_line(v_order,'TODAY-DEC-STUCK-UNKNOWN',null,false,1,0);
 v_output:=pg_temp.today_dec_read();
 select value into v_row from jsonb_array_elements(v_output#>'{unblock,rows}') where value#>>'{target,orderId}'=v_order::text;
 if v_row->'valuePaise' is distinct from 'null'::jsonb or v_row->>'rankReason' is distinct from 'value_unknown'
  then raise exception 'T3 unpriced remaining line fabricated value';end if;
 update private.stockflow_orders set archived_at=now() where id=v_order;
 raise notice 'PASS T3: urgent and fulfilment age, archive and U1 exclusion';

 -- T4: Commercial history uses real opportunity/constraint/wallet gateways.
 for v_i in 2..3 loop
  v_opportunity:=pg_temp.today_dec_opportunity(v_i);
  perform public.stockflow_opportunity_gateway('today-decisions-test-key','today-dec-manager@test.local','record_constraint',
   jsonb_build_object('requestId','today-dec-deadline-constraint-'||v_i,'opportunityId',v_opportunity,
    'category','competitor_lock_in','evidence','Today fixture agreement','source','document','sourcePerson',null,
    'observedOn',v_today,'facts',jsonb_build_object('competitor','Today competitor','endsOn',v_today-29),
    'expectedCurrentConstraintId',null));
 end loop;
 for v_i in 4..7 loop
  v_opportunity:=pg_temp.today_dec_opportunity(v_i);
  if v_i=6 then
   -- The gateway can create today's action. It must not become overdue today.
   perform public.stockflow_action_gateway('today-decisions-test-key','today-dec-manager@test.local','create_action',
    jsonb_build_object('requestId','today-dec-action-due-today','opportunityId',v_opportunity,
     'actionType','visit','detail','Today fixture visit','ownerEmail','today-dec-sales@test.local',
     'dueOn',v_today,'expectedMonthlyGainPaise',90000000000000));
  else
   -- Historical overdue dates cannot be created by the gateway (dueOn >= today),
   -- and action rows are immutable. Seed only this historical fact directly.
   insert into private.stockflow_commercial_actions(opportunity_id,action_type,detail,owner_email,due_on,expected_monthly_gain_paise,created_by)
   values(v_opportunity,'visit','Today fixture overdue visit','today-dec-sales@test.local',v_today-1,
    case when v_i=5 then null else 70000000000000 end,'today-dec-manager@test.local') returning id into v_action;
   if v_i=7 then
    perform public.stockflow_action_gateway('today-decisions-test-key','today-dec-manager@test.local','close_action',
     jsonb_build_object('requestId','today-dec-close-overdue-action','actionId',v_action,'result','done','note','Today fixture completed'));
   end if;
  end if;
 end loop;
 perform pg_temp.today_dec_wallet(2,100000000000000);
 perform pg_temp.today_dec_wallet(8,9000000000000000);
 v_focus_opportunity:=pg_temp.today_dec_opportunity(8);
 insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
 values('today-dec-certified','TODAY-DEC-LAB-2',pg_temp.today_dec_id(2),'today-dec-manager@test.local');
 -- Same real certification setup as wallet_v2.sql, with relative IST months.
 -- Other replay identities are included using their actual reconciliation totals.
 v_months:=array[v_start,(v_start+interval '1 month')::date,(v_start+interval '2 months')::date];
 for v_company in select distinct company_id from private.stockflow_economic_customer_identities loop
  insert into private.stockflow_economic_source_coverage(company_id,window_from,window_to,source_version,imported_at)
  values(v_company,v_start,v_end,'today-dec-certified',clock_timestamp()+interval '1 day');
  insert into private.stockflow_sales_control_imports(company_id,source_version,valid_months,imported_at)
  values(v_company,'today-dec-certified',v_months,clock_timestamp()+interval '1 day');
  foreach v_month in array v_months loop
   v_net:=(private.stockflow_sales_reconciliation(v_company,v_month)->>'appNetPaise')::bigint;
   insert into private.stockflow_sales_control_totals(company_id,month,kind,source_key,net_paise,source_version,imported_at)
   values(v_company,v_month,'sales_ledger','sales',v_net,'today-dec-certified',clock_timestamp()+interval '1 day');
  end loop;
 end loop;
 v_wallet:=private.stockflow_wallet_read(v_today);
 if v_wallet#>>'{coverage,certified}' is distinct from 'true' then raise exception 'T4 certification setup failed: %',v_wallet->'coverage';end if;
 select (value->>'captureGapPaise')::numeric into v_gap from jsonb_array_elements(v_wallet->'rows') where value->>'customerId'=pg_temp.today_dec_id(2)::text;
 v_output:=pg_temp.today_dec_read();
 select value into v_row from jsonb_array_elements(v_output#>'{grow,rows}') where value#>>'{target,customerId}'=pg_temp.today_dec_id(2)::text and value->>'type'='deadline';
 if (v_row->>'valuePaisePerMonth')::numeric is distinct from v_gap or v_row->>'valueKind' is distinct from 'gap'
  or v_row->>'due' is distinct from (v_today-29)::text then raise exception 'T4 G2 certified gap differs: %',v_row;end if;
 select value into v_row from jsonb_array_elements(v_output#>'{grow,rows}') where value#>>'{target,customerId}'=pg_temp.today_dec_id(4)::text;
 if (v_row->>'valuePaisePerMonth')::numeric is distinct from 70000000000000::numeric
  or v_row->>'valueKind' is distinct from 'expected' or v_row->>'type' is distinct from 'overdue_action'
  or v_row->>'due' is distinct from (v_today-1)::text then raise exception 'T4 G3 expected gain differs: %',v_row;end if;
 if not exists(select 1 from jsonb_array_elements(v_output#>'{grow,rows}') where value#>>'{target,customerId}'=pg_temp.today_dec_id(8)::text and value->>'type'='diagnose')
  then raise exception 'T4 certified Focus without a known diagnosis missing';end if;
 -- Record a current known constraint inside a subtransaction, check exclusion,
 -- then undo it so T7 starts with a real undiagnosed Focus account.
 begin
  perform public.stockflow_opportunity_gateway('today-decisions-test-key','today-dec-manager@test.local','record_constraint',
   jsonb_build_object('requestId','today-dec-focus-known-constraint','opportunityId',v_focus_opportunity,'category','service',
    'evidence','Today fixture service evidence','source','our_view','sourcePerson',null,'observedOn',v_today,
    'facts',jsonb_build_object('issue','Service response delay','since',v_today),'expectedCurrentConstraintId',null));
  v_output:=pg_temp.today_dec_read();
  if exists(select 1 from jsonb_array_elements(v_output#>'{grow,rows}') where value#>>'{target,customerId}'=pg_temp.today_dec_id(8)::text and value->>'type'='diagnose')
   then raise exception 'T4 known current diagnosis still shown';end if;
  select ordinality into v_known_position from jsonb_array_elements(v_output#>'{grow,rows}') with ordinality where value#>>'{target,customerId}'=pg_temp.today_dec_id(4)::text;
  select value,ordinality into v_row,v_unknown_position from jsonb_array_elements(v_output#>'{grow,rows}') with ordinality where value#>>'{target,customerId}'=pg_temp.today_dec_id(3)::text;
  if v_row->'valuePaisePerMonth' is distinct from 'null'::jsonb or v_row->'valueKind' is distinct from 'null'::jsonb
   or v_unknown_position is null or v_known_position is null or v_known_position>=v_unknown_position
   then raise exception 'T4 unknown gap / known-before-unknown ranking failed';end if;
  raise exception 'Undo temporary known diagnosis' using errcode='PT001';
 exception when sqlstate 'PT001' then null;
 end;
 if exists(select 1 from jsonb_array_elements(v_output#>'{grow,rows}') where value#>>'{target,customerId}' in (pg_temp.today_dec_id(6)::text,pg_temp.today_dec_id(7)::text))
  then raise exception 'T4 due-today or completed action became overdue';end if;
 raise notice 'PASS T4: certified G2 gap, G3 expected gain and known-before-unknown ranking';

 -- T7 runs before adding the six high-value T5 fixtures, so null rows are visible.
 insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
 values('today-dec-uncertified','TODAY-DEC-LAB-3',pg_temp.today_dec_id(3),'today-dec-manager@test.local');
 if private.stockflow_wallet_read(v_today)#>>'{coverage,certified}' is distinct from 'false'
  then raise exception 'T7 uncertified fixture setup failed';end if;
 v_output:=pg_temp.today_dec_read();
 if exists(select 1 from jsonb_array_elements(v_output#>'{grow,rows}') where value#>>'{target,customerId}'=pg_temp.today_dec_id(8)::text and value->>'type'='diagnose')
  then raise exception 'T7 uncertified G1 leaked';end if;
 for v_i in 2..3 loop
  select value into v_row from jsonb_array_elements(v_output#>'{grow,rows}') where value#>>'{target,customerId}'=pg_temp.today_dec_id(v_i)::text and value->>'type'='deadline';
  if v_row->'valuePaisePerMonth' is distinct from 'null'::jsonb or v_row->'valueKind' is distinct from 'null'::jsonb
   or v_row->>'rankReason' is distinct from 'value_unknown' then raise exception 'T7 uncertified G2 gap leaked: %',v_row;end if;
 end loop;
 select value into v_row from jsonb_array_elements(v_output#>'{grow,rows}') where value#>>'{target,customerId}'=pg_temp.today_dec_id(5)::text;
 if v_row->'valuePaisePerMonth' is distinct from 'null'::jsonb or v_row->'valueKind' is distinct from 'null'::jsonb
  then raise exception 'T7 missing expected gain became zero';end if;
 raise notice 'PASS T7: uncertified coverage removes G1 and nulls G2 gaps';

 -- T5: Totals count all decisions before the cap; same amounts break ties by
 -- oldest waiting/due, then stable id. Assert deltas, never global fixture totals.
 v_baseline_unblock:=(v_output#>>'{unblock,total}')::bigint;
 v_baseline_grow:=(v_output#>>'{grow,total}')::bigint;
 for v_i in 20..25 loop
  perform pg_temp.today_dec_order(v_i,'confirmed',make_interval(hours=>case when v_i in (21,22) then 29 else 50-v_i end),1000,true);
  v_opportunity:=pg_temp.today_dec_opportunity(v_i);
  insert into private.stockflow_commercial_actions(opportunity_id,action_type,detail,owner_email,due_on,expected_monthly_gain_paise,created_by)
  values(v_opportunity,'visit','Today fixture bounded queue','today-dec-sales@test.local',v_today-(50-v_i),90000000000000,'today-dec-manager@test.local');
 end loop;
 v_output:=pg_temp.today_dec_read();
 if jsonb_array_length(v_output#>'{unblock,rows}')<>5 or jsonb_array_length(v_output#>'{grow,rows}')<>5
  or (v_output#>>'{unblock,total}')::bigint<>v_baseline_unblock+6
  or (v_output#>>'{grow,total}')::bigint<>v_baseline_grow+6
  then raise exception 'T5 lane caps or total deltas failed: %',v_output;end if;
 select jsonb_agg(pg_temp.today_dec_id(100+n)::text order by n) into v_expected from generate_series(20,24) n;
 select jsonb_agg(value#>>'{target,orderId}' order by ordinality) into v_actual
 from jsonb_array_elements(v_output#>'{unblock,rows}') with ordinality
 where value#>>'{target,orderId}' like 'b2d10000-%';
 if v_actual is distinct from v_expected then raise exception 'T5 waiting-time / stable-id order differs: %',v_actual;end if;
 select jsonb_agg(pg_temp.today_dec_id(n)::text order by n) into v_expected from generate_series(20,24) n;
 select jsonb_agg(value#>>'{target,customerId}' order by ordinality) into v_actual
 from jsonb_array_elements(v_output#>'{grow,rows}') with ordinality
 where value#>>'{target,customerId}' like 'b2d10000-%';
 if v_actual is distinct from v_expected then raise exception 'T5 due-time order differs: %',v_actual;end if;
 if v_output->>'policyVersion' is distinct from 'today-v1' or v_output->>'generatedAt' is null
  or exists(select 1 from jsonb_array_elements((v_output#>'{unblock,rows}')||(v_output#>'{grow,rows}'))
   where value->>'rankReason' is distinct from 'due_soon') then raise exception 'T5 version or tie reason missing';end if;
 raise notice 'PASS T5: five rows per lane, complete totals and deterministic ties';

 -- T6: Roles/key/input/grants, explicit public shape and no writes on repeated reads.
 perform pg_temp.today_dec_error('{}','PT403','today-dec-sales@test.local');
 perform pg_temp.today_dec_error('{}','PT403','today-dec-operations@test.local');
 perform pg_temp.today_dec_error('{}','42501','today-dec-manager@test.local','wrong-today-key');
 perform pg_temp.today_dec_error('{}','22023','today-dec-manager@test.local','today-decisions-test-key','other_action');
 for v_bad in select value from jsonb_array_elements('[null,[],1,{"page":1},{"extra":true}]'::jsonb) loop
  perform pg_temp.today_dec_error(v_bad,'22023');
 end loop;
 perform pg_temp.today_dec_error(null,'22023');
 v_output:=public.stockflow_today_gateway('today-decisions-test-key',' TODAY-DEC-ADMIN@test.local ','get_today','{}');
 if v_output->>'policyVersion' is distinct from 'today-v1' then raise exception 'T6 administrator read denied';end if;
 -- Text assertion only on our rows and envelope, not arbitrary other fixture labels.
 select jsonb_agg(value) into v_actual from jsonb_array_elements((v_output#>'{unblock,rows}')||(v_output#>'{grow,rows}'))
 where coalesce(value#>>'{target,orderId}',value#>>'{target,customerId}') like 'b2d10000-%';
 if v_actual::text ~* '(cost|margin|gross|purchase)' or (v_output-'unblock'-'grow')::text ~* '(cost|margin|gross|purchase)'
  then raise exception 'T6 forbidden fields exposed';end if;
 foreach v_role in array array['anon','authenticated'] loop
  if has_function_privilege(v_role,'public.stockflow_today_gateway(text,text,text,jsonb)','EXECUTE')
   then raise exception 'T6 browser RPC grant: %',v_role;end if;
 end loop;
 if not has_function_privilege('service_role','public.stockflow_today_gateway(text,text,text,jsonb)','EXECUTE')
  then raise exception 'T6 missing service grant';end if;
 select count(*) into v_events from private.stockflow_order_events where actor_email='today-dec-manager@test.local';
 select count(*) into v_commands from private.stockflow_command_results where actor_email='today-dec-manager@test.local';
 -- Information only: five real calls, no performance assertion or sleep.
 v_started:=clock_timestamp();
 for v_i in 1..5 loop perform pg_temp.today_dec_read();end loop;
 v_average_ms:=extract(epoch from clock_timestamp()-v_started)*1000/5;
 raise notice 'Today get_today average milliseconds (5 calls): %',round(v_average_ms,3);
 if (select count(*) from private.stockflow_order_events where actor_email='today-dec-manager@test.local')<>v_events
  or (select count(*) from private.stockflow_command_results where actor_email='today-dec-manager@test.local')<>v_commands
  then raise exception 'T6 Today reads wrote business history';end if;
 raise notice 'PASS T6: authorization, strict input, safe fields and read-only composition';
end$checks$;
rollback;
