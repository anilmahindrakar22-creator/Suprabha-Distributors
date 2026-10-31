-- Isolated PIN fixtures; no assertions depend on seeded customer/PIN counts.
begin;
set local timezone='Asia/Kolkata';
insert into private.stockflow_gateway_config(name,secret_sha256)
values('orders',encode(extensions.digest('pin-placement-fixture-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,status)
select 'pin-placement-'||r||'@test.local',r,'active' from unnest(array['administrator','management','sales','operations']) r;
insert into public.stockflow_members(email,role,status) values('pin-placement-inactive@test.local','sales','suspended');

create function pg_temp.pp_id(n int) returns uuid language sql immutable as $$
 select ('b3e30000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.pp_read(action text,payload jsonb,actor text default 'administrator') returns jsonb language sql as $$
 select public.stockflow_customer_map_gateway('pin-placement-fixture-key','pin-placement-'||actor||'@test.local',action,payload)
$$;
create function pg_temp.pp_map(actor text default 'administrator') returns jsonb language sql as $$
 select pg_temp.pp_read('get_map_pins','{"south":16,"west":76,"north":18,"east":78}',actor)
$$;
create function pg_temp.pp_error(action text,payload jsonb,state text,actor text default 'administrator') returns void language plpgsql as $$
begin
 begin perform pg_temp.pp_read(action,payload,actor);
 exception when others then if sqlstate=state then return;end if;raise;end;
 raise exception 'Expected SQLSTATE %',state;
end$$;
create function pg_temp.pp_keys(data jsonb) returns setof text language plpgsql as $$
declare k text;v jsonb;
begin
 if jsonb_typeof(data)='object' then
  for k,v in select key,value from jsonb_each(data) loop return next k;return query select * from pg_temp.pp_keys(v);end loop;
 elsif jsonb_typeof(data)='array' then
  for v in select value from jsonb_array_elements(data) loop return query select * from pg_temp.pp_keys(v);end loop;
 end if;
end$$;

-- Original get_map_pins CASE, retained as a test oracle for extraction parity.
create function pg_temp.pp_legacy_tone(p_customer uuid,v_today date,v_wallet jsonb,v_deadlines uuid[],v_actor text,v_roles text[])
returns text language sql stable as $$
 with selected as (select p_customer id),
 orders as materialized (select * from private.stockflow_customer_map_orders(v_actor,v_roles,p_customer,false)),
 wallet as (select value w from jsonb_array_elements(v_wallet->'rows'))
 select case
     when exists(select 1 from private.stockflow_commercial_actions a join private.stockflow_commercial_opportunities o on o.id=a.opportunity_id
      left join private.stockflow_commercial_action_results r on r.action_id=a.id where o.customer_id=s.id and r.action_id is null and a.due_on<v_today)
      or exists(select 1 from orders o where o.customer_id=s.id and o.stuck) then 'red'
     when s.id=any(v_deadlines)
      or (v_wallet#>>'{coverage,certified}'='true' and (w->>'inFocusBand')::boolean and not exists(
       select 1 from private.stockflow_customer_map_constraints(s.id) cc where cc.category is not null and cc.category<>'unknown'))
      or private.stockflow_power_alerts(s.id,v_today) ? 'no_decision_maker' then 'amber'
     when v_wallet#>>'{coverage,certified}'='true' and (w->>'sharePermille')::numeric>=800 then 'green'
     else 'grey' end
 from selected s left join wallet on w->>'customerId'=s.id::text
$$;


-- Test-only wrappers time the actual gateway's helper calls. They are restored
-- before the uninstrumented warm-up and five timed calls, and all DDL rolls back.
create temporary table pp_profile_restore(definition text);
create function pg_temp.pp_profile_install(p_functions regprocedure[],p_parts text[])
returns void language plpgsql as $install$
declare fn regprocedure;idx int;def text;args text;result_type text;call_args text;body text;clone_name text;is_set boolean;started_name text;
begin
 for idx in 1..cardinality(p_functions) loop
  fn:=p_functions[idx];
  def:=pg_get_functiondef(fn);
  insert into pp_profile_restore values(def);
  select pg_get_function_arguments(fn),pg_get_function_result(fn),proretset,
   (select string_agg('$'||n,',' order by n) from generate_series(1,pronargs) n)
  into args,result_type,is_set,call_args from pg_proc where oid=fn;
  clone_name:='pp_original_'||idx;
  execute replace(def,'FUNCTION '||(select oid::regproc::text from pg_proc where oid=fn)||'(',
   'FUNCTION pg_temp.'||clone_name||'(');
  body:='declare started timestamptz; '||case when is_set then '' else 'r '||result_type||'; ' end||
   'begin started:=clock_timestamp(); '||
   case when is_set then 'return query select * from pg_temp.'||clone_name||'('||call_args||'); '
    else 'r:=pg_temp.'||clone_name||'('||call_args||'); ' end||
   format('perform set_config(%L,(coalesce(nullif(current_setting(%L,true),''''),''0'')::numeric+extract(epoch from clock_timestamp()-started)*1000)::text,true); ',
    'pin_profile.'||p_parts[idx],'pin_profile.'||p_parts[idx])||
   case when is_set then 'return; ' else 'return r; ' end||'end';
  execute 'create or replace function '||(select oid::regproc::text from pg_proc where oid=fn)||
   '('||args||') returns '||result_type||' language plpgsql volatile security definer set search_path=pg_catalog,public,private,extensions as '||quote_literal(body);
 end loop;
end$install$;

do $checks$
declare before_map jsonb:=pg_temp.pp_map(); m jsonb;g jsonb;p jsonb;q jsonb;s jsonb;w jsonb;
 actor text;n int;contact uuid;opportunity uuid;started timestamptz;elapsed numeric; samples numeric[]:='{}'; part text; parts text[]:=array['wallet','deadlines','orders','power','constraints']; profile_sum numeric:=0;
begin
 -- These PINs are deliberately absent from the real Karnataka seed.
 if exists(select 1 from private.stockflow_pin_centroids where pin_code in ('599901','599902','599903','599999'))
  then raise exception 'Fixture PIN collision';end if;
 insert into private.stockflow_pin_centroids(pin_code,latitude,longitude,state,office_count,source_version)
 values('599901',17.3,76.8,'Karnataka',1,'pin-placement-fixture'),
       ('599902',17.4,76.9,'Karnataka',1,'pin-placement-fixture'),
       ('599903',15.5,75.5,'Karnataka',1,'pin-placement-timing');
 insert into private.stockflow_customers(id,name,tally_key,city,pin_code,created_by_email)
 select pg_temp.pp_id(f.n),'PIN-PLACEMENT Lab '||lpad(f.n::text,3,'0'),'PIN-PLACEMENT-'||f.n,
  case when f.n=21 then 'Query City' else 'Fixture City' end,
  case when f.n=23 then '599999' when f.n=25 then '599902' else '599901' end,'pin-placement-administrator@test.local'
 from generate_series(1,25) f(n);
 update private.stockflow_customers set active=false where id=pg_temp.pp_id(24);
 -- Grey members have a known decision maker. Names deliberately put red last.
 update private.stockflow_customers set name='PIN-PLACEMENT Z overdue' where id=pg_temp.pp_id(1);
 for n in 1..21 loop
  s:=public.stockflow_accounts_gateway('pin-placement-fixture-key','pin-placement-administrator@test.local','add_contact',
   jsonb_build_object('idempotencyKey','pin-placement-contact-'||n,'customerId',pg_temp.pp_id(n),'name','Fixture Decider',
    'businessRole','Director','phone',null,'email',null));
  contact:=(s->>'contactId')::uuid;
  perform public.stockflow_accounts_gateway('pin-placement-fixture-key','pin-placement-administrator@test.local','set_assessment',
   jsonb_build_object('idempotencyKey','pin-placement-assessment-'||n,'contactId',contact,'decisionRole','decision_maker',
    'stance','neutral','influence','high','reason',null));
 end loop;
 perform public.stockflow_accounts_gateway('pin-placement-fixture-key','pin-placement-administrator@test.local','set_location',
  jsonb_build_object('idempotencyKey','pin-placement-exact','customerId',pg_temp.pp_id(22),'expectedVersion',null,
   'precision','pin','latitude','17.300000','longitude','76.800000','source','manual_pin'));
 perform public.stockflow_accounts_gateway('pin-placement-fixture-key','pin-placement-administrator@test.local','set_location',
  jsonb_build_object('idempotencyKey','pin-placement-town','customerId',pg_temp.pp_id(25),'expectedVersion',null,
   'precision','town','town','Fixture Town','source','town'));
 s:=pg_temp.pp_read('get_customer_sheet',jsonb_build_object('customerId',pg_temp.pp_id(25)));
 if s#>>'{location,approximate,pinCode}' is distinct from '599902' or s#>>'{actions,pin}'<>'place'
  or s->'location' ?| array['lat','lng','latitude','longitude'] then raise exception 'Town approximate sheet';end if;

 m:=pg_temp.pp_map();
 select value into g from jsonb_array_elements(m->'approxGroups') where value->>'pinCode'='599901';
 if g is null or g->>'count'<>'21' or (m#>>'{coverage,approx}')::int<>(before_map#>>'{coverage,approx}')::int+22
  or (m->>'notOnMapCount')::int<>(before_map->>'notOnMapCount')::int+1
  or exists(select 1 from jsonb_array_elements(m->'pins') where value->>'customerId'=pg_temp.pp_id(1)::text)
  then raise exception 'M9 approximate membership: %',g;end if;
 p:=pg_temp.pp_read('get_not_on_map','{"page":1,"query":"PIN-PLACEMENT"}');
 if p->>'total'<>'1' or p#>>'{rows,0,customerId}'<>pg_temp.pp_id(23)::text then raise exception 'M9 unplaced exclusion';end if;
 raise notice 'PASS M9: approximate labs grouped, absent from pins and not-on-map';

 if not exists(select 1 from jsonb_array_elements(m->'pins') where value->>'customerId'=pg_temp.pp_id(22)::text)
  or g->>'count'<>'21' then raise exception 'M10 exact pin wins';end if;
 p:=pg_temp.pp_read('get_pin_labs','{"pinCode":"599901","page":2}');
 if exists(select 1 from jsonb_array_elements(p->'rows') where value->>'customerId'=pg_temp.pp_id(22)::text)
  then raise exception 'M10 exact in PIN rows';end if;
 raise notice 'PASS M10: exact placement excludes lab from PIN group';

 s:=public.stockflow_opportunity_gateway('pin-placement-fixture-key','pin-placement-administrator@test.local','open_opportunity',
  jsonb_build_object('requestId','pin-placement-opportunity','customerId',pg_temp.pp_id(1),'kind','capture','reason','PIN fixture overdue'));
 opportunity:=(s->>'id')::uuid;
 -- Historic overdue action has no backdating API. Other writes use real gateways.
 insert into private.stockflow_commercial_actions(opportunity_id,action_type,detail,owner_email,due_on,created_by)
 values(opportunity,'visit','PIN overdue fixture','pin-placement-sales@test.local',current_date-1,'pin-placement-administrator@test.local');
 -- Historical order fixtures exercise the existing non-delivered rule.
 insert into private.stockflow_orders(id,order_number,customer_id,customer_name,source,status,idempotency_key,created_by_email,updated_by_email)
 select pg_temp.pp_id(100+f.n),'PIN-PLACEMENT-ORDER-'||f.n,pg_temp.pp_id(case when f.n=1 then 1 else 2 end),
  'PIN fixture','phone',case when f.n=3 then 'delivered' when f.n=4 then 'cancelled' else 'packed' end,
  'pin-placement-order-'||f.n,'pin-placement-sales@test.local','pin-placement-sales@test.local'
 from generate_series(1,4) f(n);
 m:=pg_temp.pp_map();
 select value into g from jsonb_array_elements(m->'approxGroups') where value->>'pinCode'='599901';
 if g->>'tone'<>'red' or g->>'count'<>'21' or g->>'openOrders'<>'2'
  then raise exception 'M11 urgency/count/orders: %',g;end if;
 p:=pg_temp.pp_read('get_pin_labs','{"pinCode":"599901","page":1,"query":"Lab 002"}');
 if p#>>'{rows,0,tone}' is distinct from 'grey' then raise exception 'M11 grey member fixture';end if;
 raise notice 'PASS M11: red plus grey group is red, count 21, openOrders 2';

 p:=pg_temp.pp_read('get_pin_labs','{"pinCode":"599901","page":1}');
 q:=pg_temp.pp_read('get_pin_labs','{"pinCode":"599901","page":2}');
 if p->>'total'<>'21' or jsonb_array_length(p->'rows')<>20 or jsonb_array_length(q->'rows')<>1
  or p#>>'{rows,0,customerId}'<>pg_temp.pp_id(1)::text or p#>>'{rows,0,tone}'<>'red'
  or p#>>'{rows,1,customerId}'<>pg_temp.pp_id(2)::text or q#>>'{rows,0,customerId}'<>pg_temp.pp_id(21)::text
  or exists(select 1 from jsonb_array_elements(p->'rows') a join jsonb_array_elements(q->'rows') b on a.value->>'customerId'=b.value->>'customerId')
  then raise exception 'M12 paging/order: % %',p,q;end if;
 p:=pg_temp.pp_read('get_pin_labs','{"pinCode":"599901","page":1,"query":"Lab 009"}');
 q:=pg_temp.pp_read('get_pin_labs','{"pinCode":"599901","page":1,"query":"query CITY"}');
 if p->>'total'<>'1' or p#>>'{rows,0,customerId}'<>pg_temp.pp_id(9)::text
  or q->>'total'<>'1' or q#>>'{rows,0,customerId}'<>pg_temp.pp_id(21)::text then raise exception 'M12 search';end if;
 for s in select value from jsonb_array_elements('[{"pinCode":"099901","page":1},{"pinCode":"59990","page":1},{"pinCode":599901,"page":1},{"pinCode":"599901","page":0},{"pinCode":"599901","page":1.5},{"pinCode":"599901","page":4001},{"pinCode":"599901","page":1,"query":1},{"pinCode":"599901","page":1,"extra":1}]') loop
  perform pg_temp.pp_error('get_pin_labs',s,'22023');
 end loop;
 raise notice 'PASS M12: 20-row paging, name/city query, tone/name order, invalid PIN 22023';

 foreach actor in array array['sales','operations'] loop
  m:=pg_temp.pp_map(actor);
  select jsonb_agg(value) into g from jsonb_array_elements(m->'approxGroups') where value->>'pinCode' in ('599901','599902');
  p:=pg_temp.pp_read('get_pin_labs','{"pinCode":"599901","page":1}',actor);
  s:=pg_temp.pp_read('get_customer_sheet',jsonb_build_object('customerId',pg_temp.pp_id(1)),actor);
  if exists(select 1 from pg_temp.pp_keys(jsonb_build_array(g,p,s)) k
   where k ~* '(walletPaise|salesPaise|gapPaise|valuePaise|sharePermille|cost|margin|gross|purchase)')
   then raise exception 'M13 financial leak for %',actor;end if;
 end loop;
 foreach actor in array array['inactive','missing'] loop
  perform pg_temp.pp_error('get_pin_labs','{"pinCode":"599901","page":1}','PT403',actor);
  perform pg_temp.pp_error('get_map_pins','{"south":16,"west":76,"north":18,"east":78}','PT403',actor);
  perform pg_temp.pp_error('get_customer_sheet',jsonb_build_object('customerId',pg_temp.pp_id(1)),'PT403',actor);
 end loop;
 raise notice 'PASS M13: sales/operations projections omit money; missing/inactive members PT403';

 m:=pg_temp.pp_map();
 if (m#>>'{coverage,total}')::int<>(before_map#>>'{coverage,total}')::int+24
  or (m#>>'{coverage,placed}')::int<>(before_map#>>'{coverage,placed}')::int+1
  or (m#>>'{coverage,placed}')::int-(before_map#>>'{coverage,placed}')::int+
     (m#>>'{coverage,approx}')::int-(before_map#>>'{coverage,approx}')::int+
     (m->>'notOnMapCount')::int-(before_map->>'notOnMapCount')::int<>24
  then raise exception 'M14 fixture coverage';end if;
 s:=pg_temp.pp_read('get_customer_sheet',jsonb_build_object('customerId',pg_temp.pp_id(23)));
 if s ? 'location' then raise exception 'M14 invented approximate location';end if;
 raise notice 'PASS M14: missing centre stays not-on-map; placed + approx + unplaced = total';

 perform public.stockflow_wallet_gateway('pin-placement-fixture-key','pin-placement-administrator@test.local','record_wallet_snapshot',
  jsonb_build_object('requestId','pin-placement-wallet','customerId',pg_temp.pp_id(1),'monthlyWalletPaise',1000,
   'method','manager_estimate','source','PIN fixture','confidence','medium','asOf',current_date,'note','PIN fixture estimate',
   'loweredReason',null,'divisions','[]'::jsonb,'expectedCurrentSnapshotId',null));
 foreach actor in array array['administrator','management','sales','operations'] loop
  m:=pg_temp.pp_map(actor);
  s:=pg_temp.pp_read('get_customer_sheet',jsonb_build_object('customerId',pg_temp.pp_id(1)),actor);
  if (m#>>'{freshness,calculatedAt}')::timestamptz is distinct from now() then raise exception 'M15 calculatedAt';end if;
  if m#>>'{freshness,certified}' is null or m#>>'{freshness,certified}' not in ('true','false') then raise exception 'M15 certified flag';end if;
  if actor in ('administrator','management') then
   if m#>>'{freshness,walletAsOf}' is distinct from current_date::text or s#>>'{wallet,confidence}' is distinct from 'medium'
    or s#>>'{wallet,asOf}' is distinct from current_date::text then raise exception 'M15 financial freshness';end if;
  elsif (m->'freshness') ? 'walletAsOf' or s ? 'wallet' then raise exception 'M15 operational freshness leak';end if;
 end loop;
 -- Compare the extracted helper to the literal old CASE for each fixture,
 -- every role, and certified/uncertified Focus/green wallet combinations.
 foreach actor in array array['administrator','management','sales','operations'] loop
  for n in 1..25 loop
   for w in select jsonb_build_object('coverage',jsonb_build_object('certified',certified),
     'rows',jsonb_build_array(jsonb_build_object('customerId',pg_temp.pp_id(n),'inFocusBand',focus,'sharePermille',share)))
    from (values(true),(false)) c(certified) cross join (values(true),(false)) f(focus)
    cross join (values(0),(800)) x(share) loop
    if (select tone from private.stockflow_customer_map_lab_tones(array[pg_temp.pp_id(n)],current_date,w,'{}','pin-placement-'||actor||'@test.local',array[actor],actor in ('administrator','management')))
      is distinct from pg_temp.pp_legacy_tone(pg_temp.pp_id(n),current_date,w,'{}','pin-placement-'||actor||'@test.local',array[actor])
     then raise exception 'M15 old CASE parity lab %, actor %',n,actor;end if;
    if (private.stockflow_customer_map_wallet_flags((w#>>'{coverage,certified}')::boolean,(w#>>'{rows,0,inFocusBand}')::boolean,
      (w#>>'{rows,0,sharePermille}')::numeric,actor in ('administrator','management'))->>'focus')::boolean
     is distinct from coalesce((w#>>'{coverage,certified}')::boolean and (w#>>'{rows,0,inFocusBand}')::boolean,false)
     then raise exception 'M15 Focus parity lab %, actor %',n,actor;end if;
   end loop;
  end loop;
 end loop;
 p:=pg_temp.pp_read('get_pin_labs','{"pinCode":"599901","page":1}','administrator');
 q:=pg_temp.pp_read('get_pin_labs','{"pinCode":"599901","page":1}','sales');
 if p is distinct from q then raise exception 'M15 sales/admin tone parity';end if;
 raise notice 'PASS M15: role-shaped freshness; original CASE parity across roles and wallet branches';

 -- Kalaburagi-sized timing, in its own bbox: 300 approximate and 20 exact.
 insert into private.stockflow_customers(id,name,tally_key,pin_code,created_by_email)
 select pg_temp.pp_id(1000+f.n),'PIN-TIMING Lab '||lpad(f.n::text,3,'0'),'PIN-TIMING-'||f.n,'599903','pin-placement-administrator@test.local'
 from generate_series(1,320) f(n);
 for n in 301..320 loop
  perform public.stockflow_accounts_gateway('pin-placement-fixture-key','pin-placement-administrator@test.local','set_location',
   jsonb_build_object('idempotencyKey','pin-timing-location-'||n,'customerId',pg_temp.pp_id(1000+n),'expectedVersion',null,
    'precision','pin','latitude','15.500000','longitude','75.500000','source','manual_pin'));
 end loop;
 -- Profile one warmed actual gateway read; helper time is accumulated per call.
 perform pg_temp.pp_profile_install(array[
  'private.stockflow_wallet_read(date)'::regprocedure,
  'private.stockflow_customer_map_deadlines(text,text,boolean,date)'::regprocedure,
  'private.stockflow_customer_map_order_signals(uuid[],text,text[])'::regprocedure,
  'private.stockflow_customer_map_deciders(uuid[])'::regprocedure,
  'private.stockflow_customer_map_diagnoses(uuid[])'::regprocedure],parts);
 perform pg_temp.pp_read('get_map_pins','{"south":15,"west":75,"north":16,"east":76}');
 foreach part in array parts loop perform set_config('pin_profile.'||part,'0',true);end loop;
 started:=clock_timestamp();
 m:=pg_temp.pp_read('get_map_pins','{"south":15,"west":75,"north":16,"east":76}');
 elapsed:=extract(epoch from clock_timestamp()-started)*1000;
 foreach part in array parts loop
  profile_sum:=profile_sum+coalesce(nullif(current_setting('pin_profile.'||part,true),''),'0')::numeric;
  raise notice 'PART %: % ms',part,round(coalesce(nullif(current_setting('pin_profile.'||part,true),''),'0')::numeric,3);
 end loop;
 -- Includes selection, overdue predicates, tone/Focus evaluation, JSON and
 -- wrapper bookkeeping; the expensive helper reads above are excluded.
 raise notice 'PART JSON build/query remainder: % ms',round(elapsed-profile_sum,3);
 for s in select to_jsonb(r) from pp_profile_restore r loop execute s->>'definition';end loop;
 perform pg_temp.pp_read('get_map_pins','{"south":15,"west":75,"north":16,"east":76}');
 for n in 1..5 loop
  started:=clock_timestamp();
  m:=pg_temp.pp_read('get_map_pins','{"south":15,"west":75,"north":16,"east":76}');
  samples:=array_append(samples,extract(epoch from clock_timestamp()-started)*1000);
 end loop;
 select percentile_cont(0.5) within group(order by x)::numeric into elapsed from unnest(samples) x;
 select value into g from jsonb_array_elements(m->'approxGroups') where value->>'pinCode'='599903';
 if g->>'count'<>'300' or (select count(*) from jsonb_array_elements(m->'pins') where value->>'name' like 'PIN-TIMING Lab %')<>20
  then raise exception 'Timing fixture shape';end if;
 raise notice 'TIMING get_map_pins: median % ms; samples % (one warm-up, 300 labs in one PIN + 20 exact pins)',round(elapsed,3),samples;
 if elapsed>150 then raise exception 'get_map_pins exceeds 150 ms median budget: % ms',round(elapsed,3);end if;
end$checks$;

-- M16 uses independent labs so a red/stuck order cannot hide a bad predicate
-- for a different status, age, owner or archive case. Everything rolls back.
do $m16$
declare
 v_lab record;v_role text;v_actor text;v_roles text[];v_ids uuid[];
 v_today date:=(now() at time zone 'Asia/Kolkata')::date;
 v_wallet jsonb;v_deadlines uuid[];v_pins jsonb;v_signals jsonb;v_deciders uuid[];v_diagnoses uuid[];
 v_expected_stuck boolean;v_expected_open bigint;v_actual_stuck boolean;v_actual_open bigint;
 v_expected boolean;v_actual boolean;v_expected_tone text;v_actual_tone text;
 v_order uuid;v_line uuid;v_decision uuid;v_policy uuid;
begin
 -- The replay seed grants sales global reads; exercise the supported owner
 -- scope explicitly for M16, inside this rollback-only fixture.
 update private.stockflow_role_order_scopes set scope='created_by' where role='sales';
 create temporary table pp_m16_order_cases as
 select row_number() over(order by s.status,h.hours,o.owned,a.archived)::int seq,s.status,h.hours,o.owned,a.archived
 from private.stockflow_order_states s cross join (values(23),(25)) h(hours)
 cross join (values(false),(true)) o(owned) cross join (values(false),(true)) a(archived);
 create temporary table pp_m16_labs as
 select 20000+c.seq lab_number,pg_temp.pp_id(20000+c.seq) id,
  format('%s / %sh / sales-owned=%s / archived=%s',c.status,c.hours,c.owned,c.archived) label from pp_m16_order_cases c
 union all
 select 22000+x.n,pg_temp.pp_id(22000+x.n),x.label from (values
  (1,'no opportunity or contacts'),(2,'open opportunity without a constraint; decider'),
  (3,'latest unknown; unassessed contact'),(4,'latest real; removed decider'),
  (5,'closed real opportunity; superseded decider'),(6,'real superseded by unknown; new decider'),
  (7,'unknown superseded by real; removed decider plus active user'),
  (8,'closed real plus open unknown; multiple contacts'),(9,'tied latest constraints and assessments'),
  (10,'25h pending exception excludes stuck'),(11,'25h order outside sales owner scope'),(12,'no orders; known decider')) x(n,label);
 if (select count(*) from pp_m16_labs)>500 then raise exception 'M16 fixture exceeds exact-pin cap';end if;
 insert into private.stockflow_customers(id,name,tally_key,created_by_email)
 select l.id,'M16 '||l.lab_number||' '||l.label,'PIN-M16-'||l.lab_number,'pin-placement-administrator@test.local'
 from pp_m16_labs l;
 for v_lab in select * from pp_m16_labs order by lab_number loop
  perform public.stockflow_accounts_gateway('pin-placement-fixture-key','pin-placement-administrator@test.local','set_location',
   jsonb_build_object('idempotencyKey','pin-m16-location-'||v_lab.lab_number,'customerId',v_lab.id,'expectedVersion',null,
    'precision','pin','latitude','17.600000','longitude','77.200000','source','manual_pin'));
 end loop;
 -- Historical statuses/ages/archival and superseded facts have no backdating
 -- API. Seed them on INSERT, without disabling any integrity/access checks.
 insert into private.stockflow_orders(id,order_number,customer_id,customer_name,source,status,idempotency_key,
  created_by_email,updated_by_email,created_at,updated_at,archived_at)
 select pg_temp.pp_id(30000+c.seq),'PIN-M16-ORDER-'||c.seq,pg_temp.pp_id(20000+c.seq),'M16 order','phone',c.status,
  'pin-m16-order-'||c.seq,case when c.owned then 'pin-placement-sales@test.local' else 'pin-placement-administrator@test.local' end,
  'pin-placement-administrator@test.local',now()-make_interval(hours=>c.hours),now()-make_interval(hours=>c.hours),
  case when c.archived then now() end from pp_m16_order_cases c;
 insert into private.stockflow_orders(id,order_number,customer_id,customer_name,source,status,idempotency_key,
  created_by_email,updated_by_email,created_at,updated_at,pricing_state)
 values
  (pg_temp.pp_id(32010),'PIN-M16-PENDING',pg_temp.pp_id(22010),'M16 pending','phone','packed','pin-m16-pending',
   'pin-placement-sales@test.local','pin-placement-sales@test.local',now()-interval '25 hours',now()-interval '25 hours','approval_required'),
  (pg_temp.pp_id(32011),'PIN-M16-INACCESSIBLE',pg_temp.pp_id(22011),'M16 inaccessible','phone','packed','pin-m16-inaccessible',
   'pin-placement-administrator@test.local','pin-placement-administrator@test.local',now()-interval '25 hours',now()-interval '25 hours',default);
 insert into private.stockflow_pricing_policies(policy_version,minimum_margin_percent,target_margin_percent,
  override_approval_percent,rounding_increment,rounding_rule_version,effective_from,active,created_by_email)
 values('pin-m16-policy',20,30,5,1,'pin-m16-rounding',v_today-30,false,'pin-placement-administrator@test.local')
 returning id into v_policy;
 v_order:=pg_temp.pp_id(32010);
 insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,base_unit,quantity,fulfilled_quantity)
 values(v_order,'PIN-M16-PENDING-ITEM','M16 reagent','Nos',3,0) returning id into v_line;
 insert into private.stockflow_order_pricing_decisions(order_id,order_line_id,decision_version,order_version,state,resolution_type,
  proposed_rate,source_type,guardrail_state,pricing_policy_id,pricing_policy_version,rounding_rule_version,
  requested_by_email,requested_at,request_id)
 values(v_order,v_line,1,1,'pending_approval','price_exception',100,'manual_review','price_ok',v_policy,
  'pin-m16-policy','pin-m16-rounding','pin-placement-administrator@test.local',now()-interval '25 hours','pin-m16-decision')
 returning id into v_decision;
 update private.stockflow_order_lines set pricing_state='approval_required' where id=v_line;
 insert into private.stockflow_price_exceptions(decision_id,order_id,order_line_id,entered_rate,reason,state,requested_by_email)
 values(v_decision,v_order,v_line,100,'M16 pending exception','pending','pin-placement-administrator@test.local');
 -- Verify fixture meaning before comparing implementations.
 if not exists(select 1 from private.stockflow_orders where id=v_order and updated_at=now()-interval '25 hours')
  or not exists(select 1 from private.stockflow_customer_map_orders('pin-placement-sales@test.local',array['sales'],pg_temp.pp_id(22010),false)
   where id=v_order and pending and not stuck)
  then raise exception 'M16 pending fixture lab % actor sales is not pending/non-stuck',pg_temp.pp_id(22010);end if;
 if private.stockflow_can_access_order('pin-placement-sales@test.local',array['sales'],pg_temp.pp_id(32011))
  or not private.stockflow_can_access_order('pin-placement-administrator@test.local',array['administrator'],pg_temp.pp_id(32011))
  or not private.stockflow_can_access_order('pin-placement-operations@test.local',array['operations'],pg_temp.pp_id(32011))
  then raise exception 'M16 scope fixture lab % actor sales/administrator/operations',pg_temp.pp_id(22011);end if;

 insert into private.stockflow_account_contacts(id,customer_id,name,added_by,removed_at,removed_by)
 select pg_temp.pp_id(50000+x.contact_number),pg_temp.pp_id(22000+x.lab_number),'M16 contact '||x.contact_number,
  'pin-placement-administrator@test.local',case when x.removed then now() end,
  case when x.removed then 'pin-placement-administrator@test.local' end
 from (values(1,2,false),(2,3,false),(3,4,true),(4,5,false),(5,6,false),(6,7,true),(7,7,false),
  (8,8,false),(9,8,false),(10,10,false),(11,11,false),(12,12,false),(13,9,false)) x(contact_number,lab_number,removed);
 insert into private.stockflow_contact_assessments(id,contact_id,decision_role,stance,influence,actor,recorded_at)
 select pg_temp.pp_id(51000+x.assessment_number),pg_temp.pp_id(50000+x.contact_number),x.role,'neutral','high',
  'pin-placement-administrator@test.local',now()-make_interval(days=>x.days_old)
 from (values(1,1,'decision_maker',1),(2,3,'decision_maker',1),
  (3,4,'decision_maker',2),(4,4,'user',1),(5,5,'user',2),(6,5,'decision_maker',1),
  (7,6,'decision_maker',1),(8,7,'user',1),(9,8,'decision_maker',1),
  (10,10,'decision_maker',1),(11,11,'decision_maker',1),(12,12,'decision_maker',1),
  (13,13,'decision_maker',1),(14,13,'user',1)) x(assessment_number,contact_number,role,days_old);

 insert into private.stockflow_commercial_opportunities(id,customer_id,kind,opened_reason,opened_by)
 select pg_temp.pp_id(60000+x.n),pg_temp.pp_id(22000+x.n),'capture','M16 opportunity','pin-placement-administrator@test.local'
 from generate_series(2,9) x(n);
 -- category is NOT NULL: an open opportunity with no constraint (lab 22002)
 -- is the valid null/undiagnosed case. No schema constraint is relaxed.
 insert into private.stockflow_commercial_constraints(id,opportunity_id,category,evidence,source,observed_on,facts,confidence,recorded_by,recorded_at)
 select pg_temp.pp_id(61000+x.constraint_number),pg_temp.pp_id(60000+x.opportunity_number),x.category,'M16 historical evidence',
  'our_view',v_today,case when x.category='unknown' then jsonb_build_object('nextQuestion','M16 ask','askBy',v_today+30)
   else jsonb_build_object('issue','M16 service','since',v_today) end,
  'medium','pin-placement-administrator@test.local',now()-make_interval(days=>x.days_old)
 from (values(1,3,'unknown',1),(2,4,'service',1),(3,5,'service',1),
  (4,6,'service',2),(5,6,'unknown',1),(6,7,'unknown',2),(7,7,'service',1),
  (8,8,'service',1),(9,9,'service',1),(10,9,'unknown',1)) x(constraint_number,opportunity_number,category,days_old);
 insert into private.stockflow_commercial_opportunity_closures(opportunity_id,outcome,reason,closed_by)
 values(pg_temp.pp_id(60005),'dropped','M16 closed opportunity','pin-placement-administrator@test.local'),
  (pg_temp.pp_id(60008),'dropped','M16 closed real constraint','pin-placement-administrator@test.local');
 -- Lab 22008 also has a still-open unknown opportunity alongside its closed real one.
 insert into private.stockflow_commercial_opportunities(id,customer_id,kind,opened_reason,opened_by)
 values(pg_temp.pp_id(60018),pg_temp.pp_id(22008),'defend','M16 second opportunity','pin-placement-administrator@test.local');
 insert into private.stockflow_commercial_constraints(opportunity_id,category,evidence,source,observed_on,facts,confidence,recorded_by)
 values(pg_temp.pp_id(60018),'unknown','M16 unknown evidence','our_view',v_today,
  jsonb_build_object('nextQuestion','M16 ask','askBy',v_today+30),'medium','pin-placement-administrator@test.local');

 select array_agg(l.id order by l.lab_number) into v_ids from pp_m16_labs l;
 foreach v_role in array array['administrator','sales','operations'] loop
  v_actor:='pin-placement-'||v_role||'@test.local';v_roles:=array[v_role];
  v_wallet:=private.stockflow_wallet_read(v_today);
  v_deadlines:=private.stockflow_customer_map_deadlines('pin-placement-fixture-key',v_actor,v_role='administrator',v_today);
  v_pins:=pg_temp.pp_read('get_map_pins','{"south":17,"west":77,"north":18,"east":78}',v_role);
  select coalesce(jsonb_object_agg(b.customer_id::text,jsonb_build_object('stuck',b.stuck,'open',b.open_orders)),'{}'::jsonb)
   into v_signals from private.stockflow_customer_map_order_signals(v_ids,v_actor,v_roles) b;
  select coalesce(array_agg(b.customer_id),'{}'::uuid[]) into v_deciders from private.stockflow_customer_map_deciders(v_ids) b;
  select coalesce(array_agg(b.customer_id),'{}'::uuid[]) into v_diagnoses from private.stockflow_customer_map_diagnoses(v_ids) b;
  for v_lab in select * from pp_m16_labs order by lab_number loop
   select bool_or(o.stuck),count(*) filter(where o.status<>'delivered') into v_expected_stuck,v_expected_open
    from private.stockflow_customer_map_orders(v_actor,v_roles,v_lab.id,false) o;
   -- GROUP BY omits labs with no accessible orders. Their aggregate is
   -- (NULL,0), preserving bool_or's empty-set semantics rather than inventing false.
   v_actual_stuck:=(v_signals#>>array[v_lab.id::text,'stuck'])::boolean;
   v_actual_open:=coalesce((v_signals#>>array[v_lab.id::text,'open'])::bigint,0);
   if v_actual_stuck is distinct from v_expected_stuck or v_actual_open is distinct from v_expected_open then
    raise exception 'M16 orders lab % (%) actor %: batch (%,%), original (%,%)',
     v_lab.id,v_lab.label,v_actor,v_actual_stuck,v_actual_open,v_expected_stuck,v_expected_open;
   end if;
   v_expected:=private.stockflow_power_alerts(v_lab.id,v_today) ? 'no_decision_maker';
   v_actual:=not(v_lab.id=any(v_deciders));
   if v_actual is distinct from v_expected then
    raise exception 'M16 deciders lab % (%) actor %: batch absent %, original alert %',v_lab.id,v_lab.label,v_actor,v_actual,v_expected;
   end if;
   select exists(select 1 from private.stockflow_customer_map_constraints(v_lab.id) cc
    where cc.category is not null and cc.category<>'unknown') into v_expected;
   v_actual:=v_lab.id=any(v_diagnoses);
   if v_actual is distinct from v_expected then
    raise exception 'M16 diagnoses lab % (%) actor %: batch %, original %',v_lab.id,v_lab.label,v_actor,v_actual,v_expected;
   end if;
   -- Inline the original 20261102120000 CASE, using only original per-lab
   -- reads (never the new signal functions or pure tone helper) as the oracle.
   with selected as (select v_lab.id id),
   orders as materialized (select * from private.stockflow_customer_map_orders(v_actor,v_roles,v_lab.id,false)),
   wallet as (select value w from jsonb_array_elements(v_wallet->'rows'))
   select case
     when exists(select 1 from private.stockflow_commercial_actions a join private.stockflow_commercial_opportunities o on o.id=a.opportunity_id
      left join private.stockflow_commercial_action_results r on r.action_id=a.id where o.customer_id=s.id and r.action_id is null and a.due_on<v_today)
      or exists(select 1 from orders o where o.customer_id=s.id and o.stuck) then 'red'
     when s.id=any(v_deadlines)
      or (v_wallet#>>'{coverage,certified}'='true' and (w->>'inFocusBand')::boolean and not exists(
       select 1 from private.stockflow_customer_map_constraints(s.id) cc where cc.category is not null and cc.category<>'unknown'))
      or private.stockflow_power_alerts(s.id,v_today) ? 'no_decision_maker' then 'amber'
     when v_wallet#>>'{coverage,certified}'='true' and (w->>'sharePermille')::numeric>=800 then 'green'
     else 'grey' end into v_expected_tone
   from selected s left join wallet on w->>'customerId'=s.id::text;
   select value->>'tone' into v_actual_tone from jsonb_array_elements(v_pins->'pins')
    where value->>'customerId'=v_lab.id::text;
   if v_actual_tone is distinct from v_expected_tone then
    raise exception 'M16 map tone lab % (%) actor %: gateway %, original CASE %',
     v_lab.id,v_lab.label,v_actor,v_actual_tone,v_expected_tone;
   end if;
  end loop;
 end loop;
 raise notice 'PASS: M16 - batch orders, deciders, diagnoses and map tones match original per-lab paths for administrator, sales and operations';
end$m16$;

rollback;

