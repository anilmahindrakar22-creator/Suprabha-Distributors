begin;
insert into private.stockflow_gateway_config(name,secret_sha256) values('orders',encode(extensions.digest('diagnosis-test-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,status) values
 ('diagnosis-manager@test.local','management','active'),('diagnosis-admin@test.local','administrator','active'),
 ('diagnosis-sales@test.local','sales','active'),('diagnosis-operations@test.local','operations','active'),
 ('diagnosis-warehouse@test.local','warehouse','active'),('diagnosis-billing@test.local','billing','active'),
 ('diagnosis-accounts@test.local','accounts','active'),('diagnosis-viewer@test.local','viewer','active');
insert into private.stockflow_customers(id,name,tally_key,created_by_email) values
 ('b2500000-0000-4000-8000-000000000001','Diagnosis One','diagnosis-1','test'),
 ('b2500000-0000-4000-8000-000000000002','Diagnosis Two','diagnosis-2','test'),
 ('b2500000-0000-4000-8000-000000000003','Diagnosis Three','diagnosis-3','test'),
 ('b2500000-0000-4000-8000-000000000004','Diagnosis Four','diagnosis-4','test'),
 ('b2d00000-0000-4000-8000-000000000013','Outcome Diagnosis Lab','outcome-diagnosis-lab','test'),
 ('b2c00000-0000-4000-8000-000000000011','Division Diagnosis Lab','division-diagnosis-lab','test'),
 ('b2900000-0000-4000-8000-000000000005','Diagnosis Five','diagnosis-5','test'),
 ('b2900000-0000-4000-8000-000000000004','Diagnosis Other','diagnosis-other-4','test');
insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by) values
 ('diagnosis-test','diagnosis-1','b2500000-0000-4000-8000-000000000001','test'),
 ('diagnosis-test','diagnosis-2','b2500000-0000-4000-8000-000000000002','test'),
 ('diagnosis-test','diagnosis-3','b2500000-0000-4000-8000-000000000003','test'),
 ('diagnosis-test','diagnosis-4','b2500000-0000-4000-8000-000000000004','test'),
 ('diagnosis-test','outcome-diagnosis-lab','b2d00000-0000-4000-8000-000000000013','test'),
 ('diagnosis-test','diagnosis-5','b2900000-0000-4000-8000-000000000005','test');
insert into private.stockflow_wallet_divisions(code,name,sort_order,active) values('DIAGTEST','Diagnosis Test Division',100,true)
on conflict(code) do update set active=true;
create function pg_temp.diagnosis_call(p_action text,p_payload jsonb) returns jsonb language sql as $$
 select public.stockflow_opportunity_gateway('diagnosis-test-key','diagnosis-manager@test.local',p_action,p_payload);
$$;
create function pg_temp.diagnosis_account_call(p_action text,p_payload jsonb) returns jsonb language sql as $$
 select public.stockflow_accounts_gateway('diagnosis-test-key','diagnosis-manager@test.local',p_action,p_payload||jsonb_build_object('idempotencyKey',p_payload->>'idempotencyKey'));
$$;
create function pg_temp.diagnosis_error(p_action text,p_payload jsonb,p_expected text) returns void language plpgsql as $$
begin
 begin perform pg_temp.diagnosis_call(p_action,p_payload);
 exception when others then if sqlstate=p_expected then return;end if;raise;end;
 raise exception 'Expected SQLSTATE % for %',p_expected,p_action;
end$$;
do $checks$
declare result_data jsonb; first_id uuid; second_id uuid; third_id uuid; first_constraint uuid; newer_constraint uuid; row_value jsonb;
 denied_flag boolean; actor_role text; action_name text; table_name text; row_count_before bigint; audit_count_before bigint;
 fixture_company text; fixture_month date; fixture_net bigint; fixture_start date; fixture_end date;
 fixture_focus bigint; fixture_focus_members bigint; diag_four_data jsonb; d11_result jsonb; d11_rows jsonb; d11_row jsonb;
 v_d12_result jsonb; v_d12_rows jsonb; v_d12_opportunity jsonb;
 v_d13_open jsonb; v_d13_action jsonb; v_d13_outcomes jsonb; v_d13_row jsonb; v_d13_action_id uuid;
 v_d13_initial_id uuid; v_d13_last_id uuid; v_d13_open_id uuid; v_d13_index integer; v_d13_kind text;
 signal_order uuid; signal_order_old uuid; signal_install uuid;
 signal_customer uuid:='b2500000-0000-4000-8000-000000000001'; signal_other uuid:='b2500000-0000-4000-8000-000000000003'; signal_data jsonb;
 signal_line uuid; signal_decision uuid; signal_policy uuid; signal_price_order uuid;
 fact_data jsonb; source_value text;
begin
 -- D13 uncertified opportunity outcomes return no sales measure.
 v_d13_open:=pg_temp.diagnosis_call('open_opportunity',jsonb_build_object('requestId','wallet-diagnosis-d13-initial-open','customerId','b2d00000-0000-4000-8000-000000000013',
  'kind','recover','reason','Outcome measurement fixture'));
 v_d13_initial_id:=(v_d13_open->>'id')::uuid;
 v_d13_action:=public.stockflow_action_gateway('diagnosis-test-key','diagnosis-manager@test.local','create_action',jsonb_build_object(
  'requestId','wallet-diagnosis-d13-action-open','opportunityId',v_d13_initial_id,'actionType','visit','detail','Visit outcome fixture',
  'ownerEmail','diagnosis-manager@test.local','dueOn',(now() at time zone 'Asia/Kolkata')::date,'expectedMonthlyGainPaise',null));
 v_d13_action_id:=(v_d13_action->>'id')::uuid;
 perform public.stockflow_action_gateway('diagnosis-test-key','diagnosis-manager@test.local','close_action',jsonb_build_object(
  'requestId','wallet-diagnosis-d13-action-close','actionId',v_d13_action_id,'result','done','note','Visit completed'));
 perform pg_temp.diagnosis_call('close_opportunity',jsonb_build_object('requestId','wallet-diagnosis-d13-initial-close','opportunityId',v_d13_initial_id,
  'outcome','won','reason','Outcome fixture won'));
 v_d13_outcomes:=pg_temp.diagnosis_call('get_opportunity_outcomes',jsonb_build_object('customerId','b2d00000-0000-4000-8000-000000000013'));
 select value into v_d13_row from jsonb_array_elements(v_d13_outcomes) where value->>'opportunityId'=v_d13_initial_id::text;
 if v_d13_row is null or v_d13_row->>'measurable'<>'false' or v_d13_row->'salesBeforePaise' is distinct from 'null'::jsonb
  or v_d13_row->'salesNowPaise' is distinct from 'null'::jsonb or v_d13_row->>'notMeasurableReason' is null then
  raise exception 'D13 uncertified sales outcome failed: %',v_d13_outcomes;end if;
 -- D12 wallet-gap provenance is rejected before coverage is certified; invalid origins are always rejected.
 perform pg_temp.diagnosis_error('open_opportunity','{"requestId":"wallet-diagnosis-d12-uncertified","customerId":"b2500000-0000-4000-8000-000000000001","kind":"capture","reason":"Uncertified wallet gap","origin":"wallet_gap"}','22023');
 perform pg_temp.diagnosis_error('open_opportunity','{"requestId":"wallet-diagnosis-d12-invalid-origin","customerId":"b2500000-0000-4000-8000-000000000001","kind":"capture","reason":"Invalid opportunity origin","origin":"suggested"}','22023');
 -- D2 open conflict, other-kind success and reopening after closure.
 result_data:=pg_temp.diagnosis_call('open_opportunity','{"requestId":"wallet-diagnosis-d2-open-a","customerId":"b2500000-0000-4000-8000-000000000001","kind":"capture","reason":"Capture account"}');
 if result_data->>'origin'<>'manual' then raise exception 'Omitted origin must default to manual: %',result_data;end if;
 first_id:=(result_data->>'id')::uuid;
 perform pg_temp.diagnosis_error('open_opportunity','{"requestId":"wallet-diagnosis-d2-conflict","customerId":"b2500000-0000-4000-8000-000000000001","kind":"capture","reason":"Second attempt"}','PT409');
 result_data:=pg_temp.diagnosis_call('open_opportunity','{"requestId":"wallet-diagnosis-d2-defend","customerId":"b2500000-0000-4000-8000-000000000001","kind":"defend","reason":"Defend account"}');
 second_id:=(result_data->>'id')::uuid;
 perform pg_temp.diagnosis_call('close_opportunity',('{"requestId":"wallet-diagnosis-d2-close","opportunityId":"'||first_id||'","outcome":"lost","reason":"Lost account"}')::jsonb);
 result_data:=pg_temp.diagnosis_call('open_opportunity','{"requestId":"wallet-diagnosis-d2-reopen","customerId":"b2500000-0000-4000-8000-000000000001","kind":"capture","reason":"Reopen account"}');
 third_id:=(result_data->>'id')::uuid;
 -- D3 optimistic constraint, closed and missing entities, double close.
 result_data:=pg_temp.diagnosis_call('record_constraint',('{"requestId":"wallet-diagnosis-d3-one","opportunityId":"'||second_id||'","category":"price","evidence":"Competitor quote recorded","source":"document","sourcePerson":null,"observedOn":"'||(now() at time zone 'Asia/Kolkata')::date||'","facts":{"competitor":"Acme Lab","product":"Glucose kit","competitorPricePaise":120000,"ourPricePaise":140000},"expectedCurrentConstraintId":null}')::jsonb);
 first_constraint:=(result_data->>'id')::uuid;
 perform pg_temp.diagnosis_error('record_constraint',('{"requestId":"wallet-diagnosis-d3-stale","opportunityId":"'||second_id||'","category":"service","evidence":"Response took too long","source":"our_view","sourcePerson":null,"observedOn":"'||(now() at time zone 'Asia/Kolkata')::date||'","facts":{"issue":"Slow response","since":"'||(now() at time zone 'Asia/Kolkata')::date||'"},"expectedCurrentConstraintId":null}')::jsonb,'PT409');
 result_data:=pg_temp.diagnosis_call('record_constraint',('{"requestId":"wallet-diagnosis-d3-two","opportunityId":"'||second_id||'","category":"portfolio","evidence":"Required assay absent","source":"customer_stated","sourcePerson":"Lab manager","observedOn":"'||(now() at time zone 'Asia/Kolkata')::date||'","facts":{"product":"Thyroid panel","division":"BIOCHEM"},"expectedCurrentConstraintId":"'||first_constraint||'"}')::jsonb);
 perform pg_temp.diagnosis_call('close_opportunity',('{"requestId":"wallet-diagnosis-d3-close","opportunityId":"'||second_id||'","outcome":"dropped","reason":"No active demand"}')::jsonb);
 perform pg_temp.diagnosis_error('record_constraint',('{"requestId":"wallet-diagnosis-d3-closed","opportunityId":"'||second_id||'","category":"unknown","evidence":"Need to ask the account","source":"our_view","sourcePerson":null,"observedOn":"'||(now() at time zone 'Asia/Kolkata')::date||'","facts":{"nextQuestion":"Which analyser is used?","askBy":"'||(now() at time zone 'Asia/Kolkata')::date||'"},"expectedCurrentConstraintId":null}')::jsonb,'22023');
 perform pg_temp.diagnosis_error('close_opportunity',('{"requestId":"wallet-diagnosis-d3-double-close","opportunityId":"'||second_id||'","outcome":"won","reason":"Won account"}')::jsonb,'PT409');
 perform pg_temp.diagnosis_error('open_opportunity','{"requestId":"wallet-diagnosis-d3-missing-customer","customerId":"b2500000-0000-4000-8000-999999999999","kind":"capture","reason":"Missing account"}','22023');
 perform pg_temp.diagnosis_error('record_constraint','{"requestId":"wallet-diagnosis-d3-missing-opportunity","opportunityId":"b2500000-0000-4000-8000-999999999999","category":"price","evidence":"Competitor quote recorded","source":"document","sourcePerson":null,"observedOn":"2026-10-29","facts":{"competitor":"Acme Lab","product":"Glucose kit","competitorPricePaise":120000,"ourPricePaise":140000},"expectedCurrentConstraintId":null}','22023');
 perform pg_temp.diagnosis_error('get_account_opportunities','{"customerId":"b2500000-0000-4000-8000-999999999999"}','22023');
 -- D1 append-only: actual rows in each table are guarded against update and delete.
 foreach table_name in array array['stockflow_commercial_opportunities','stockflow_commercial_opportunity_closures','stockflow_commercial_constraints'] loop
  denied_flag:=false;
  begin execute format('update private.%I set %I=%I',table_name,
   case table_name when 'stockflow_commercial_opportunities' then 'opened_reason' when 'stockflow_commercial_opportunity_closures' then 'reason' else 'evidence' end,
   case table_name when 'stockflow_commercial_opportunities' then 'opened_reason' when 'stockflow_commercial_opportunity_closures' then 'reason' else 'evidence' end);
  exception when others then denied_flag:=true;end;
  if not denied_flag then raise exception 'Update admitted on %',table_name;end if;
  denied_flag:=false;
  begin execute format('delete from private.%I',table_name);
  exception when others then denied_flag:=true;end;
  if not denied_flag then raise exception 'Delete admitted on %',table_name;end if;
 end loop;
 -- D5 every excluded role is denied on all five actions.
 foreach actor_role in array array['sales','operations','warehouse','billing','accounts','viewer'] loop
 foreach action_name in array array['get_wallet_diagnoses','get_account_opportunities','get_opportunity_outcomes','get_account_signals','open_opportunity','record_constraint','close_opportunity'] loop
   denied_flag:=false;
   begin perform public.stockflow_opportunity_gateway('diagnosis-test-key','diagnosis-'||actor_role||'@test.local',action_name,'{}');
   exception when sqlstate 'PT403' then denied_flag:=true;end;
   if not denied_flag then raise exception 'Role % admitted to %',actor_role,action_name;end if;
  end loop;
 end loop;
 -- D6 uncertified reads retain diagnosis rows and fail closed for focus counts.
 result_data:=pg_temp.diagnosis_call('get_wallet_diagnoses','{"customerIds":["b2500000-0000-4000-8000-000000000001"]}');
 if result_data->'focusCount' is distinct from 'null'::jsonb or result_data->'undiagnosedFocusCount' is distinct from 'null'::jsonb
  or result_data->'focusWithoutDecisionMaker' is distinct from 'null'::jsonb
  or jsonb_array_length(result_data->'rows')<>1 then raise exception 'Uncertified diagnosis response failed: %',result_data;end if;
 -- D7 certified three-account focus fixture: mirror W7/W8 coverage controls and set full focus band.
 perform public.stockflow_wallet_gateway('diagnosis-test-key','diagnosis-manager@test.local','set_wallet_policy',
  '{"requestId":"wallet-diagnosis-d7-policy","expectedVersion":1,"walletShareTargetBps":8000,"focusBandBps":10000,"staleAfterMonths":6,"note":"Diagnosis focus test"}');
 foreach actor_role in array array['1','2','3'] loop
  perform public.stockflow_wallet_gateway('diagnosis-test-key','diagnosis-manager@test.local','record_wallet_snapshot',
   jsonb_build_object('requestId','wallet-diagnosis-d7-wallet-'||actor_role,'customerId','b2500000-0000-4000-8000-'||lpad(actor_role,12,'0'),
    'monthlyWalletPaise',10000,'method','manager_estimate','source','Diagnosis fixture','confidence','medium',
    'asOf',(now() at time zone 'Asia/Kolkata')::date,'note','Diagnosis wallet fixture','loweredReason',null,'divisions','[]'::jsonb,'expectedCurrentSnapshotId',null));
 end loop;
 fixture_start:=(date_trunc('month',(now() at time zone 'Asia/Kolkata')::date)-interval '3 months')::date;
 fixture_end:=date_trunc('month',(now() at time zone 'Asia/Kolkata')::date)::date;
 -- Certify every linked company, since replay fixtures may leave identities outside this test's company.
 for fixture_company in select distinct company_id from private.stockflow_economic_customer_identities loop
  insert into private.stockflow_economic_source_coverage(company_id,window_from,window_to,source_version,imported_at)
  values(fixture_company,fixture_start,fixture_end,'diagnosis-certified',clock_timestamp()+interval '1 day');
  insert into private.stockflow_sales_control_imports(company_id,source_version,valid_months,imported_at)
  values(fixture_company,'diagnosis-certified',array[fixture_start,(fixture_start+interval '1 month')::date,(fixture_start+interval '2 months')::date],clock_timestamp()+interval '1 day');
  foreach fixture_month in array array[fixture_start,(fixture_start+interval '1 month')::date,(fixture_start+interval '2 months')::date] loop
   if fixture_company='diagnosis-test' then fixture_net:=0;
   else fixture_net:=(private.stockflow_sales_reconciliation(fixture_company,fixture_month)->>'appNetPaise')::bigint;end if;
   insert into private.stockflow_sales_control_totals(company_id,month,kind,source_key,net_paise,source_version,imported_at)
   values(fixture_company,fixture_month,'sales_ledger','sales',fixture_net,'diagnosis-certified',clock_timestamp()+interval '1 day');
  end loop;
 end loop;
 -- Reconciliation for each month uses dynamic IST months and company-specific control totals.
 result_data:=private.stockflow_wallet_read((now() at time zone 'Asia/Kolkata')::date);
 if result_data#>>'{coverage,certified}'<>'true' then raise exception 'D7 fixture not certified: %',result_data#>'{coverage}';end if;
 -- D13 certified measure uses the same complete-month window for an opportunity opened today.
 v_d13_outcomes:=pg_temp.diagnosis_call('get_opportunity_outcomes',jsonb_build_object('customerId','b2d00000-0000-4000-8000-000000000013'));
 select value into v_d13_row from jsonb_array_elements(v_d13_outcomes) where value->>'opportunityId'=v_d13_initial_id::text;
 if v_d13_row is null or v_d13_row->>'measurable'<>'true' or v_d13_row->'salesBeforePaise' is distinct from v_d13_row->'salesNowPaise'
  or v_d13_row->>'changePaise'<>'0' or v_d13_row->>'lastActionType'<>'visit' or v_d13_row->>'lastActionResult'<>'done'
  or v_d13_row->>'outcome'<>'won' or v_d13_row->>'notMeasurableReason' is distinct from null then
  raise exception 'D13 certified sales/action outcome failed: %',v_d13_row;end if;
 -- D13 returns only the newest ten closed rows and excludes open opportunities.
 for v_d13_index in 1..10 loop
  v_d13_kind:=case v_d13_index%3 when 1 then 'capture' when 2 then 'defend' else 'recover' end;
  v_d13_open:=pg_temp.diagnosis_call('open_opportunity',jsonb_build_object('requestId','wallet-diagnosis-d13-limit-open-'||lpad(v_d13_index::text,2,'0'),
   'customerId','b2d00000-0000-4000-8000-000000000013','kind',v_d13_kind,'reason','Recent outcome fixture '||v_d13_index));
  v_d13_last_id:=(v_d13_open->>'id')::uuid;
  perform pg_temp.diagnosis_call('close_opportunity',jsonb_build_object('requestId','wallet-diagnosis-d13-limit-close-'||lpad(v_d13_index::text,2,'0'),
   'opportunityId',v_d13_last_id,'outcome',case when v_d13_index%2=0 then 'lost' else 'dropped' end,'reason','Recent outcome closed'));
 end loop;
 v_d13_open:=pg_temp.diagnosis_call('open_opportunity',jsonb_build_object('requestId','wallet-diagnosis-d13-open-excluded','customerId','b2d00000-0000-4000-8000-000000000013',
  'kind','capture','reason','Open opportunity excluded'));
 v_d13_open_id:=(v_d13_open->>'id')::uuid;
 v_d13_outcomes:=pg_temp.diagnosis_call('get_opportunity_outcomes',jsonb_build_object('customerId','b2d00000-0000-4000-8000-000000000013'));
 if jsonb_array_length(v_d13_outcomes)<>10 or v_d13_outcomes->0->>'opportunityId'<>v_d13_last_id::text
  or exists(select 1 from jsonb_array_elements(v_d13_outcomes) as outcome_rows(item) where outcome_rows.item->>'opportunityId' in (v_d13_open_id::text,v_d13_initial_id::text) or outcome_rows.item->>'outcome' is null) then
  raise exception 'D13 newest-ten/closed-only outcomes failed: %',v_d13_outcomes;end if;
 denied_flag:=false;
 begin perform public.stockflow_opportunity_gateway('diagnosis-test-key','diagnosis-sales@test.local','get_opportunity_outcomes',jsonb_build_object('customerId','b2d00000-0000-4000-8000-000000000013'));
 exception when sqlstate 'PT403' then denied_flag:=true;end;
 if not denied_flag then raise exception 'D13 outcome role authorization failed';end if;
 perform pg_temp.diagnosis_call('record_constraint',('{"requestId":"wallet-diagnosis-d7-diagnosed","opportunityId":"'||third_id||'","category":"price","evidence":"Competitor quote at lower price","source":"our_view","sourcePerson":null,"observedOn":"'||(now() at time zone 'Asia/Kolkata')::date||'","facts":{"competitor":"Acme Lab","product":"Glucose kit","competitorPricePaise":120000,"ourPricePaise":140000},"expectedCurrentConstraintId":null}')::jsonb);
 result_data:=pg_temp.diagnosis_call('open_opportunity','{"requestId":"wallet-diagnosis-d8-latest-open","customerId":"b2500000-0000-4000-8000-000000000001","kind":"recover","reason":"Recover account"}');
 perform pg_temp.diagnosis_call('record_constraint',('{"requestId":"wallet-diagnosis-d8-constraint-one","opportunityId":"'||(result_data->>'id')||'","category":"portfolio","evidence":"Assay panel is incomplete","source":"customer_stated","sourcePerson":"Lab manager","observedOn":"'||(now() at time zone 'Asia/Kolkata')::date||'","facts":{"product":"Thyroid panel","division":"BIOCHEM"},"expectedCurrentConstraintId":null}')::jsonb);
 newer_constraint:=(pg_temp.diagnosis_call('record_constraint',('{"requestId":"wallet-diagnosis-d8-constraint-two","opportunityId":"'||(result_data->>'id')||'","category":"service","evidence":"Response times exceed target","source":"document","sourcePerson":null,"observedOn":"'||(now() at time zone 'Asia/Kolkata')::date||'","facts":{"issue":"Slow response","since":"'||(now() at time zone 'Asia/Kolkata')::date||'"},"expectedCurrentConstraintId":"'||(select c.id from private.stockflow_commercial_constraints c where c.opportunity_id=(result_data->>'id')::uuid order by c.recorded_at desc,c.id desc limit 1)||'"}')::jsonb)->>'id')::uuid;
 result_data:=pg_temp.diagnosis_call('open_opportunity','{"requestId":"wallet-diagnosis-d7-unknown-open","customerId":"b2500000-0000-4000-8000-000000000002","kind":"capture","reason":"Diagnose open account"}');
 perform pg_temp.diagnosis_call('record_constraint',('{"requestId":"wallet-diagnosis-d7-unknown","opportunityId":"'||(result_data->>'id')||'","category":"unknown","evidence":"Ask which instrument is in use","source":"our_view","sourcePerson":null,"observedOn":"'||(now() at time zone 'Asia/Kolkata')::date||'","facts":{"nextQuestion":"Which analyser is used?","askBy":"'||(now() at time zone 'Asia/Kolkata')::date||'"},"expectedCurrentConstraintId":null}')::jsonb);
 result_data:=pg_temp.diagnosis_call('get_wallet_diagnoses','{"customerIds":["b2500000-0000-4000-8000-000000000001","b2500000-0000-4000-8000-000000000002","b2500000-0000-4000-8000-000000000003"]}');
 select count(*) into fixture_focus from jsonb_array_elements(private.stockflow_wallet_read((now() at time zone 'Asia/Kolkata')::date)->'rows') as focus_rows(item)
 where (focus_rows.item->>'inFocusBand')::boolean;
 select count(*) into fixture_focus_members from jsonb_array_elements(private.stockflow_wallet_read((now() at time zone 'Asia/Kolkata')::date)->'rows') as fixture_rows(item)
 where fixture_rows.item->>'customerId' in ('b2500000-0000-4000-8000-000000000001','b2500000-0000-4000-8000-000000000002','b2500000-0000-4000-8000-000000000003')
  and (fixture_rows.item->>'inFocusBand')::boolean;
 if fixture_focus_members<>3 or result_data->>'focusCount'<>fixture_focus::text or result_data->>'undiagnosedFocusCount'<>(fixture_focus-1)::text
  or exists(select 1 from private.stockflow_commercial_opportunities opportunity_row where opportunity_row.customer_id not in
   ('b2500000-0000-4000-8000-000000000001','b2500000-0000-4000-8000-000000000002','b2500000-0000-4000-8000-000000000003','b2500000-0000-4000-8000-000000000004',
    'b2d00000-0000-4000-8000-000000000013','b2c00000-0000-4000-8000-000000000011','b2900000-0000-4000-8000-000000000005','b2900000-0000-4000-8000-000000000004'))
  then raise exception 'D7 Focus counts failed: %',result_data;end if;
 -- D12 wallet_gap succeeds only for a certified current Focus account.
 v_d12_result:=pg_temp.diagnosis_call('open_opportunity',jsonb_build_object('requestId','wallet-diagnosis-d12-focus','customerId','b2500000-0000-4000-8000-000000000003',
  'kind','defend','reason','Wallet gap diagnosis','origin','wallet_gap'));
 if v_d12_result->>'origin'<>'wallet_gap' or
  (select array_agg(response_key order by response_key) from jsonb_object_keys(v_d12_result) as response_keys(response_key)) is distinct from
   array['closure','constraint','customerId','divisionCode','divisionName','history','id','kind','openedAt','openedBy','openedReason','origin']::text[] then
  raise exception 'D12 wallet-gap opportunity JSON or key set failed: %',v_d12_result;end if;
 perform pg_temp.diagnosis_error('open_opportunity',jsonb_build_object('requestId','wallet-diagnosis-d12-not-focus','customerId','b2500000-0000-4000-8000-000000000004',
  'kind','capture','reason','Not a Focus account','origin','wallet_gap'),'22023');
 v_d12_rows:=pg_temp.diagnosis_call('get_account_opportunities','{"customerId":"b2500000-0000-4000-8000-000000000003"}');
 select value into v_d12_opportunity from jsonb_array_elements(v_d12_rows) where value->>'origin'='wallet_gap';
 if v_d12_opportunity is null or
  (select array_agg(response_key order by response_key) from jsonb_object_keys(v_d12_opportunity) as response_keys(response_key)) is distinct from
   array['closure','constraint','customerId','divisionCode','divisionName','history','id','kind','openedAt','openedBy','openedReason','origin']::text[] then
  raise exception 'D12 account opportunity JSON or key set failed: %',v_d12_rows;end if;
 -- P3 coverage counts all Focus rows without a decision maker; the fixtures are checked separately.
 if result_data->>'focusWithoutDecisionMaker' is distinct from
   (select count(*)::text from jsonb_array_elements(private.stockflow_wallet_read((now() at time zone 'Asia/Kolkata')::date)->'rows') as power_fixture_row(item)
    where (power_fixture_row.item->>'inFocusBand')::boolean and private.stockflow_power_alerts((power_fixture_row.item->>'customerId')::uuid,(now() at time zone 'Asia/Kolkata')::date) ? 'no_decision_maker')::text then
  raise exception 'P3 fixture missing-decision-maker count mismatch: %',result_data;end if;
 if (select count(*) from jsonb_array_elements(private.stockflow_wallet_read((now() at time zone 'Asia/Kolkata')::date)->'rows') as power_customer_row(item)
      where power_customer_row.item->>'customerId' in ('b2500000-0000-4000-8000-000000000001','b2500000-0000-4000-8000-000000000002','b2500000-0000-4000-8000-000000000003')
       and (power_customer_row.item->>'inFocusBand')::boolean
       and private.stockflow_power_alerts((power_customer_row.item->>'customerId')::uuid,(now() at time zone 'Asia/Kolkata')::date) ? 'no_decision_maker')<>3 then
  raise exception 'P3 fixture Focus or missing-decision-maker assertion failed';end if;
 -- D8 latest open opportunity and newest constraint are reflected in the list.
 select value into row_value from jsonb_array_elements(result_data->'rows') where value->>'customerId'='b2500000-0000-4000-8000-000000000001';
 if row_value->>'kind'<>'recover' or row_value->>'category'<>'service' then raise exception 'Latest open opportunity/current constraint failed: %',row_value;end if;
 -- D8b a diagnosed older opportunity outranks a newer undiagnosed one.
 diag_four_data:=pg_temp.diagnosis_call('open_opportunity',jsonb_build_object('requestId','wallet-diagnosis-d8b-defend',
  'customerId','b2500000-0000-4000-8000-000000000004','kind','defend','reason','Defend account four'));
 perform pg_temp.diagnosis_call('record_constraint',jsonb_build_object('requestId','wallet-diagnosis-d8b-price',
  'opportunityId',diag_four_data->>'id','category','price','evidence','Competitor quote for account four','source','document','sourcePerson',null,
  'observedOn',(now() at time zone 'Asia/Kolkata')::date,'facts',jsonb_build_object('competitor','Acme Lab','product','Glucose kit','competitorPricePaise',120000,'ourPricePaise',140000),'expectedCurrentConstraintId',null));
 perform pg_temp.diagnosis_call('open_opportunity',jsonb_build_object('requestId','wallet-diagnosis-d8b-capture',
  'customerId','b2500000-0000-4000-8000-000000000004','kind','capture','reason','Newer capture account four'));
 diag_four_data:=pg_temp.diagnosis_call('get_wallet_diagnoses','{"customerIds":["b2500000-0000-4000-8000-000000000004"]}');
 if diag_four_data#>>'{rows,0,kind}'<>'defend' or diag_four_data#>>'{rows,0,category}'<>'price'
  then raise exception 'D8b diagnosed opportunity must outrank newer undiagnosed opportunity: %',diag_four_data;end if;
 -- D11 opportunities are unique within a division; whole-lab scope is separate.
 d11_result:=pg_temp.diagnosis_call('open_opportunity',jsonb_build_object('requestId','wallet-diagnosis-d11-immuno','customerId','b2c00000-0000-4000-8000-000000000011',
  'kind','capture','reason','Capture Immunoassay','divisionCode','IMMUNO'));
 if d11_result->>'divisionCode'<>'IMMUNO' or d11_result->>'divisionName'<>'Immunoassay' or d11_result->>'origin'<>'manual' then raise exception 'D11 Immunoassay division JSON failed: %',d11_result;end if;
 d11_result:=pg_temp.diagnosis_call('open_opportunity',jsonb_build_object('requestId','wallet-diagnosis-d11-haem','customerId','b2c00000-0000-4000-8000-000000000011',
  'kind','capture','reason','Capture Haematology','divisionCode','HAEM'));
 if d11_result->>'divisionCode'<>'HAEM' or d11_result->>'divisionName'<>'Haematology' or d11_result->>'origin'<>'manual' then raise exception 'D11 Haematology division JSON failed: %',d11_result;end if;
 perform pg_temp.diagnosis_error('open_opportunity',jsonb_build_object('requestId','wallet-diagnosis-d11-duplicate-immuno','customerId','b2c00000-0000-4000-8000-000000000011',
  'kind','capture','reason','Duplicate Immunoassay','divisionCode','IMMUNO'),'PT409');
 d11_result:=pg_temp.diagnosis_call('open_opportunity',jsonb_build_object('requestId','wallet-diagnosis-d11-whole-lab','customerId','b2c00000-0000-4000-8000-000000000011',
  'kind','capture','reason','Capture whole lab'));
 if d11_result->'divisionCode' is distinct from 'null'::jsonb or d11_result->'divisionName' is distinct from 'null'::jsonb then raise exception 'D11 whole-lab scope JSON failed: %',d11_result;end if;
 perform pg_temp.diagnosis_error('open_opportunity',jsonb_build_object('requestId','wallet-diagnosis-d11-unknown-division','customerId','b2c00000-0000-4000-8000-000000000011',
  'kind','defend','reason','Unknown division','divisionCode','NO_SUCH_DIVISION'),'22023');
 d11_rows:=pg_temp.diagnosis_call('get_account_opportunities','{"customerId":"b2c00000-0000-4000-8000-000000000011"}');
 if jsonb_array_length(d11_rows)<>3 then raise exception 'D11 expected three opportunities: %',d11_rows;end if;
 for d11_row in select value from jsonb_array_elements(d11_rows) loop
  if not (d11_row ? 'divisionCode') or not (d11_row ? 'divisionName') or not (d11_row ? 'origin') or d11_row->>'origin'<>'manual' then raise exception 'D11 opportunity JSON lacks division/origin fields: %',d11_row;end if;
 end loop;
 d11_result:=pg_temp.diagnosis_call('get_wallet_diagnoses','{"customerIds":["b2c00000-0000-4000-8000-000000000011"]}');
 if jsonb_array_length(d11_result->'rows')<>1 or not (d11_result->'rows'->0 ? 'divisionName')
  or d11_result#>'{rows,0,divisionName}' is distinct from 'null'::jsonb then raise exception 'D11 diagnosis row division name failed: %',d11_result;end if;
 -- E1 every category accepts its exact structured facts; representative shape errors are 22023.
 -- P5 relationship facts accept a same-customer current contact and reject cross-customer or removed contacts.
 result_data:=pg_temp.diagnosis_account_call('create_territory',jsonb_build_object('idempotencyKey','wallet-p5-territory-0001','name','Wallet Diagnosis P5 Territory'));
 perform pg_temp.diagnosis_account_call('assign_account',jsonb_build_object('idempotencyKey','wallet-p5-assignment-0005','customerId','b2900000-0000-4000-8000-000000000005','ownerEmail','diagnosis-manager@test.local','territoryId',result_data#>>'{territory,id}','expectedVersion',null));
 perform pg_temp.diagnosis_account_call('assign_account',jsonb_build_object('idempotencyKey','wallet-p5-assignment-0004','customerId','b2900000-0000-4000-8000-000000000004','ownerEmail','diagnosis-manager@test.local','territoryId',result_data#>>'{territory,id}','expectedVersion',null));
 result_data:=pg_temp.diagnosis_call('open_opportunity',jsonb_build_object('requestId','wallet-p5-opportunity-0001','customerId','b2900000-0000-4000-8000-000000000005','kind','recover','reason','Relationship facts fixture'));
 insert into private.stockflow_account_contacts(customer_id,name,business_role,added_by,updated_by)
 values('b2900000-0000-4000-8000-000000000005','P5 Current Person','Lab lead','diagnosis-manager@test.local','diagnosis-manager@test.local') returning id into signal_line;
 insert into private.stockflow_account_contacts(customer_id,name,business_role,added_by,updated_by)
 values('b2900000-0000-4000-8000-000000000004','P5 Other Person','Lab lead','diagnosis-manager@test.local','diagnosis-manager@test.local') returning id into signal_install;
 fact_data:=jsonb_build_object('decisionMaker','Dr P5','issue','No regular contact','contactId',signal_line::text);
 row_value:=pg_temp.diagnosis_call('record_constraint',jsonb_build_object('requestId','wallet-p5-valid-constraint-01','opportunityId',result_data->>'id','category','relationship','evidence','Relationship gap observed','source','our_view','sourcePerson',null,'observedOn',(now() at time zone 'Asia/Kolkata')::date,'facts',fact_data,'expectedCurrentConstraintId',null));
 if row_value->>'contactName'<>'P5 Current Person' then raise exception 'P5 relationship contact name missing: %',row_value;end if;
 perform pg_temp.diagnosis_error('record_constraint',jsonb_build_object('requestId','wallet-p5-cross-customer-01','opportunityId',result_data->>'id','category','relationship','evidence','Cross-customer contact rejected','source','our_view','sourcePerson',null,'observedOn',(now() at time zone 'Asia/Kolkata')::date,'facts',jsonb_build_object('decisionMaker','Dr P5','issue','No regular contact','contactId',signal_install::text),'expectedCurrentConstraintId',row_value->>'id'),'22023');
 update private.stockflow_account_contacts set removed_at=now(),removed_by='diagnosis-manager@test.local' where id=signal_line;
 perform pg_temp.diagnosis_error('record_constraint',jsonb_build_object('requestId','wallet-p5-removed-contact-01','opportunityId',result_data->>'id','category','relationship','evidence','Removed contact rejected','source','our_view','sourcePerson',null,'observedOn',(now() at time zone 'Asia/Kolkata')::date,'facts',jsonb_build_object('decisionMaker','Dr P5','issue','No regular contact','contactId',signal_line::text),'expectedCurrentConstraintId',row_value->>'id'),'22023');
 row_value:=pg_temp.diagnosis_call('record_constraint',jsonb_build_object('requestId','wallet-p5-no-contact-0001','opportunityId',result_data->>'id','category','relationship','evidence','Relationship without citation','source','our_view','sourcePerson',null,'observedOn',(now() at time zone 'Asia/Kolkata')::date,'facts',jsonb_build_object('decisionMaker','Dr P5','issue','No regular contact'),'expectedCurrentConstraintId',row_value->>'id'));
 result_data:=pg_temp.diagnosis_call('open_opportunity',jsonb_build_object('requestId','wallet-diagnosis-e1-open','customerId',signal_other,'kind','recover','reason','Evidence facts coverage'));
 foreach action_name in array array['price','portfolio','instrument','service','availability','credit','relationship','clinical','contract_tender','competitor_lock_in','unknown'] loop
  fact_data:=case action_name
   when 'price' then '{"competitor":"Acme Lab","product":"Glucose kit","competitorPricePaise":120000,"ourPricePaise":140000}'::jsonb
   when 'portfolio' then '{"product":"Thyroid panel","division":"BIOCHEM"}'::jsonb
   when 'instrument' then '{"analyser":"Analyzer X","owner":"customer","closedSystem":"unknown","division":"BIOCHEM"}'::jsonb
   when 'service' then jsonb_build_object('issue','Slow response','since',(now() at time zone 'Asia/Kolkata')::date)
   when 'availability' then '{"product":"Glucose kit","issue":"Frequent stockouts"}'::jsonb
   when 'credit' then '{"issue":"Credit terms too short"}'::jsonb
   when 'relationship' then '{"decisionMaker":"Dr Sharma","issue":"No regular contact"}'::jsonb
   when 'clinical' then '{"issue":"Needs clinical support"}'::jsonb
   when 'contract_tender' then jsonb_build_object('holder','District hospital','endsOn',(now() at time zone 'Asia/Kolkata')::date)
   when 'competitor_lock_in' then jsonb_build_object('competitor','Acme Lab','endsOn',(now() at time zone 'Asia/Kolkata')::date)
   else jsonb_build_object('nextQuestion','Which analyser is used?','askBy',(now() at time zone 'Asia/Kolkata')::date) end;
  perform pg_temp.diagnosis_call('record_constraint',jsonb_build_object('requestId','wallet-diagnosis-e1-'||action_name,'opportunityId',result_data->>'id',
   'category',action_name,'evidence','Structured evidence fixture','source','document','sourcePerson',null,'observedOn',(now() at time zone 'Asia/Kolkata')::date,
   'facts',fact_data,'expectedCurrentConstraintId',(select c.id from private.stockflow_commercial_constraints c where c.opportunity_id=(result_data->>'id')::uuid order by c.recorded_at desc,c.id desc limit 1)));
 end loop;
 perform pg_temp.diagnosis_error('record_constraint',jsonb_build_object('requestId','wallet-diagnosis-e1-price-missing','opportunityId',result_data->>'id','category','price','evidence','Bad price facts','source','document','sourcePerson',null,'observedOn',(now() at time zone 'Asia/Kolkata')::date,'facts','{"competitor":"Acme Lab"}'::jsonb,'expectedCurrentConstraintId',(select c.id from private.stockflow_commercial_constraints c where c.opportunity_id=(result_data->>'id')::uuid order by c.recorded_at desc,c.id desc limit 1)),'22023');
 perform pg_temp.diagnosis_error('record_constraint',jsonb_build_object('requestId','wallet-diagnosis-e1-instrument-extra','opportunityId',result_data->>'id','category','instrument','evidence','Bad instrument facts','source','document','sourcePerson',null,'observedOn',(now() at time zone 'Asia/Kolkata')::date,'facts','{"analyser":"Analyzer X","owner":"customer","closedSystem":"yes","division":"BIOCHEM","extra":true}'::jsonb,'expectedCurrentConstraintId',(select c.id from private.stockflow_commercial_constraints c where c.opportunity_id=(result_data->>'id')::uuid order by c.recorded_at desc,c.id desc limit 1)),'22023');
 perform pg_temp.diagnosis_error('record_constraint',jsonb_build_object('requestId','wallet-diagnosis-e1-unknown-type','opportunityId',result_data->>'id','category','unknown','evidence','Bad unknown facts','source','document','sourcePerson',null,'observedOn',(now() at time zone 'Asia/Kolkata')::date,'facts','{"nextQuestion":7,"askBy":"2026-10-29"}'::jsonb,'expectedCurrentConstraintId',(select c.id from private.stockflow_commercial_constraints c where c.opportunity_id=(result_data->>'id')::uuid order by c.recorded_at desc,c.id desc limit 1)),'22023');
 perform pg_temp.diagnosis_error('record_constraint',jsonb_build_object('requestId','wallet-diagnosis-e1-tender-extra','opportunityId',result_data->>'id','category','contract_tender','evidence','Bad tender facts','source','document','sourcePerson',null,'observedOn',(now() at time zone 'Asia/Kolkata')::date,'facts','{"holder":"District hospital","endsOn":"2026-10-29","extra":1}'::jsonb,'expectedCurrentConstraintId',(select c.id from private.stockflow_commercial_constraints c where c.opportunity_id=(result_data->>'id')::uuid order by c.recorded_at desc,c.id desc limit 1)),'22023');
 -- E2 source, person and dates are validated against the IST day.
 perform pg_temp.diagnosis_error('record_constraint',jsonb_build_object('requestId','wallet-diagnosis-e2-no-person','opportunityId',result_data->>'id','category','credit','evidence','Credit concern','source','customer_stated','observedOn',(now() at time zone 'Asia/Kolkata')::date,'facts','{"issue":"Credit terms too short"}'::jsonb,'expectedCurrentConstraintId',(select c.id from private.stockflow_commercial_constraints c where c.opportunity_id=(result_data->>'id')::uuid order by c.recorded_at desc,c.id desc limit 1)),'22023');
 perform pg_temp.diagnosis_error('record_constraint',jsonb_build_object('requestId','wallet-diagnosis-e2-document-person','opportunityId',result_data->>'id','category','credit','evidence','Credit concern','source','document','sourcePerson','Lab manager','observedOn',(now() at time zone 'Asia/Kolkata')::date,'facts','{"issue":"Credit terms too short"}'::jsonb,'expectedCurrentConstraintId',(select c.id from private.stockflow_commercial_constraints c where c.opportunity_id=(result_data->>'id')::uuid order by c.recorded_at desc,c.id desc limit 1)),'22023');
 perform pg_temp.diagnosis_error('record_constraint',jsonb_build_object('requestId','wallet-diagnosis-e2-future-observed','opportunityId',result_data->>'id','category','credit','evidence','Credit concern','source','document','sourcePerson',null,'observedOn',((now() at time zone 'Asia/Kolkata')::date+1),'facts','{"issue":"Credit terms too short"}'::jsonb,'expectedCurrentConstraintId',(select c.id from private.stockflow_commercial_constraints c where c.opportunity_id=(result_data->>'id')::uuid order by c.recorded_at desc,c.id desc limit 1)),'22023');
 perform pg_temp.diagnosis_error('record_constraint',jsonb_build_object('requestId','wallet-diagnosis-e2-past-ask','opportunityId',result_data->>'id','category','unknown','evidence','Question is overdue','source','our_view','sourcePerson',null,'observedOn',(now() at time zone 'Asia/Kolkata')::date,'facts',jsonb_build_object('nextQuestion','Which analyser is used?','askBy',(now() at time zone 'Asia/Kolkata')::date-1),'expectedCurrentConstraintId',(select c.id from private.stockflow_commercial_constraints c where c.opportunity_id=(result_data->>'id')::uuid order by c.recorded_at desc,c.id desc limit 1)),'22023');
 -- E3 confidence follows source; confidence input is rejected.
 foreach source_value in array array['document','customer_stated','our_view'] loop
  result_data:=pg_temp.diagnosis_call('record_constraint',jsonb_build_object('requestId','wallet-diagnosis-e3-'||source_value,'opportunityId',(select o.id from private.stockflow_commercial_opportunities o where o.customer_id=signal_customer and o.kind='recover' order by o.opened_at desc limit 1),
   'category','credit','evidence','Confidence derivation fixture','source',source_value,'sourcePerson',case when source_value='customer_stated' then 'Lab manager' end,
   'observedOn',(now() at time zone 'Asia/Kolkata')::date,'facts','{"issue":"Credit terms too short"}'::jsonb,'expectedCurrentConstraintId',(select c.id from private.stockflow_commercial_constraints c join private.stockflow_commercial_opportunities o on o.id=c.opportunity_id where o.customer_id=signal_customer and o.kind='recover' order by c.recorded_at desc,c.id desc limit 1)));
  if result_data->>'confidence'<>(case source_value when 'document' then 'high' when 'customer_stated' then 'medium' else 'low' end) then raise exception 'Confidence not derived from source: %',result_data;end if;
 end loop;
 perform pg_temp.diagnosis_error('record_constraint',jsonb_build_object('requestId','wallet-diagnosis-e3-confidence-input','opportunityId',(select o.id from private.stockflow_commercial_opportunities o where o.customer_id=signal_customer and o.kind='recover' order by o.opened_at desc limit 1),
  'category','credit','evidence','Reject selected confidence','source','document','sourcePerson',null,'observedOn',(now() at time zone 'Asia/Kolkata')::date,'facts','{"issue":"Credit terms too short"}'::jsonb,'confidence','high','expectedCurrentConstraintId',(select c.id from private.stockflow_commercial_constraints c join private.stockflow_commercial_opportunities o on o.id=c.opportunity_id where o.customer_id=signal_customer and o.kind='recover' order by c.recorded_at desc,c.id desc limit 1)),'22023');
 -- E4 price source warning and hand-checked rounded gap.
 diag_four_data:=pg_temp.diagnosis_call('open_opportunity',jsonb_build_object('requestId','wallet-diagnosis-e4-open','customerId',signal_customer,'kind','defend','reason','Verify price evidence'));
 perform pg_temp.diagnosis_call('record_constraint',jsonb_build_object('requestId','wallet-diagnosis-e4-price','opportunityId',diag_four_data->>'id','category','price','evidence','Internal estimate only',
  'source','our_view','sourcePerson',null,'observedOn',(now() at time zone 'Asia/Kolkata')::date,'facts','{"competitor":"Acme Lab","product":"Glucose kit","competitorPricePaise":120000,"ourPricePaise":140000}'::jsonb,'expectedCurrentConstraintId',null));
 result_data:=pg_temp.diagnosis_call('get_account_opportunities',jsonb_build_object('customerId',signal_customer));
 select value into row_value from jsonb_array_elements(result_data) where value->>'kind'='defend';
 if row_value#>>'{constraint,priceUnproven}'<>'true' or row_value#>>'{constraint,gapPermille}'<>'143' then raise exception 'Price read derivation failed: %',row_value;end if;
 result_data:=pg_temp.diagnosis_call('get_wallet_diagnoses',jsonb_build_object('customerIds',jsonb_build_array(signal_customer)));
 select value into row_value from jsonb_array_elements(result_data->'rows') where value->>'customerId'=signal_customer::text;
 if row_value->>'priceUnproven'<>'true' then raise exception 'Diagnosis priceUnproven failed: %',result_data;end if;
 -- E5 signal counts honor customer, 90-day window and open statuses.
 insert into private.stockflow_orders(customer_id,customer_name,idempotency_key,created_by_email,updated_by_email)
 values(signal_customer,'Diagnosis One','diagnosis-signal-current','test','test') returning id into signal_order;
 insert into private.stockflow_orders(customer_id,customer_name,idempotency_key,created_by_email,updated_by_email)
 values(signal_customer,'Diagnosis One','diagnosis-signal-old','test','test') returning id into signal_order_old;
 update private.stockflow_orders set created_at=((now() at time zone 'Asia/Kolkata')::date-interval '91 days')::timestamp at time zone 'Asia/Kolkata' where id=signal_order_old;
 insert into private.stockflow_delivery_exceptions(order_id,category,summary,created_by_email) values(signal_order,'delayed','Signal delivery problem','test');
 insert into private.stockflow_delivery_exceptions(order_id,category,status,summary,created_by_email) values(signal_order_old,'damaged','resolved','Old delivery problem','test');
 update private.stockflow_delivery_exceptions set created_at=((now() at time zone 'Asia/Kolkata')::date-interval '91 days')::timestamp at time zone 'Asia/Kolkata' where order_id=signal_order_old;
 insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,quantity) values(signal_order,'diagnosis-signal-price','Signal price item',1) returning id into signal_line;
 select id into signal_policy from private.stockflow_pricing_policies order by created_at desc limit 1;
 insert into private.stockflow_order_pricing_decisions(order_id,order_line_id,decision_version,order_version,state,resolution_type,source_type,
  guardrail_state,pricing_policy_id,pricing_policy_version,rounding_rule_version,requested_by_email,request_id)
 values(signal_order,signal_line,1,1,'pending_approval','price_exception','manual_review','price_review_required',signal_policy,'diagnosis-test','test-rounding','test','diagnosis-price-decision-current') returning id into signal_decision;
 insert into private.stockflow_price_exceptions(decision_id,order_id,order_line_id,entered_rate,reason,state,requested_by_email)
 values(signal_decision,signal_order,signal_line,1,'Signal current price exception','pending','test');
 insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,quantity) values(signal_order_old,'diagnosis-signal-old-price','Old signal price item',1) returning id into signal_line;
 insert into private.stockflow_order_pricing_decisions(order_id,order_line_id,decision_version,order_version,state,resolution_type,source_type,
  guardrail_state,pricing_policy_id,pricing_policy_version,rounding_rule_version,requested_by_email,request_id)
 values(signal_order_old,signal_line,1,1,'pending_approval','price_exception','manual_review','price_review_required',signal_policy,'diagnosis-test','test-rounding','test','diagnosis-price-decision-old') returning id into signal_decision;
 insert into private.stockflow_price_exceptions(decision_id,order_id,order_line_id,entered_rate,reason,state,requested_by_email)
 values(signal_decision,signal_order_old,signal_line,1,'Old signal price exception','pending','test');
 update private.stockflow_price_exceptions set requested_at=((now() at time zone 'Asia/Kolkata')::date-interval '91 days')::timestamp at time zone 'Asia/Kolkata' where decision_id=signal_decision;
 insert into private.stockflow_equipment_installations(order_id,tally_key,item_name,scheduled_date,created_by_email)
 values(signal_order,'signal-instrument','Analyzer X',(now() at time zone 'Asia/Kolkata')::date,'test') returning id into signal_install;
 insert into private.stockflow_service_tickets(installation_id,order_id,category,summary,created_by_email) values(signal_install,signal_order,'training','Signal service ticket','test');
 insert into private.stockflow_customer_visits(customer_id,visited_on,visited_by,outcome,request_id) values(signal_customer,(now() at time zone 'Asia/Kolkata')::date,'test','met','diagnosis-signal-visit');
 signal_data:=pg_temp.diagnosis_call('get_account_signals',jsonb_build_object('customerId',signal_customer));
 if signal_data->>'priceExceptions90d'<>'1' or signal_data->>'deliveryProblems90d'<>'1' or signal_data->>'deliveryProblemsOpen'<>'1' or signal_data->>'serviceTickets90d'<>'1'
  or signal_data->>'serviceTicketsOpen'<>'1' or signal_data->>'ourInstallations'<>'1' or signal_data->>'lastVisitOn'<>(now() at time zone 'Asia/Kolkata')::date::text
  then raise exception 'E5 customer signals failed: %',signal_data;end if;
 if jsonb_typeof(signal_data->'powerAlerts')<>'array' or signal_data->'decisionMakerLastMetOn' is distinct from 'null'::jsonb then raise exception 'P4 Power Map signals missing: %',signal_data;end if;
 signal_data:=pg_temp.diagnosis_call('get_account_signals',jsonb_build_object('customerId',signal_other));
 if signal_data->>'priceExceptions90d'<>'0' or signal_data->>'deliveryProblems90d'<>'0' or signal_data->>'serviceTicketsOpen'<>'0'
  or signal_data->>'ourInstallations'<>'0' or signal_data->'lastVisitOn' is distinct from 'null'::jsonb then raise exception 'E5 other customer/null visit failed: %',signal_data;end if;
 denied_flag:=false;begin perform public.stockflow_opportunity_gateway('diagnosis-test-key','diagnosis-sales@test.local','get_account_signals',jsonb_build_object('customerId',signal_customer));exception when sqlstate 'PT403' then denied_flag:=true;end;
 if not denied_flag then raise exception 'E5 role authorization failed';end if;
 -- D9 command replay stores the initial receipt and produces no duplicate row or audit.
 row_count_before:=(select count(*) from private.stockflow_commercial_opportunities);
 audit_count_before:=(select count(*) from private.stockflow_economic_audit audit_row where audit_row.action='open_opportunity');
 result_data:=pg_temp.diagnosis_call('open_opportunity','{"requestId":"wallet-diagnosis-d9-replay","customerId":"b2500000-0000-4000-8000-000000000004","kind":"recover","reason":"Recovery account"}');
 row_value:=pg_temp.diagnosis_call('open_opportunity','{"requestId":"wallet-diagnosis-d9-replay","customerId":"b2500000-0000-4000-8000-000000000004","kind":"recover","reason":"Recovery account"}');
 if result_data is distinct from row_value or (select count(*) from private.stockflow_commercial_opportunities)<>row_count_before+1
  or (select count(*) from private.stockflow_economic_audit audit_row where audit_row.action='open_opportunity')<>audit_count_before+1 then raise exception 'D9 replay duplicated result or effects';end if;
end$checks$;
rollback;
