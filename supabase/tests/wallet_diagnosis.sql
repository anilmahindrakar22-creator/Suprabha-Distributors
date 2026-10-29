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
 ('b2500000-0000-4000-8000-000000000004','Diagnosis Four','diagnosis-4','test');
insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by) values
 ('diagnosis-test','diagnosis-1','b2500000-0000-4000-8000-000000000001','test'),
 ('diagnosis-test','diagnosis-2','b2500000-0000-4000-8000-000000000002','test'),
 ('diagnosis-test','diagnosis-3','b2500000-0000-4000-8000-000000000003','test'),
 ('diagnosis-test','diagnosis-4','b2500000-0000-4000-8000-000000000004','test');
create function pg_temp.diagnosis_call(p_action text,p_payload jsonb) returns jsonb language sql as $$
 select public.stockflow_opportunity_gateway('diagnosis-test-key','diagnosis-manager@test.local',p_action,p_payload);
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
 fixture_focus bigint; fixture_focus_members bigint; diag_four_data jsonb;
begin
 -- D2 open conflict, other-kind success and reopening after closure.
 result_data:=pg_temp.diagnosis_call('open_opportunity','{"requestId":"wallet-diagnosis-d2-open-a","customerId":"b2500000-0000-4000-8000-000000000001","kind":"capture","reason":"Capture account"}');
 first_id:=(result_data->>'id')::uuid;
 perform pg_temp.diagnosis_error('open_opportunity','{"requestId":"wallet-diagnosis-d2-conflict","customerId":"b2500000-0000-4000-8000-000000000001","kind":"capture","reason":"Second attempt"}','PT409');
 result_data:=pg_temp.diagnosis_call('open_opportunity','{"requestId":"wallet-diagnosis-d2-defend","customerId":"b2500000-0000-4000-8000-000000000001","kind":"defend","reason":"Defend account"}');
 second_id:=(result_data->>'id')::uuid;
 perform pg_temp.diagnosis_call('close_opportunity',('{"requestId":"wallet-diagnosis-d2-close","opportunityId":"'||first_id||'","outcome":"lost","reason":"Lost account"}')::jsonb);
 result_data:=pg_temp.diagnosis_call('open_opportunity','{"requestId":"wallet-diagnosis-d2-reopen","customerId":"b2500000-0000-4000-8000-000000000001","kind":"capture","reason":"Reopen account"}');
 third_id:=(result_data->>'id')::uuid;
 -- D3 optimistic constraint, closed and missing entities, double close.
 result_data:=pg_temp.diagnosis_call('record_constraint',('{"requestId":"wallet-diagnosis-d3-one","opportunityId":"'||second_id||'","category":"price","evidence":"Competitor quote recorded","confidence":"high","expectedCurrentConstraintId":null}')::jsonb);
 first_constraint:=(result_data->>'id')::uuid;
 perform pg_temp.diagnosis_error('record_constraint',('{"requestId":"wallet-diagnosis-d3-stale","opportunityId":"'||second_id||'","category":"service","evidence":"Response took too long","confidence":"low","expectedCurrentConstraintId":null}')::jsonb,'PT409');
 result_data:=pg_temp.diagnosis_call('record_constraint',('{"requestId":"wallet-diagnosis-d3-two","opportunityId":"'||second_id||'","category":"portfolio","evidence":"Required assay absent","confidence":"medium","expectedCurrentConstraintId":"'||first_constraint||'"}')::jsonb);
 perform pg_temp.diagnosis_call('close_opportunity',('{"requestId":"wallet-diagnosis-d3-close","opportunityId":"'||second_id||'","outcome":"dropped","reason":"No active demand"}')::jsonb);
 perform pg_temp.diagnosis_error('record_constraint',('{"requestId":"wallet-diagnosis-d3-closed","opportunityId":"'||second_id||'","category":"unknown","evidence":"Need to ask the account","confidence":"low","expectedCurrentConstraintId":null}')::jsonb,'22023');
 perform pg_temp.diagnosis_error('close_opportunity',('{"requestId":"wallet-diagnosis-d3-double-close","opportunityId":"'||second_id||'","outcome":"won","reason":"Won account"}')::jsonb,'PT409');
 perform pg_temp.diagnosis_error('open_opportunity','{"requestId":"wallet-diagnosis-d3-missing-customer","customerId":"b2500000-0000-4000-8000-999999999999","kind":"capture","reason":"Missing account"}','22023');
 perform pg_temp.diagnosis_error('record_constraint','{"requestId":"wallet-diagnosis-d3-missing-opportunity","opportunityId":"b2500000-0000-4000-8000-999999999999","category":"price","evidence":"Competitor quote recorded","confidence":"high","expectedCurrentConstraintId":null}','22023');
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
  foreach action_name in array array['get_wallet_diagnoses','get_account_opportunities','open_opportunity','record_constraint','close_opportunity'] loop
   denied_flag:=false;
   begin perform public.stockflow_opportunity_gateway('diagnosis-test-key','diagnosis-'||actor_role||'@test.local',action_name,'{}');
   exception when sqlstate 'PT403' then denied_flag:=true;end;
   if not denied_flag then raise exception 'Role % admitted to %',actor_role,action_name;end if;
  end loop;
 end loop;
 -- D6 uncertified reads retain diagnosis rows and fail closed for focus counts.
 result_data:=pg_temp.diagnosis_call('get_wallet_diagnoses','{"customerIds":["b2500000-0000-4000-8000-000000000001"]}');
 if result_data->'focusCount' is distinct from 'null'::jsonb or result_data->'undiagnosedFocusCount' is distinct from 'null'::jsonb
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
 perform pg_temp.diagnosis_call('record_constraint',('{"requestId":"wallet-diagnosis-d7-diagnosed","opportunityId":"'||third_id||'","category":"price","evidence":"Competitor quote at lower price","confidence":"high","expectedCurrentConstraintId":null}')::jsonb);
 result_data:=pg_temp.diagnosis_call('open_opportunity','{"requestId":"wallet-diagnosis-d8-latest-open","customerId":"b2500000-0000-4000-8000-000000000001","kind":"recover","reason":"Recover account"}');
 perform pg_temp.diagnosis_call('record_constraint',('{"requestId":"wallet-diagnosis-d8-constraint-one","opportunityId":"'||(result_data->>'id')||'","category":"portfolio","evidence":"Assay panel is incomplete","confidence":"medium","expectedCurrentConstraintId":null}')::jsonb);
 newer_constraint:=(pg_temp.diagnosis_call('record_constraint',('{"requestId":"wallet-diagnosis-d8-constraint-two","opportunityId":"'||(result_data->>'id')||'","category":"service","evidence":"Response times exceed target","confidence":"high","expectedCurrentConstraintId":"'||(select c.id from private.stockflow_commercial_constraints c where c.opportunity_id=(result_data->>'id')::uuid order by c.recorded_at desc,c.id desc limit 1)||'"}')::jsonb)->>'id')::uuid;
 result_data:=pg_temp.diagnosis_call('open_opportunity','{"requestId":"wallet-diagnosis-d7-unknown-open","customerId":"b2500000-0000-4000-8000-000000000002","kind":"capture","reason":"Diagnose open account"}');
 perform pg_temp.diagnosis_call('record_constraint',('{"requestId":"wallet-diagnosis-d7-unknown","opportunityId":"'||(result_data->>'id')||'","category":"unknown","evidence":"Ask which instrument is in use","confidence":"low","expectedCurrentConstraintId":null}')::jsonb);
 result_data:=pg_temp.diagnosis_call('get_wallet_diagnoses','{"customerIds":["b2500000-0000-4000-8000-000000000001","b2500000-0000-4000-8000-000000000002","b2500000-0000-4000-8000-000000000003"]}');
 select count(*) into fixture_focus from jsonb_array_elements(private.stockflow_wallet_read((now() at time zone 'Asia/Kolkata')::date)->'rows') as focus_rows(item)
 where (focus_rows.item->>'inFocusBand')::boolean;
 select count(*) into fixture_focus_members from jsonb_array_elements(private.stockflow_wallet_read((now() at time zone 'Asia/Kolkata')::date)->'rows') as fixture_rows(item)
 where fixture_rows.item->>'customerId' in ('b2500000-0000-4000-8000-000000000001','b2500000-0000-4000-8000-000000000002','b2500000-0000-4000-8000-000000000003')
  and (fixture_rows.item->>'inFocusBand')::boolean;
 if fixture_focus_members<>3 or result_data->>'focusCount'<>fixture_focus::text or result_data->>'undiagnosedFocusCount'<>(fixture_focus-1)::text
  or exists(select 1 from private.stockflow_commercial_opportunities opportunity_row where opportunity_row.customer_id not in
   ('b2500000-0000-4000-8000-000000000001','b2500000-0000-4000-8000-000000000002','b2500000-0000-4000-8000-000000000003','b2500000-0000-4000-8000-000000000004'))
  then raise exception 'D7 Focus counts failed: %',result_data;end if;
 -- D8 latest open opportunity and newest constraint are reflected in the list.
 select value into row_value from jsonb_array_elements(result_data->'rows') where value->>'customerId'='b2500000-0000-4000-8000-000000000001';
 if row_value->>'kind'<>'recover' or row_value->>'category'<>'service' then raise exception 'Latest open opportunity/current constraint failed: %',row_value;end if;
 -- D8b a diagnosed older opportunity outranks a newer undiagnosed one.
 diag_four_data:=pg_temp.diagnosis_call('open_opportunity',jsonb_build_object('requestId','wallet-diagnosis-d8b-defend',
  'customerId','b2500000-0000-4000-8000-000000000004','kind','defend','reason','Defend account four'));
 perform pg_temp.diagnosis_call('record_constraint',jsonb_build_object('requestId','wallet-diagnosis-d8b-price',
  'opportunityId',diag_four_data->>'id','category','price','evidence','Competitor quote for account four','confidence','high','expectedCurrentConstraintId',null));
 perform pg_temp.diagnosis_call('open_opportunity',jsonb_build_object('requestId','wallet-diagnosis-d8b-capture',
  'customerId','b2500000-0000-4000-8000-000000000004','kind','capture','reason','Newer capture account four'));
 diag_four_data:=pg_temp.diagnosis_call('get_wallet_diagnoses','{"customerIds":["b2500000-0000-4000-8000-000000000004"]}');
 if diag_four_data#>>'{rows,0,kind}'<>'defend' or diag_four_data#>>'{rows,0,category}'<>'price'
  then raise exception 'D8b diagnosed opportunity must outrank newer undiagnosed opportunity: %',diag_four_data;end if;
 -- D9 command replay stores the initial receipt and produces no duplicate row or audit.
 row_count_before:=(select count(*) from private.stockflow_commercial_opportunities);
 audit_count_before:=(select count(*) from private.stockflow_economic_audit audit_row where audit_row.action='open_opportunity');
 result_data:=pg_temp.diagnosis_call('open_opportunity','{"requestId":"wallet-diagnosis-d9-replay","customerId":"b2500000-0000-4000-8000-000000000004","kind":"recover","reason":"Recovery account"}');
 row_value:=pg_temp.diagnosis_call('open_opportunity','{"requestId":"wallet-diagnosis-d9-replay","customerId":"b2500000-0000-4000-8000-000000000004","kind":"recover","reason":"Recovery account"}');
 if result_data is distinct from row_value or (select count(*) from private.stockflow_commercial_opportunities)<>row_count_before+1
  or (select count(*) from private.stockflow_economic_audit audit_row where audit_row.action='open_opportunity')<>audit_count_before+1 then raise exception 'D9 replay duplicated result or effects';end if;
end$checks$;
rollback;
