begin;

insert into private.stockflow_gateway_config(name,secret_sha256)
values('orders',encode(extensions.digest('contract-windows-test-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,status) values
 ('contract-manager@test.local','management','active'),
 ('contract-admin@test.local','administrator','active'),
 ('contract-sales@test.local','sales','active'),
 ('contract-operations@test.local','operations','active');

-- b2c10000 is distinct from all *_concurrency.sql fixture prefixes.
-- Only customer/member setup is inserted directly; business history uses gateways.
create temporary table contract_window_fixtures (
 fixture_no int primary key,customer_id uuid not null,opportunity_id uuid not null,
 constraint_id uuid not null,ends_on date not null
) on commit drop;

create function pg_temp.contract_windows_read() returns jsonb language plpgsql as $$
declare v_page int:=1; v_response jsonb; v_first jsonb; v_rows jsonb:='[]'::jsonb; v_fixture_rows jsonb;
begin
 loop
  v_response:=public.stockflow_contract_window_gateway('contract-windows-test-key','contract-manager@test.local',
   'get_contract_windows',jsonb_build_object('page',v_page));
  if v_response->>'page' is distinct from v_page::text or v_response->>'pageSize' is distinct from '20'
   or jsonb_typeof(v_response->'rows') is distinct from 'array' then raise exception 'C7 invalid page envelope';end if;
  if jsonb_array_length(v_response->'rows')>20 then raise exception 'C7 page exceeds 20 rows';end if;
  if v_page=1 then v_first:=v_response;end if;
  select coalesce(jsonb_agg(r.value order by r.ordinality),'[]'::jsonb) into v_fixture_rows
  from jsonb_array_elements(v_response->'rows') with ordinality r(value,ordinality)
  where exists(select 1 from contract_window_fixtures f where f.customer_id::text=r.value->>'customerId');
  -- Check our response rows and the public envelope, not unrelated fixture text.
  if (v_response-'rows')::text ~* '(paise|wallet)' or v_fixture_rows::text ~* '(paise|wallet)' then
   raise exception 'C7 response exposes money or wallet data';
  end if;
  v_rows:=v_rows||v_fixture_rows;
  exit when v_page*20>=(v_response->>'total')::bigint;
  if v_page>=4000 then raise exception 'Fixture pagination exceeded gateway limit';end if;
  v_page:=v_page+1;
 end loop;
 return v_first||jsonb_build_object('rows',v_rows);
end$$;

create function pg_temp.contract_windows_error(p_payload jsonb,p_expected text,
 p_actor text default 'contract-manager@test.local',p_key text default 'contract-windows-test-key',
 p_action text default 'get_contract_windows') returns void language plpgsql as $$
begin
 begin
  perform public.stockflow_contract_window_gateway(p_key,p_actor,p_action,p_payload);
 exception when others then
  if sqlstate=p_expected then return;end if;
  raise;
 end;
 raise exception 'C6 expected SQLSTATE % for payload %',p_expected,p_payload;
end$$;

do $checks$
declare
 v_today date:=(now() at time zone 'Asia/Kolkata')::date;
 v_i int; v_days int; v_customer uuid; v_opportunity uuid; v_constraint uuid;
 v_category text; v_facts jsonb; v_source text; v_source_person text;
 v_output jsonb; v_row jsonb; v_bad_payload jsonb;
 v_at_end_action uuid; v_before_end_action uuid; v_baseline bigint;
 v_actual jsonb; v_expected jsonb;
begin
 -- Thirty fixture customers ensure the final unplanned set spans multiple pages.
 for v_i in 1..30 loop
  v_customer:=('b2c10000-0000-4000-8000-'||lpad(v_i::text,12,'0'))::uuid;
  insert into private.stockflow_customers(id,name,city,tally_key,created_by_email)
  values(v_customer,case when v_i in (11,12) then 'Contract Tie' else 'Contract Lab '||lpad(v_i::text,2,'0') end,
   'Pune','contract-window-fixture-'||v_i,'contract-manager@test.local');
  v_output:=public.stockflow_opportunity_gateway('contract-windows-test-key','contract-manager@test.local',
   'open_opportunity',jsonb_build_object('requestId','contract-windows-open-'||v_i,
    'customerId',v_customer,'kind','capture','reason','Contract window fixture'));
  v_opportunity:=(v_output->>'id')::uuid;
  v_days:=case v_i when 1 then 60 when 2 then 60 when 3 then 60 when 4 then 121 when 5 then -31
   when 6 then -10 when 7 then 40 when 8 then 45 when 9 then -30 when 10 then 120 else 20 end;
  v_category:=case when v_i=6 then 'contract_tender' else 'competitor_lock_in' end;
  v_facts:=jsonb_build_object(case when v_i=6 then 'holder' else 'competitor' end,
   case when v_i=6 then 'Tender Holder' else 'Competitor Labs' end,'endsOn',v_today+v_days);
  v_source:=case when v_i=6 then 'customer_stated' else 'document' end;
  v_source_person:=case when v_i=6 then 'Lab Director' else null end;
  v_output:=public.stockflow_opportunity_gateway('contract-windows-test-key','contract-manager@test.local',
   'record_constraint',jsonb_build_object('requestId','contract-windows-constraint-'||v_i,
    'opportunityId',v_opportunity,'category',v_category,'evidence','Contract end confirmed for fixture',
    'source',v_source,'sourcePerson',v_source_person,'observedOn',v_today,'facts',v_facts,'expectedCurrentConstraintId',null));
  insert into contract_window_fixtures values(v_i,v_customer,v_opportunity,(v_output->>'id')::uuid,v_today+v_days);
 end loop;

 -- C1: unplanned lock-in returns the customer, opportunity, party and 60 days left.
 v_output:=pg_temp.contract_windows_read();
 select r.value into v_row from jsonb_array_elements(v_output->'rows') r(value)
 where r.value->>'customerId'='b2c10000-0000-4000-8000-000000000001';
 select opportunity_id into v_opportunity from contract_window_fixtures where fixture_no=1;
 if v_row is distinct from jsonb_build_object('customerId','b2c10000-0000-4000-8000-000000000001',
  'customerName','Contract Lab 01','town','Pune','opportunityId',v_opportunity,'kind','capture',
  'divisionName',null,'category','competitor_lock_in','party','Competitor Labs','endsOn',v_today+60,
  'daysLeft',60,'confidence','high','source','document') then raise exception 'C1 incorrect lock-in row: %',v_row;end if;
 raise notice 'PASS C1: unplanned lock-in details';

 -- C2: due on or before the end is planned; due after the end stays unplanned.
 v_baseline:=(v_output->>'plannedCount')::bigint;
 for v_i in 1..3 loop
  select opportunity_id into v_opportunity from contract_window_fixtures where fixture_no=v_i;
  v_output:=public.stockflow_action_gateway('contract-windows-test-key','contract-manager@test.local','create_action',
   jsonb_build_object('requestId','contract-windows-create-action-'||v_i,'opportunityId',v_opportunity,
    'actionType','visit','detail','Discuss contract renewal','ownerEmail','contract-sales@test.local',
    'dueOn',v_today+case v_i when 1 then 60 when 2 then 59 else 61 end,'expectedMonthlyGainPaise',null));
  if v_i=1 then v_at_end_action:=(v_output->>'id')::uuid;end if;
  if v_i=2 then v_before_end_action:=(v_output->>'id')::uuid;end if;
 end loop;
 v_output:=pg_temp.contract_windows_read();
 if (v_output->>'plannedCount')::bigint is distinct from v_baseline+2 then raise exception 'C2 planned count did not increase by two';end if;
 if exists(select 1 from jsonb_array_elements(v_output->'rows') r(value)
  where r.value->>'customerId' in ('b2c10000-0000-4000-8000-000000000001','b2c10000-0000-4000-8000-000000000002'))
  or not exists(select 1 from jsonb_array_elements(v_output->'rows') r(value)
   where r.value->>'customerId'='b2c10000-0000-4000-8000-000000000003') then raise exception 'C2 planned/unplanned classification failed';end if;
 raise notice 'PASS C2: action due before, on and after contract end';

 -- C3: completed (or dropped) actions no longer make a window planned.
 perform public.stockflow_action_gateway('contract-windows-test-key','contract-manager@test.local','close_action',
  jsonb_build_object('requestId','contract-windows-close-done','actionId',v_at_end_action,'result','done','note','Contract visit completed'));
 v_output:=pg_temp.contract_windows_read();
 if (v_output->>'plannedCount')::bigint is distinct from v_baseline+1 or not exists(
  select 1 from jsonb_array_elements(v_output->'rows') r(value)
  where r.value->>'customerId'='b2c10000-0000-4000-8000-000000000001') then raise exception 'C3 completed action still hides window';end if;
 perform public.stockflow_action_gateway('contract-windows-test-key','contract-manager@test.local','close_action',
  jsonb_build_object('requestId','contract-windows-close-dropped','actionId',v_before_end_action,'result','dropped','note','Contract visit dropped'));
 v_output:=pg_temp.contract_windows_read();
 if (v_output->>'plannedCount')::bigint is distinct from v_baseline or not exists(
  select 1 from jsonb_array_elements(v_output->'rows') r(value)
  where r.value->>'customerId'='b2c10000-0000-4000-8000-000000000002') then raise exception 'C3 dropped action still hides window';end if;
 raise notice 'PASS C3: closed actions restore unplanned windows';

 -- C4: inclusive -30/+120 limits, excluded -31/+121, and an ended tender.
 if exists(select 1 from jsonb_array_elements(v_output->'rows') r(value)
  where r.value->>'customerId' in ('b2c10000-0000-4000-8000-000000000004','b2c10000-0000-4000-8000-000000000005'))
  then raise exception 'C4 out-of-window contract included';end if;
 select r.value into v_row from jsonb_array_elements(v_output->'rows') r(value)
 where r.value->>'customerId'='b2c10000-0000-4000-8000-000000000006';
 if v_row->>'daysLeft' is distinct from '-10' or v_row->>'endsOn' is distinct from (v_today-10)::text
  or v_row->>'category' is distinct from 'contract_tender' or v_row->>'party' is distinct from 'Tender Holder'
  or v_row->>'source' is distinct from 'customer_stated' or v_row->>'confidence' is distinct from 'medium'
  then raise exception 'C4 ended tender details incorrect: %',v_row;end if;
 for v_i in 9..10 loop
  select r.value into v_row from jsonb_array_elements(v_output->'rows') r(value)
  join contract_window_fixtures f on f.customer_id::text=r.value->>'customerId' where f.fixture_no=v_i;
  if (v_row->>'daysLeft')::int is distinct from (case v_i when 9 then -30 else 120 end)
   then raise exception 'C4 inclusive boundary missing for fixture %',v_i;end if;
 end loop;
 raise notice 'PASS C4: IST date boundaries and ended tender holder';

 -- C5: use the latest constraint even when it is not a contract, and omit closures.
 select opportunity_id,constraint_id into v_opportunity,v_constraint from contract_window_fixtures where fixture_no=7;
 perform public.stockflow_opportunity_gateway('contract-windows-test-key','contract-manager@test.local','record_constraint',
  jsonb_build_object('requestId','contract-windows-newer-service','opportunityId',v_opportunity,'category','service',
   'evidence','Service is now the current constraint','source','our_view','sourcePerson',null,'observedOn',v_today,
   'facts',jsonb_build_object('issue','Service response delay','since',v_today),'expectedCurrentConstraintId',v_constraint));
 select opportunity_id into v_opportunity from contract_window_fixtures where fixture_no=8;
 perform public.stockflow_opportunity_gateway('contract-windows-test-key','contract-manager@test.local','close_opportunity',
  jsonb_build_object('requestId','contract-windows-close-opportunity','opportunityId',v_opportunity,'outcome','dropped','reason','Contract opportunity closed'));
 v_output:=pg_temp.contract_windows_read();
 if exists(select 1 from jsonb_array_elements(v_output->'rows') r(value)
  where r.value->>'customerId' in ('b2c10000-0000-4000-8000-000000000007','b2c10000-0000-4000-8000-000000000008'))
  then raise exception 'C5 stale constraint or closed opportunity included';end if;
 raise notice 'PASS C5: current constraint and open opportunity only';

 -- C6: reads have no idempotency keys; expected errors cannot replay a command.
 perform pg_temp.contract_windows_error('{"page":1}','PT403','contract-sales@test.local');
 perform pg_temp.contract_windows_error('{"page":1}','PT403','contract-operations@test.local');
 perform pg_temp.contract_windows_error('{"page":1}','42501','contract-manager@test.local','wrong-contract-key');
 perform pg_temp.contract_windows_error('{"page":1}','22023','contract-manager@test.local','contract-windows-test-key','create_action');
 for v_bad_payload in select value from jsonb_array_elements(
  '[{"page":0},{"page":1.5},{"page":4001},{"page":-1},{"page":100000000000000000000},
    {"page":"1"},{"page":true},{"page":null},{},{"page":1,"extra":true},null,[]]'::jsonb) loop
  perform pg_temp.contract_windows_error(v_bad_payload,'22023');
 end loop;
 perform pg_temp.contract_windows_error(null,'22023');
 v_row:=public.stockflow_contract_window_gateway('contract-windows-test-key',' CONTRACT-ADMIN@test.local ',
  'get_contract_windows','{"page":4000}');
 if v_row->>'page' is distinct from '4000' then raise exception 'C6 administrator or upper page boundary failed';end if;
 raise notice 'PASS C6: key, roles and strict page validation';

 -- C7: exact fixture membership/order across pages, including customer-name/id ties.
 select jsonb_agg(r.value->>'opportunityId' order by r.ordinality) into v_actual
 from jsonb_array_elements(v_output->'rows') with ordinality r(value,ordinality);
 select jsonb_agg(f.opportunity_id::text order by f.ends_on,c.name,f.opportunity_id) into v_expected
 from contract_window_fixtures f join private.stockflow_customers c on c.id=f.customer_id
 where f.fixture_no not in (4,5,7,8);
 if v_actual is distinct from v_expected or jsonb_array_length(v_output->'rows')<>26
  then raise exception 'C7 fixture membership or window order differs: % vs %',v_actual,v_expected;end if;
 if v_output::text ~* '(paise|wallet)' then raise exception 'C7 response contains money or wallet data';end if;
 raise notice 'PASS C7: ordered paginated fixture rows without money fields';
end$checks$;
rollback;
