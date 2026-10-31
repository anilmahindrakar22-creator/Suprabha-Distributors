-- Fully migrated disposable replay database only. All changes roll back.
-- Grepped every *_concurrency.sql: CMAP-READ / b2e20000 / cmap-read are unused.
begin;
set local timezone='Asia/Kolkata';
insert into private.stockflow_gateway_config(name,secret_sha256)
values('orders',encode(extensions.digest('cmap-read-gateway-key-20261102','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,status)
select 'cmap-read-'||r||'@test.local',r,'active'
from unnest(array['administrator','management','sales','operations','accounts','warehouse','billing','viewer']) r;
insert into public.stockflow_members(email,role,status) values('cmap-read-inactive@test.local','sales','suspended');

create function pg_temp.cmap_id(p_n int) returns uuid language sql immutable as $$
 select ('b2e20000-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid;
$$;
create function pg_temp.cmap_read(p_action text,p_payload jsonb,p_role text default 'management') returns jsonb language sql as $$
 select public.stockflow_customer_map_gateway('cmap-read-gateway-key-20261102','cmap-read-'||p_role||'@test.local',p_action,p_payload);
$$;
create function pg_temp.cmap_sheet(p_n int,p_role text default 'management') returns jsonb language sql as $$
 select pg_temp.cmap_read('get_customer_sheet',jsonb_build_object('customerId',pg_temp.cmap_id(p_n)),p_role);
$$;
create function pg_temp.cmap_pins(p_role text default 'management') returns jsonb language sql as $$
 select pg_temp.cmap_read('get_map_pins','{"south":16,"west":76,"north":18,"east":78}',p_role);
$$;
create function pg_temp.cmap_tone(p_n int,p_role text default 'management') returns text language sql as $$
 select value->>'tone' from jsonb_array_elements(pg_temp.cmap_pins(p_role)->'pins') where value->>'customerId'=pg_temp.cmap_id(p_n)::text;
$$;
create function pg_temp.cmap_error(p_action text,p_payload jsonb,p_state text,p_role text default 'management',
 p_key text default 'cmap-read-gateway-key-20261102') returns void language plpgsql as $$
begin
 begin perform public.stockflow_customer_map_gateway(p_key,'cmap-read-'||p_role||'@test.local',p_action,p_payload);
 exception when others then if sqlstate=p_state then return;end if;raise;end;
 raise exception 'M4 expected SQLSTATE %',p_state;
end$$;
-- Recursively inspect KEYS, not free-text values, including nested arrays.
create function pg_temp.cmap_keys(p_data jsonb) returns setof text language plpgsql as $$
declare v_key text;v_value jsonb;
begin
 if jsonb_typeof(p_data)='object' then
  for v_key,v_value in select key,value from jsonb_each(p_data) loop
   return next v_key;return query select * from pg_temp.cmap_keys(v_value);
  end loop;
 elsif jsonb_typeof(p_data)='array' then
  for v_value in select value from jsonb_array_elements(p_data) loop return query select * from pg_temp.cmap_keys(v_value);end loop;
 end if;
end$$;
create function pg_temp.cmap_opportunity(p_n int,p_kind text default 'capture') returns uuid language plpgsql as $$
declare v_data jsonb;
begin
 v_data:=public.stockflow_opportunity_gateway('cmap-read-gateway-key-20261102','cmap-read-management@test.local','open_opportunity',
  jsonb_build_object('requestId','cmap-read-opportunity-'||p_n||'-'||p_kind,'customerId',pg_temp.cmap_id(p_n),'kind',p_kind,'reason','Customer map fixture'));
 return (v_data->>'id')::uuid;
end$$;
create function pg_temp.cmap_constraint(p_opportunity uuid,p_category text,p_facts jsonb,p_key text) returns uuid language plpgsql as $$
declare v_data jsonb;v_previous uuid;
begin
 select id into v_previous from private.stockflow_commercial_constraints where opportunity_id=p_opportunity order by recorded_at desc,id desc limit 1;
 v_data:=public.stockflow_opportunity_gateway('cmap-read-gateway-key-20261102','cmap-read-management@test.local','record_constraint',
  jsonb_build_object('requestId','cmap-read-constraint-'||p_key,'opportunityId',p_opportunity,'category',p_category,
   'facts',p_facts,'evidence','Customer map fixture evidence','source','our_view','sourcePerson',null,'observedOn',current_date,
   'expectedCurrentConstraintId',v_previous));
 return (v_data->>'id')::uuid;
end$$;
create function pg_temp.cmap_contact(p_n int,p_role text,p_name text) returns uuid language plpgsql as $$
declare v_data jsonb;v_id uuid;
begin
 v_data:=public.stockflow_accounts_gateway('cmap-read-gateway-key-20261102','cmap-read-management@test.local','add_contact',
  jsonb_build_object('idempotencyKey','cmap-read-contact-'||p_n||'-'||p_role,'customerId',pg_temp.cmap_id(p_n),'name',p_name,
   'businessRole','Lab stakeholder','phone','9876543210','email',null));
 v_id:=(v_data->>'contactId')::uuid;
 perform public.stockflow_accounts_gateway('cmap-read-gateway-key-20261102','cmap-read-management@test.local','set_assessment',
  jsonb_build_object('idempotencyKey','cmap-read-assessment-'||p_n||'-'||p_role,'contactId',v_id,'decisionRole',p_role,
   'stance',case when p_role='champion' then 'supporter' else 'neutral' end,'influence','high','reason',null));
 return v_id;
end$$;

-- Reviewed foundation + fulfilment checks, pricing engine and customer-first
-- pricing triggers: seed historical status on INSERT, never bypass transitions.
-- There is no gateway to backdate an order/action; only these historic fixtures
-- use direct INSERT. Commercial opportunity/constraint/contact writes use APIs.
insert into private.stockflow_pricing_policies(policy_version,minimum_margin_percent,target_margin_percent,
 override_approval_percent,rounding_increment,rounding_rule_version,effective_from,active,created_by_email)
values('cmap-read-fixture-policy',20,30,5,1,'cmap-read-rounding',current_date-30,false,'cmap-read-management@test.local');
create function pg_temp.cmap_order(p_n int,p_customer int,p_status text,p_age interval,p_rate numeric default 100,
 p_pending boolean default false,p_exception boolean default true) returns uuid language plpgsql as $$
declare v_order uuid:=pg_temp.cmap_id(1000+p_n);v_line uuid;v_decision uuid;
begin
 insert into private.stockflow_orders(id,order_number,customer_id,customer_name,source,status,idempotency_key,
  created_by_email,updated_by_email,created_at,updated_at)
 values(v_order,'CMAP-READ-ORDER-'||p_n,pg_temp.cmap_id(p_customer),'Customer map order','phone',p_status,
  'cmap-read-order-fixture-'||p_n,'cmap-read-sales@test.local','cmap-read-sales@test.local',now()-p_age,now()-p_age);
 insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,base_unit,quantity,fulfilled_quantity)
 values(v_order,'CMAP-READ-ITEM-'||p_n,'Customer map reagent','Nos',3,case when p_status='delivered' then 3 else 1 end) returning id into v_line;
 if p_rate is not null then
  insert into private.stockflow_order_pricing_decisions(order_id,order_line_id,decision_version,order_version,state,resolution_type,
   proposed_rate,approved_rate,source_type,guardrail_state,pricing_policy_id,pricing_policy_version,rounding_rule_version,
   requested_by_email,requested_at,approved_by_email,approved_at,request_id)
  select v_order,v_line,1,1,case when p_pending then 'pending_approval' else 'approved' end,'price_exception',p_rate,
   case when not p_pending then p_rate end,'manual_review','price_ok',id,policy_version,rounding_rule_version,
   'cmap-read-management@test.local',now()-p_age,case when not p_pending then 'cmap-read-management@test.local' end,
   case when not p_pending then now() end,'cmap-read-pricing-'||p_n
  from private.stockflow_pricing_policies where policy_version='cmap-read-fixture-policy' returning id into v_decision;
  if p_pending then
   update private.stockflow_orders set pricing_state='approval_required' where id=v_order;
   update private.stockflow_order_lines set pricing_state='approval_required' where id=v_line;
   if p_exception then
    insert into private.stockflow_price_exceptions(decision_id,order_id,order_line_id,entered_rate,reason,state,requested_by_email)
    values(v_decision,v_order,v_line,p_rate,'Map pending approval','pending','cmap-read-management@test.local');
   end if;
  else
   update private.stockflow_order_lines set pricing_state='approved',approved_pricing_decision_id=v_decision where id=v_line;
  end if;
 end if;
 return v_order;
end$$;

do $checks$
declare
 v_before jsonb:=pg_temp.cmap_pins();v_data jsonb;v_row jsonb;v_other jsonb;v_bad jsonb;v_wallet jsonb;
 v_n int;v_role text;v_status text;v_opportunity uuid;v_second uuid;v_action uuid;v_due uuid;v_order uuid;v_line uuid;
 v_decider uuid;v_champion uuid;v_installation uuid;v_target uuid;v_territory uuid;v_voucher uuid;
 v_company text;v_month date;v_months date[];v_net bigint;v_start date:=(date_trunc('month',current_date)-interval '3 months')::date;
 v_end date:=date_trunc('month',current_date)::date;v_expected jsonb;
begin
 insert into private.stockflow_customers(id,name,tally_key,city,phone,created_by_email)
 select pg_temp.cmap_id(n),'CMAP-READ Lab '||lpad(n::text,3,'0'),'CMAP-READ-LAB-'||n,'Kalaburagi','9123456789','cmap-read-management@test.local'
 from generate_series(1,34) n;
 for v_n in 1..12 loop
  if v_n=10 then continue;end if;
  perform public.stockflow_accounts_gateway('cmap-read-gateway-key-20261102','cmap-read-management@test.local','set_location',
   jsonb_build_object('idempotencyKey','cmap-read-location-'||v_n,'customerId',pg_temp.cmap_id(v_n),'expectedVersion',null)
   ||case when v_n=9 then jsonb_build_object('precision','town','town','Kalaburagi','source','town')
    else jsonb_build_object('precision','pin','latitude',case when v_n=11 then '19.000000' else '17.000000' end,'longitude','77.000000','source','manual_pin') end);
  -- Inactive placement is seeded while active, then hidden from reads below.
 end loop;
 update private.stockflow_customers set active=false where id=pg_temp.cmap_id(12);
 -- M1: bounds, pin precision, coverage and unplaced pagination.
 v_data:=pg_temp.cmap_pins();
 if (select count(*) from jsonb_array_elements(v_data->'pins') where value->>'customerId' like 'b2e20000-%')<>8
  or exists(select 1 from jsonb_array_elements(v_data->'pins') where value->>'customerId' in
   (pg_temp.cmap_id(9)::text,pg_temp.cmap_id(10)::text,pg_temp.cmap_id(11)::text,pg_temp.cmap_id(12)::text))
  or (v_data#>>'{coverage,total}')::bigint<>(v_before#>>'{coverage,total}')::bigint+33
  or (v_data#>>'{coverage,placed}')::bigint<>(v_before#>>'{coverage,placed}')::bigint+9
  or (v_data->>'notOnMapCount')::bigint<>(v_before->>'notOnMapCount')::bigint+24 then raise exception 'M1 bounds or coverage';end if;
 perform pg_temp.cmap_read('get_map_pins','{"south":15.4,"west":75.0,"north":18.6,"east":77.9}');
 raise notice 'PASS M1 bbox: exact MARKET_AREA (15.4, 75.0, 18.6, 77.9) accepted';
 perform pg_temp.cmap_read('get_map_pins','{"south":14,"west":74,"north":18,"east":78}');
 raise notice 'PASS M1 bbox: exactly 4 degrees in both dimensions accepted';
 perform pg_temp.cmap_error('get_map_pins','{"south":14,"west":75,"north":18.01,"east":77}','22023');
 perform pg_temp.cmap_error('get_map_pins','{"south":16,"west":74,"north":18,"east":78.01}','22023');
 raise notice 'PASS M1 bbox: 4.01-degree latitude and longitude boxes rejected with 22023';
 v_data:=pg_temp.cmap_read('get_not_on_map','{"page":1,"query":"CMAP-READ Lab"}');
 v_other:=pg_temp.cmap_read('get_not_on_map','{"page":2,"query":"CMAP-READ Lab"}');
 if v_data->>'total'<>'24' or jsonb_array_length(v_data->'rows')<>20 or jsonb_array_length(v_other->'rows')<>4
  or v_data#>>'{rows,0,customerId}'<>pg_temp.cmap_id(9)::text
  or v_data#>>'{rows,1,customerId}'<>pg_temp.cmap_id(10)::text
  or exists(select 1 from jsonb_array_elements(v_data->'rows') a join jsonb_array_elements(v_other->'rows') b on a.value->>'customerId'=b.value->>'customerId')
  then raise exception 'M1 unplaced paging';end if;
 begin
  insert into private.stockflow_customers(id,name,tally_key,created_by_email)
  select pg_temp.cmap_id(5000+n),'!CMAP-READ cap '||lpad(n::text,3,'0'),'CMAP-READ-CAP-'||n,'cmap-read-management@test.local'
  from generate_series(1,501) n;
  for v_n in 1..501 loop
   perform public.stockflow_accounts_gateway('cmap-read-gateway-key-20261102','cmap-read-management@test.local','set_location',
    jsonb_build_object('idempotencyKey','cmap-read-cap-pin-'||v_n,'customerId',pg_temp.cmap_id(5000+v_n),'expectedVersion',null,
     'precision','pin','latitude','-79.500000','longitude','-169.500000','source','manual_pin'));
  end loop;
  v_data:=pg_temp.cmap_read('get_map_pins','{"south":-80,"west":-170,"north":-79,"east":-169}');
  if (select count(*) from jsonb_array_elements(v_data->'pins') where value->>'name' like '!CMAP-READ cap %')<>500
   or exists(select 1 from jsonb_array_elements(v_data->'pins') where value->>'customerId'=pg_temp.cmap_id(5501)::text)
   then raise exception 'M1 deterministic 500 pin cap';end if;
  raise exception 'Rollback cap fixture' using errcode='PT001';
 exception when sqlstate 'PT001' then null;end;
 raise notice 'PASS M1: bounds, precision, coverage and unplaced pagination';

 -- M2: each first-match tone, true wallet certification and U3 boundaries.
 foreach v_n in array array[2,3,4,6,7,8] loop perform pg_temp.cmap_contact(v_n,'decision_maker','CMAP Decider '||v_n);end loop;
 foreach v_n in array array[1,4,5,6] loop
  perform public.stockflow_wallet_gateway('cmap-read-gateway-key-20261102','cmap-read-management@test.local','record_wallet_snapshot',
   jsonb_build_object('requestId','cmap-read-wallet-'||v_n,'customerId',pg_temp.cmap_id(v_n),
    'monthlyWalletPaise',case when v_n=4 then 9000000000000000::bigint else 1000 end,'method','manager_estimate',
    'source','Map fixture source','confidence','medium','asOf',current_date,'note','Map fixture estimate','loweredReason',null,
    'divisions','[]'::jsonb,'expectedCurrentSnapshotId',null));
  insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
  values('cmap-read-company','CMAP-READ-LAB-'||v_n,pg_temp.cmap_id(v_n),'cmap-read-management@test.local');
  if v_n<>4 then
   insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,kind,evidence)
   values('cmap-read-company','cmap-read-sale-'||v_n,1,v_start+2,'CMAP-READ-LAB-'||v_n,'sale','{}') returning id into v_voucher;
   insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
   values(v_voucher,'1','cmap-read-product',1,'Nos',2400,'{}');
  end if;
 end loop;
 -- Like Today and wallet replay: certify all linked companies with their actual
 -- reconciliation totals. Assertions below concern only CMAP fixture customers.
 v_months:=array[v_start,(v_start+interval '1 month')::date,(v_start+interval '2 months')::date];
 for v_company in select distinct company_id from private.stockflow_economic_customer_identities loop
  insert into private.stockflow_economic_source_coverage(company_id,window_from,window_to,source_version,imported_at)
  values(v_company,v_start,v_end,'cmap-read-certified',clock_timestamp()+interval '1 day');
  insert into private.stockflow_sales_control_imports(company_id,source_version,valid_months,imported_at)
  values(v_company,'cmap-read-certified',v_months,clock_timestamp()+interval '1 day');
  foreach v_month in array v_months loop
   v_net:=(private.stockflow_sales_reconciliation(v_company,v_month)->>'appNetPaise')::bigint;
   insert into private.stockflow_sales_control_totals(company_id,month,kind,source_key,net_paise,source_version,imported_at)
   values(v_company,v_month,'sales_ledger','sales',v_net,'cmap-read-certified',clock_timestamp()+interval '1 day');
  end loop;
 end loop;
 v_wallet:=private.stockflow_wallet_read(current_date);
 if v_wallet#>>'{coverage,certified}' is distinct from 'true' then raise exception 'M2 certification setup';end if;
 v_opportunity:=pg_temp.cmap_opportunity(1);
 insert into private.stockflow_commercial_actions(opportunity_id,action_type,detail,owner_email,due_on,created_by)
 values(v_opportunity,'visit','Map overdue visit','cmap-read-sales@test.local',current_date-1,'cmap-read-management@test.local') returning id into v_action;
 v_order:=pg_temp.cmap_order(1,2,'packed',interval '25 hours');
 v_opportunity:=pg_temp.cmap_opportunity(3);
 perform pg_temp.cmap_constraint(v_opportunity,'competitor_lock_in',jsonb_build_object('competitor','CMAP competitor','endsOn',current_date+30),'deadline');
 v_order:=pg_temp.cmap_order(2,8,'packed',interval '25 hours',250,true);
 if pg_temp.cmap_tone(1) is distinct from 'red' or pg_temp.cmap_tone(2) is distinct from 'red'
  or pg_temp.cmap_tone(3) is distinct from 'amber' or pg_temp.cmap_tone(4) is distinct from 'amber'
  or pg_temp.cmap_tone(5) is distinct from 'amber' or pg_temp.cmap_tone(6) is distinct from 'green'
  or pg_temp.cmap_tone(7) is distinct from 'grey' or pg_temp.cmap_tone(8) is distinct from 'grey'
  then raise exception 'M2 first-match tones';end if;
 select value into v_row from jsonb_array_elements(pg_temp.cmap_pins()->'pins') where value->>'customerId'=pg_temp.cmap_id(4)::text;
 if v_row->>'focus' is distinct from 'true' then raise exception 'M2 Focus fixture';end if;
 v_second:=pg_temp.cmap_opportunity(4);
 perform pg_temp.cmap_constraint(v_second,'service',jsonb_build_object('issue','Map service issue','since',current_date),'focus-known');
 if pg_temp.cmap_tone(4) is distinct from 'grey' then raise exception 'M2 known Focus diagnosis';end if;
 v_data:=public.stockflow_action_gateway('cmap-read-gateway-key-20261102','cmap-read-management@test.local','create_action',
  jsonb_build_object('requestId','cmap-read-deadline-plan','opportunityId',v_opportunity,'actionType','visit','detail','Map deadline plan',
   'ownerEmail','cmap-read-sales@test.local','dueOn',current_date,'expectedMonthlyGainPaise',null));
 if pg_temp.cmap_tone(3) is distinct from 'grey' or pg_temp.cmap_tone(3,'sales') is distinct from 'grey' then raise exception 'M2 planned deadline';end if;
 perform public.stockflow_action_gateway('cmap-read-gateway-key-20261102','cmap-read-management@test.local','close_action',
  jsonb_build_object('requestId','cmap-read-deadline-done','actionId',v_data->>'id','result','done','note','Map plan completed'));
 if pg_temp.cmap_tone(3,'sales') is distinct from 'amber' then raise exception 'M2 closed plan must not count';end if;
 perform pg_temp.cmap_constraint(v_opportunity,'service',jsonb_build_object('issue','Map service issue','since',current_date),'deadline-replaced');
 if pg_temp.cmap_tone(3) is distinct from 'grey' then raise exception 'M2 stale constraint deadline';end if;
 v_n:=100;
 foreach v_status in array array['awaiting_approval','partially_reserved','packed','ready_for_picking'] loop
  v_n:=v_n+1;
  begin
   perform pg_temp.cmap_order(v_n,6,v_status,interval '24 hours');
   if pg_temp.cmap_tone(6) is distinct from 'green' then raise exception 'M2 exact 24h not stuck';end if;
   perform pg_temp.cmap_order(v_n+10,6,v_status,interval '24 hours 1 second');
   if pg_temp.cmap_tone(6) is distinct from 'red' then raise exception 'M2 U3 red beats green: %',v_status;end if;
   raise exception 'Rollback U3 fixture' using errcode='PT001';
  exception when sqlstate 'PT001' then null;end;
 end loop;
 begin
  perform pg_temp.cmap_order(120,7,'confirmed',interval '72 hours');
  perform pg_temp.cmap_order(121,7,'delivered',interval '72 hours');
  perform pg_temp.cmap_order(122,7,'cancelled',interval '72 hours');
  v_order:=pg_temp.cmap_order(123,7,'packed',interval '72 hours');
  update private.stockflow_orders set archived_at=now() where id=v_order;
  if pg_temp.cmap_tone(7) is distinct from 'grey' then raise exception 'M2 non-U3 or archived order';end if;
  perform pg_temp.cmap_order(124,7,'packed',interval '25 hours',100,true,false);
  if pg_temp.cmap_tone(7) is distinct from 'red' then raise exception 'M2 pending without exception cannot suppress U3';end if;
  raise exception 'Rollback non-U3 fixture' using errcode='PT001';
 exception when sqlstate 'PT001' then null;end;
 begin
  insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
  values('cmap-read-uncertified','CMAP-READ-LAB-7',pg_temp.cmap_id(7),'cmap-read-management@test.local');
  if pg_temp.cmap_tone(6) is distinct from 'grey' then raise exception 'M2 uncertified green';end if;
  raise exception 'Rollback coverage fixture' using errcode='PT001';
 exception when sqlstate 'PT001' then null;end;
 raise notice 'PASS M2: first-match tones, certification, current diagnosis, plans and exact U3';

 -- M4: gateway validation, membership and least-privilege grants.
 for v_bad in select value from jsonb_array_elements('[{},null,[],{"south":"16","west":76,"north":18,"east":78},
   {"south":16,"west":76,"north":20.01,"east":78},{"south":16,"west":76,"north":18,"east":80.01},
  {"south":18,"west":76,"north":16,"east":78},{"south":16,"west":78,"north":18,"east":76},
  {"south":91,"west":76,"north":92,"east":78},{"south":16,"west":181,"north":18,"east":182},
  {"south":16,"west":76,"north":18,"east":78,"extra":true}]'::jsonb) loop
  perform pg_temp.cmap_error('get_map_pins',v_bad,'22023');
 end loop;
 perform pg_temp.cmap_error('get_not_on_map','{"page":0}','22023');
 perform pg_temp.cmap_error('get_not_on_map','{"page":1.5}','22023');
 perform pg_temp.cmap_error('get_not_on_map','{"page":4001}','22023');
 perform pg_temp.cmap_error('get_not_on_map','{"page":1,"query":null}','22023');
 perform pg_temp.cmap_error('get_customer_sheet','{"customerId":"bad"}','22023');
 perform pg_temp.cmap_error('get_customer_sheet',jsonb_build_object('customerId',pg_temp.cmap_id(12)),'22023');
 perform pg_temp.cmap_error('write_map','{}','22023');
 perform pg_temp.cmap_error('get_map_pins','{}','42501','management','cmap-read-invalid-gateway');
 foreach v_role in array array['accounts','warehouse','billing','viewer','inactive','missing'] loop
  perform pg_temp.cmap_error('get_map_pins','{}','PT403',v_role);
  perform pg_temp.cmap_error('get_not_on_map','{"page":1}','PT403',v_role);
  perform pg_temp.cmap_error('get_customer_sheet',jsonb_build_object('customerId',pg_temp.cmap_id(1)),'PT403',v_role);
 end loop;
 if has_function_privilege('anon','public.stockflow_customer_map_gateway(text,text,text,jsonb)','EXECUTE')
  or has_function_privilege('authenticated','public.stockflow_customer_map_gateway(text,text,text,jsonb)','EXECUTE')
  or not has_function_privilege('service_role','public.stockflow_customer_map_gateway(text,text,text,jsonb)','EXECUTE')
  or has_function_privilege('service_role','private.stockflow_customer_map_orders(text,text[],uuid,boolean)','EXECUTE') then raise exception 'M4 grants';end if;
 raise notice 'PASS M4: strict payloads, key, membership and grants';

 -- M5: open work cap, pending proposed value, delivered recency, earliest action,
 -- assignment, published class, latest visit and action-bar source fields.
 perform pg_temp.cmap_order(3,8,'confirmed',interval '3 hours',100);
 perform pg_temp.cmap_order(4,8,'confirmed',interval '2 hours',null);
 perform pg_temp.cmap_order(5,8,'confirmed',interval '1 hour',200);
 for v_n in 6..9 loop perform pg_temp.cmap_order(v_n,8,'delivered',make_interval(days=>v_n),100+v_n);end loop;
 perform pg_temp.cmap_order(10,8,'cancelled',interval '1 hour');
 v_order:=pg_temp.cmap_order(11,8,'confirmed',interval '1 hour');
 update private.stockflow_orders set archived_at=now() where id=v_order;
 v_opportunity:=pg_temp.cmap_opportunity(8);
 v_second:=pg_temp.cmap_opportunity(8,'defend');
 v_data:=public.stockflow_action_gateway('cmap-read-gateway-key-20261102','cmap-read-management@test.local','create_action',
  jsonb_build_object('requestId','cmap-read-later-action','opportunityId',v_opportunity,'actionType','visit','detail','Map later visit',
   'ownerEmail','cmap-read-sales@test.local','dueOn',current_date+2,'expectedMonthlyGainPaise',12345));
 v_data:=public.stockflow_action_gateway('cmap-read-gateway-key-20261102','cmap-read-management@test.local','create_action',
  jsonb_build_object('requestId','cmap-read-earliest-action','opportunityId',v_second,'actionType','visit','detail','Map earliest visit',
   'ownerEmail','cmap-read-sales@test.local','dueOn',current_date,'expectedMonthlyGainPaise',12345));
 v_due:=(v_data->>'id')::uuid;
 v_data:=public.stockflow_accounts_gateway('cmap-read-gateway-key-20261102','cmap-read-management@test.local','create_territory',
  '{"idempotencyKey":"cmap-read-territory-create","name":"CMAP-READ Territory"}');
 v_territory:=(v_data#>>'{territory,id}')::uuid;
 perform public.stockflow_accounts_gateway('cmap-read-gateway-key-20261102','cmap-read-management@test.local','assign_account',
  jsonb_build_object('idempotencyKey','cmap-read-owner-assign','customerId',pg_temp.cmap_id(8),'ownerEmail','cmap-read-sales@test.local','territoryId',v_territory,'expectedVersion',null));
 perform public.stockflow_accounts_gateway('cmap-read-gateway-key-20261102','cmap-read-management@test.local','log_visit',
  jsonb_build_object('idempotencyKey','cmap-read-visit-old','customerId',pg_temp.cmap_id(8),'visitedOn',current_date-2,'outcome','met','note',null,'nextVisitOn',null));
 perform public.stockflow_accounts_gateway('cmap-read-gateway-key-20261102','cmap-read-management@test.local','log_visit',
  jsonb_build_object('idempotencyKey','cmap-read-visit-latest','customerId',pg_temp.cmap_id(8),'visitedOn',current_date-1,'outcome','order_taken','note',null,'nextVisitOn',null));
 v_data:=pg_temp.cmap_sheet(8);
 if jsonb_array_length(v_data->'openWork')<>3 or v_data#>>'{openWork,0,kind}'<>'price'
  or v_data#>>'{openWork,0,approximate}'<>'true' or v_data#>>'{openWork,0,valuePaise}'<>'75000'
  or v_data#>>'{openWork,1,valuePaise}'<>'20000' or v_data#>>'{openWork,2,valuePaise}' is not null
  or v_data#>>'{nextAction,id}'<>v_due::text or v_data#>>'{nextAction,canPlan}'<>'true'
  or v_data#>>'{tiles,lastVisit,visitedOn}'<>(current_date-1)::text
  or v_data#>>'{owner,email}'<>'cmap-read-sales@test.local' or v_data->>'town'<>'Kalaburagi'
  or v_data#>>'{actions,pin}'<>'move' or v_data#>>'{actions,call}'<>'tel:9876543210' then raise exception 'M5 sheet fields: %',v_data;end if;
 select jsonb_agg(value->>'orderId' order by ordinality) into v_expected from jsonb_array_elements(v_data->'recentOrders') with ordinality;
 if v_expected is distinct from jsonb_build_array(pg_temp.cmap_id(1006)::text,pg_temp.cmap_id(1007)::text,pg_temp.cmap_id(1008)::text)
  or v_data#>>'{recentOrders,0,valuePaise}'<>'31800' then raise exception 'M5 recent delivered orders';end if;
 v_data:=pg_temp.cmap_sheet(8,'sales');
 if v_data#>>'{tiles,openOrders}'<>'4' or v_data#>>'{tiles,overdue}'<>'0' or v_data#>>'{nextAction,canDone}'<>'true'
  or v_data#>>'{nextAction,canPlan}'<>'false' or v_data#>>'{tiles,nextActionDue}'<>current_date::text then raise exception 'M5 operational tiles';end if;
 v_opportunity:=pg_temp.cmap_opportunity(5);
 perform pg_temp.cmap_constraint(v_opportunity,'price',jsonb_build_object('competitor','Map competitor','product','Map reagent',
  'competitorPricePaise',100,'ourPricePaise',200),'unproven-price');
 if pg_temp.cmap_sheet(5,'sales')#>>'{heldBackBy,label}' is distinct from 'Price (not proven)'
  then raise exception 'M5 unproven price label';end if;
 perform public.stockflow_action_gateway('cmap-read-gateway-key-20261102','cmap-read-management@test.local','close_action',
  jsonb_build_object('requestId','cmap-read-earliest-done','actionId',v_due,'result','done','note','Map first visit complete'));
 if pg_temp.cmap_sheet(8)#>>'{nextAction,dueOn}'<>(current_date+2)::text then raise exception 'M5 closed action';end if;
 raise notice 'PASS M5: sheet work, customer rates, recent orders, actions, owner and visit';

 -- M7: use the real contacts/assessment/influence gateways and route read.
 select id into v_decider from private.stockflow_account_contacts where customer_id=pg_temp.cmap_id(7) and removed_at is null;
 v_champion:=pg_temp.cmap_contact(7,'champion','CMAP Champion');
 perform public.stockflow_power_map_gateway('cmap-read-gateway-key-20261102','cmap-read-management@test.local','set_influence',
  jsonb_build_object('requestId','cmap-read-influence-route','customerId',pg_temp.cmap_id(7),'fromContactId',v_champion,
   'toContactId',v_decider,'strength','strong','evidence','Map champion reaches decider'));
 v_data:=pg_temp.cmap_sheet(7);
 v_other:=public.stockflow_power_map_gateway('cmap-read-gateway-key-20261102','cmap-read-management@test.local','get_power_map',jsonb_build_object('customerId',pg_temp.cmap_id(7)));
 if v_data->'route' is distinct from v_other->'route' or v_data#>>'{decisionMaker,contactId}'<>v_decider::text
  or v_data#>>'{decisionMaker,stance}'<>'neutral' or v_data#>>'{route,steps,0,decisionRole}'<>'champion'
  or v_data#>>'{contacts,total}'<>'2' or v_data#>>'{contacts,champions}'<>'1'
  or pg_temp.cmap_sheet(10)#>>'{decisionMaker,label}'<>'No decider known' then raise exception 'M7 power map';end if;
 raise notice 'PASS M7: decider, stance, champion route and missing-decider row';

 -- M8: installation triggers reviewed (register identity assignment, placement
 -- lock/overlap guard). Complete through the gateway; create a target through
 -- Economics. Scheduled installations must not appear as ours.
 v_order:=pg_temp.cmap_order(20,1,'delivered',interval '60 days');
 insert into private.stockflow_equipment_installations(order_id,tally_key,item_name,scheduled_date,created_by_email)
 values(v_order,'CMAP-READ-ITEM-20','CMAP analyser',current_date-60,'cmap-read-management@test.local') returning id into v_installation;
 perform public.stockflow_installation_gateway('cmap-read-gateway-key-20261102','cmap-read-management@test.local','complete_installation',
  jsonb_build_object('orderId',v_order,'expectedVersion',(select version from private.stockflow_orders where id=v_order),
   'installationId',v_installation,'serialNumber','CMAP-READ-SERIAL-20','commissioningNotes','Map commissioned analyser','idempotencyKey','cmap-read-commission-20'));
 v_data:=public.stockflow_economics_gateway('cmap-read-gateway-key-20261102','cmap-read-management@test.local','create_target',
  jsonb_build_object('idempotencyKey','cmap-read-target-create','kind','placement','name','CMAP placement','companyId','cmap-read-company',
   'customerId',pg_temp.cmap_id(1),'customerSourceId','CMAP-READ-LAB-1','siteId','CMAP site','modelId','CMAP analyser model',
   'installationId',v_installation,'effectiveFrom',current_date-60));
 select id into v_target from private.stockflow_economic_targets where installation_id=v_installation;
 if v_target is null then raise exception 'M8 target fixture';end if;
 v_opportunity:=(select id from private.stockflow_commercial_opportunities where customer_id=pg_temp.cmap_id(1) and kind='capture');
 perform pg_temp.cmap_constraint(v_opportunity,'instrument','{"analyser":"CMAP competitor analyser","owner":"competitor_placed","closedSystem":"yes","division":"BIOCHEM"}','instrument');
 v_second:=pg_temp.cmap_opportunity(1,'defend');
 perform pg_temp.cmap_constraint(v_second,'competitor_lock_in',jsonb_build_object('competitor','CMAP competing supplier','endsOn',current_date+15),'lock-in');
 v_data:=pg_temp.cmap_sheet(1);
 v_other:=public.stockflow_economics_gateway('cmap-read-gateway-key-20261102','cmap-read-management@test.local','get_instrument_economics','{"view":"summary"}');
 select value into v_row from jsonb_array_elements(v_other->'targets') where value->>'id'=v_target::text;
 if jsonb_array_length(v_data#>'{instruments,rows}')<>3 or v_data#>>'{instruments,rows,0,serial}'<>'CMAP-READ-SERIAL-20'
  or v_data#>>'{instruments,rows,0,model}'<>'CMAP analyser model' or v_data#>>'{instruments,rows,0,placedOn}'<>(current_date-60)::text
  or v_data#>>'{instruments,rows,0,payback}' is distinct from (case v_row#>>'{forecastReview,status}' when 'within_limit' then 'Paying back'
   when 'review_required' then 'Behind' when 'limit_exceeded' then 'Behind' when 'non_positive_gp' then 'Behind' else 'Awaiting data' end)
  or v_data#>>'{instruments,rows,1,analyser}'<>'CMAP competitor analyser' or v_data#>>'{instruments,rows,1,closedSystem}'<>'yes'
  or v_data#>>'{instruments,rows,2,daysLeft}'<>'15' then raise exception 'M8 instruments: %',v_data;end if;
 insert into private.stockflow_equipment_installations(order_id,tally_key,item_name,scheduled_date,created_by_email)
 values(v_order,'CMAP-READ-SCHEDULED','CMAP scheduled only',current_date+1,'cmap-read-management@test.local');
 if pg_temp.cmap_sheet(1)->'instruments' is distinct from v_data->'instruments' then raise exception 'M8 scheduled instrument included';end if;
 -- Register without a target: still visible, Awaiting data, combined cap +n.
 insert into private.stockflow_equipment_installations(order_id,tally_key,item_name,status,scheduled_date,serial_number,created_by_email,completed_at)
 values(v_order,'CMAP-READ-NO-TARGET','CMAP no target','completed',current_date-1,'CMAP-READ-SERIAL-21','cmap-read-management@test.local',now());
 if pg_temp.cmap_sheet(1)#>>'{instruments,moreCount}'<>'1' then raise exception 'M8 register-only or row cap';end if;
 if not exists(select 1 from jsonb_array_elements(pg_temp.cmap_sheet(1)#>'{instruments,rows}')
  where value->>'serial'='CMAP-READ-SERIAL-21' and value->>'payback'='Awaiting data') then raise exception 'M8 register-only status';end if;
 perform pg_temp.cmap_constraint(v_opportunity,'service',jsonb_build_object('issue','New map service issue','since',current_date),'instrument-replaced');
 if exists(select 1 from jsonb_array_elements(pg_temp.cmap_sheet(1)#>'{instruments,rows}') where value ? 'analyser')
  then raise exception 'M8 superseded instrument facts';end if;
 v_data:=pg_temp.cmap_sheet(10);
 if v_data ? 'instruments' or v_data ? 'openWork' or v_data ? 'recentOrders' or v_data ? 'nextAction'
  or v_data ? 'contacts' or v_data ? 'heldBackBy' or v_data ? 'class' or v_data#>>'{actions,pin}'<>'place'
  or v_data#>>'{actions,call}'<>'tel:9123456789' then raise exception 'M8 empty section decluttering';end if;
 update private.stockflow_customers set phone=null where id=pg_temp.cmap_id(34);
 if pg_temp.cmap_sheet(34)#>'{actions}' ? 'call' then raise exception 'M8 missing phone invented call';end if;
 raise notice 'PASS M8: ours, targets, canonical payback, theirs, countdown and empty sections';

 -- M3/M6 after every populated section exists: recursive projections, all roles.
 foreach v_role in array array['administrator','management','sales','operations'] loop
  v_data:=pg_temp.cmap_pins(v_role);
  select jsonb_agg(value) into v_data from jsonb_array_elements(v_data->'pins') where value->>'customerId' like 'b2e20000-%';
  for v_n in 1..10 loop v_data:=v_data||jsonb_build_array(pg_temp.cmap_sheet(v_n,v_role));end loop;
  if exists(select 1 from pg_temp.cmap_keys(v_data) k where k ~* '(cost|margin|gross|purchase)') then raise exception 'M6 forbidden key for %',v_role;end if;
  if v_role in ('sales','operations') then
   if exists(select 1 from pg_temp.cmap_keys(v_data) k where k ~* '(paise|wallet|sales|share|gap|payback|amount|rate|price)'
    and k<>'priceUnproven') then raise exception 'M3 financial key for %',v_role;end if;
   if pg_temp.cmap_tone(6,v_role) is distinct from 'green' or pg_temp.cmap_tone(1,v_role) is distinct from 'red' then raise exception 'M3 lost tones';end if;
  else
   if not (pg_temp.cmap_sheet(6)#>'{tiles}' ?& array['walletPaise','salesPaise','gapPaise'])
    or not (pg_temp.cmap_sheet(6) ? 'sharePermille') then raise exception 'M3 missing financial fields';end if;
  end if;
 end loop;
 raise notice 'PASS M3: operational tones with all financial keys omitted';
 raise notice 'PASS M6: no cost, margin, gross or purchase keys at any depth';
end$checks$;
rollback;
