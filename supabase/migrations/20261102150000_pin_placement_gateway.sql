begin;

-- One policy switch for every wallet-derived tone and Focus indicator.
-- Today's map intentionally exposes these indicators to all admitted roles
-- (CUSTOMER-MAP-DESIGN section 2). Change v_visible to p_financial to hide them.
-- Inputs are already joined to one wallet row; never rescan the wallet per lab.
create function private.stockflow_customer_map_wallet_flags(p_certified boolean,p_in_focus boolean,p_share numeric,p_financial boolean)
returns jsonb language plpgsql immutable security definer set search_path=pg_catalog as $$
declare v_visible boolean:=true;
begin
 return jsonb_build_object(
  'focus',coalesce(v_visible and p_certified and p_in_focus,false),
  'green',coalesce(v_visible and p_certified and p_share>=800,false));
end$$;

-- The single tone rule is pure. All database reads happen once in the batch
-- below; keep first-match urgency and today's role-independent wallet tones.
create function private.stockflow_customer_map_tone(p_stuck boolean,p_overdue boolean,p_no_decider boolean,
 p_has_diagnosis boolean,p_deadline boolean,p_certified boolean,p_in_focus boolean,p_share numeric,p_financial boolean)
returns text language plpgsql immutable security definer set search_path=pg_catalog as $$
declare flags jsonb:=private.stockflow_customer_map_wallet_flags(p_certified,p_in_focus,p_share,p_financial);
begin
 return case
  when p_overdue or p_stuck then 'red'
  when p_deadline or ((flags->>'focus')::boolean and not p_has_diagnosis) or p_no_decider then 'amber'
  when (flags->>'green')::boolean then 'green'
  else 'grey' end;
end$$;

-- Same access, U1 pending join and U3 stuck predicates as map_orders, projected
-- without monetary calculations. Only selected labs' orders are read, once.
create function private.stockflow_customer_map_order_signals(p_customers uuid[],p_actor text,p_roles text[])
returns table(customer_id uuid,stuck boolean,open_orders bigint)
language sql stable security definer set search_path=pg_catalog,public,private,extensions as $$
 with accessible as materialized (
  select o.id,o.customer_id,o.status,o.updated_at,o.pricing_state from private.stockflow_orders o
  where o.customer_id=any(p_customers) and o.archived_at is null and o.status<>'cancelled'
   and private.stockflow_can_access_order(p_actor,p_roles,o.id)
 ), pending as materialized (
  select distinct o.id from accessible o
  join private.stockflow_price_exceptions e on e.order_id=o.id and e.state='pending'
  join private.stockflow_order_pricing_decisions d on d.id=e.decision_id and d.order_id=o.id and d.order_line_id=e.order_line_id
  join private.stockflow_order_lines l on l.id=d.order_line_id and l.order_id=o.id
  where o.status<>'delivered' and o.pricing_state='approval_required'
 )
 select o.customer_id,bool_or(o.status in ('awaiting_approval','partially_reserved','packed','ready_for_picking')
  and o.updated_at<now()-interval '24 hours' and p.id is null),count(*) filter(where o.status<>'delivered')
 from accessible o left join pending p on p.id=o.id group by o.customer_id
$$;

-- Only no_decision_maker affects tone. Match power_alerts' latest assessment
-- and removed-contact predicates; visits and its other alerts are unnecessary.
create function private.stockflow_customer_map_deciders(p_customers uuid[])
returns table(customer_id uuid)
language sql stable security definer set search_path=pg_catalog,public,private,extensions as $$
 select distinct c.customer_id from private.stockflow_account_contacts c
 join lateral(select a.decision_role from private.stockflow_contact_assessments a
  where a.contact_id=c.id order by a.recorded_at desc,a.id desc limit 1) a on a.decision_role='decision_maker'
 where c.customer_id=any(p_customers) and c.removed_at is null
$$;

-- Match map_constraints: latest constraint of each still-open opportunity.
create function private.stockflow_customer_map_diagnoses(p_customers uuid[])
returns table(customer_id uuid)
language sql stable security definer set search_path=pg_catalog,public,private,extensions as $$
 select distinct o.customer_id from private.stockflow_commercial_opportunities o
 left join private.stockflow_commercial_opportunity_closures cl on cl.opportunity_id=o.id
 join lateral(select c.category from private.stockflow_commercial_constraints c
  where c.opportunity_id=o.id order by c.recorded_at desc,c.id desc limit 1) cc on true
 where o.customer_id=any(p_customers) and cl.opportunity_id is null and cc.category is not null and cc.category<>'unknown'
$$;

-- Shared batch for exact pins, approximate groups and the PIN list. The wallet
-- is expanded once, and each set of operational facts is materialized once.
create function private.stockflow_customer_map_lab_tones(p_customers uuid[],p_today date,p_wallet jsonb,
 p_deadlines uuid[],p_actor text,p_roles text[],p_financial boolean)
returns table(customer_id uuid,tone text,focus boolean,open_orders bigint)
language sql stable security definer set search_path=pg_catalog,public,private,extensions as $$
 with ids as materialized (select unnest(p_customers) id),
 orders as materialized (select * from private.stockflow_customer_map_order_signals(p_customers,p_actor,p_roles)),
 deciders as materialized (select * from private.stockflow_customer_map_deciders(p_customers)),
 diagnoses as materialized (select * from private.stockflow_customer_map_diagnoses(p_customers)),
 overdue as materialized (
  select distinct o.customer_id from private.stockflow_commercial_opportunities o
  join private.stockflow_commercial_actions a on a.opportunity_id=o.id
  left join private.stockflow_commercial_action_results r on r.action_id=a.id
  where o.customer_id=any(p_customers) and r.action_id is null and a.due_on<p_today
 ), wallet as materialized (
  select w.* from jsonb_to_recordset(p_wallet->'rows') as w("customerId" uuid,"inFocusBand" boolean,"sharePermille" numeric)
  join ids on ids.id=w."customerId"
 )
 select i.id,private.stockflow_customer_map_tone(coalesce(o.stuck,false),v.customer_id is not null,d.customer_id is null,
  c.customer_id is not null,i.id=any(p_deadlines),(p_wallet#>>'{coverage,certified}')::boolean,w."inFocusBand",w."sharePermille",p_financial),
  (private.stockflow_customer_map_wallet_flags((p_wallet#>>'{coverage,certified}')::boolean,w."inFocusBand",w."sharePermille",p_financial)->>'focus')::boolean,
  coalesce(o.open_orders,0)
 from ids i left join orders o on o.customer_id=i.id left join deciders d on d.customer_id=i.id
 left join diagnoses c on c.customer_id=i.id left join overdue v on v.customer_id=i.id
 left join wallet w on w."customerId"=i.id
$$;

create or replace function public.stockflow_customer_map_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,extensions as $$
declare
 v_actor text:=lower(btrim(p_actor_email)); v_roles text[]; v_hash text; v_financial boolean;
 v_today date:=(now() at time zone 'Asia/Kolkata')::date;
 v_south numeric; v_west numeric; v_north numeric; v_east numeric; v_page numeric; v_query text;
 v_pin text; v_customer uuid; v_customer_row private.stockflow_customers%rowtype;
 v_wallet jsonb; v_row jsonb; v_result jsonb; v_data jsonb; v_tiles jsonb; v_class jsonb;
 v_deadlines uuid[]; v_action jsonb; v_contacts jsonb; v_decider jsonb; v_route jsonb;
 v_economics jsonb; v_instruments jsonb; v_count bigint; v_open bigint; v_overdue bigint; v_phone text;
begin
 select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
 if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_hash then
  raise exception 'Unauthorized gateway' using errcode='42501';end if;
 -- Keep missing/inactive members and all disallowed role combinations at PT403.
 select roles into v_roles from public.stockflow_members where email=v_actor and status='active';
 if not coalesce(private.stockflow_valid_roles(v_roles) and v_roles&&array['administrator','management','sales','operations'],false) then
  raise exception 'Customer map access required' using errcode='PT403';end if;
 v_financial:=v_roles&&array['administrator','management'];
 if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid customer map request' using errcode='22023';end if;

 if p_action='get_not_on_map' then
  if jsonb_typeof(p_payload->'page') is distinct from 'number' or p_payload-array['page','query']<>'{}'::jsonb
   or (p_payload ? 'query' and (jsonb_typeof(p_payload->'query') is distinct from 'string' or char_length(p_payload->>'query')>120)) then
   raise exception 'Invalid unplaced page' using errcode='22023';end if;
  v_page:=(p_payload->>'page')::numeric;v_query:=lower(coalesce(p_payload->>'query',''));
  if v_page<>trunc(v_page) or v_page not between 1 and 4000 then raise exception 'Invalid unplaced page' using errcode='22023';end if;
  with unplaced as materialized (
   select c.id,c.name,c.city from private.stockflow_customers c where c.active
    and not exists(select 1 from private.stockflow_customer_locations l where l.customer_id=c.id and l.precision='pin')
    and not exists(select 1 from private.stockflow_pin_centroids pc where pc.pin_code=c.pin_code)
    and (strpos(lower(c.name),v_query)>0 or strpos(lower(coalesce(c.city,'')),v_query)>0)
  ), selected as (select * from unplaced order by name,id limit 20 offset (v_page::int-1)*20)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('customerId',id,'name',name,'city',city) order by name,id) from selected),'[]'::jsonb),
   'page',v_page,'pageSize',20,'total',(select count(*) from unplaced)) into v_result;
  return v_result;
 elsif p_action='get_pin_labs' then
  if jsonb_typeof(p_payload->'pinCode') is distinct from 'string' or (p_payload->>'pinCode') !~ '^[1-9][0-9]{5}$'
   or jsonb_typeof(p_payload->'page') is distinct from 'number' or p_payload-array['pinCode','page','query']<>'{}'::jsonb
   or (p_payload ? 'query' and (jsonb_typeof(p_payload->'query') is distinct from 'string' or char_length(p_payload->>'query')>120)) then
   raise exception 'Invalid PIN page' using errcode='22023';end if;
  v_page:=(p_payload->>'page')::numeric;v_query:=lower(coalesce(p_payload->>'query',''));v_pin:=p_payload->>'pinCode';
  if v_page<>trunc(v_page) or v_page not between 1 and 4000 then raise exception 'Invalid PIN page' using errcode='22023';end if;
  v_wallet:=private.stockflow_wallet_read(v_today);
  v_deadlines:=private.stockflow_customer_map_deadlines(p_gateway_key,v_actor,v_financial,v_today);
  with labs as materialized (
   select c.id,c.name,c.city from private.stockflow_customers c
   join private.stockflow_pin_centroids pc on pc.pin_code=c.pin_code
   where c.active and c.pin_code=v_pin
    and not exists(select 1 from private.stockflow_customer_locations l where l.customer_id=c.id and l.precision='pin')
    and (strpos(lower(c.name),v_query)>0 or strpos(lower(coalesce(c.city,'')),v_query)>0)
  ), members as materialized (
   select l.*,t.tone from labs l join private.stockflow_customer_map_lab_tones(
    coalesce((select array_agg(id) from labs),'{}'::uuid[]),v_today,v_wallet,v_deadlines,v_actor,v_roles,v_financial) t on t.customer_id=l.id
  ), ranked as (
   select *,case tone when 'red' then 1 when 'amber' then 2 when 'green' then 3 else 4 end urgency from members
  ), selected as (select * from ranked order by urgency,name,id limit 20 offset (v_page::int-1)*20)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object(
   'customerId',id,'name',name,'city',city,'tone',tone) order by urgency,name,id) from selected),'[]'::jsonb),
   'page',v_page,'pageSize',20,'total',(select count(*) from members)) into v_result;
  return v_result;
 elsif p_action='get_map_pins' then
  if p_payload-array['south','west','north','east']<>'{}'::jsonb
   or jsonb_typeof(p_payload->'south') is distinct from 'number' or jsonb_typeof(p_payload->'west') is distinct from 'number'
   or jsonb_typeof(p_payload->'north') is distinct from 'number' or jsonb_typeof(p_payload->'east') is distinct from 'number' then
   raise exception 'Invalid bounding box' using errcode='22023';end if;
  v_south:=(p_payload->>'south')::numeric;v_west:=(p_payload->>'west')::numeric;
  v_north:=(p_payload->>'north')::numeric;v_east:=(p_payload->>'east')::numeric;
  if v_south not between -90 and 90 or v_north not between -90 and 90 or v_west not between -180 and 180 or v_east not between -180 and 180
   or v_north<=v_south or v_east<=v_west or v_north-v_south>3 or v_east-v_west>3 then
   raise exception 'Invalid bounding box' using errcode='22023';end if;
  v_wallet:=private.stockflow_wallet_read(v_today);
  v_deadlines:=private.stockflow_customer_map_deadlines(p_gateway_key,v_actor,v_financial,v_today);
  with approximate as materialized (
   select c.id,c.name,c.pin_code,pc.latitude,pc.longitude from private.stockflow_customers c
   join private.stockflow_pin_centroids pc on pc.pin_code=c.pin_code
   where c.active and not exists(select 1 from private.stockflow_customer_locations l where l.customer_id=c.id and l.precision='pin')
  ), centres as materialized (
   select distinct pin_code,latitude,longitude from approximate
   where latitude between v_south and v_north and longitude between v_west and v_east order by pin_code limit 500
  ), exact as materialized (
   select c.id,c.name,l.latitude,l.longitude from private.stockflow_customers c
   join private.stockflow_customer_locations l on l.customer_id=c.id and l.precision='pin'
   where c.active and l.latitude between v_south and v_north and l.longitude between v_west and v_east
   order by c.name,c.id limit 500
  ), labs as materialized (
   select a.* from approximate a join centres pc using(pin_code)
   union all select e.id,e.name,null::text,e.latitude,e.longitude from exact e
  ), tones as materialized (
   select * from private.stockflow_customer_map_lab_tones(
    coalesce((select array_agg(id) from labs),'{}'::uuid[]),v_today,v_wallet,v_deadlines,v_actor,v_roles,v_financial)
  ), members as materialized (
   select l.*,t.tone,t.focus,t.open_orders from labs l join tones t on t.customer_id=l.id
  ), groups as (
   select pin_code,latitude,longitude,count(*) count,sum(open_orders) open_orders,
    (array_agg(tone order by case tone when 'red' then 1 when 'amber' then 2 when 'green' then 3 else 4 end))[1] tone
   from members where pin_code is not null group by pin_code,latitude,longitude
  )
  select jsonb_build_object('coverage',jsonb_build_object('total',(select count(*) from private.stockflow_customers where active),
   'placed',(select count(*) from private.stockflow_customers c join private.stockflow_customer_locations l on l.customer_id=c.id and l.precision='pin' where c.active),
   'approx',(select count(*) from approximate)),
   'notOnMapCount',(select count(*) from private.stockflow_customers c where c.active
    and not exists(select 1 from private.stockflow_customer_locations l where l.customer_id=c.id and l.precision='pin')
    and not exists(select 1 from approximate a where a.id=c.id)),
   'freshness',jsonb_build_object('calculatedAt',now(),'certified',v_wallet#>'{coverage,certified}')
    ||case when v_financial then jsonb_build_object('walletAsOf',(select max(value->>'asOf') from jsonb_array_elements(v_wallet->'rows'))) else '{}'::jsonb end,
   'approxGroups',coalesce((select jsonb_agg(jsonb_build_object('pinCode',pin_code,'lat',latitude,'lng',longitude,
    'count',count,'tone',tone,'openOrders',open_orders) order by pin_code) from groups),'[]'::jsonb),
   'pins',coalesce((select jsonb_agg(jsonb_build_object('customerId',s.id,'name',s.name,'lat',s.latitude,'lng',s.longitude,
    'tone',s.tone,'focus',s.focus,'openOrders',s.open_orders)
    order by s.name,s.id) from members s where s.pin_code is null),'[]'::jsonb)) into v_result;
  return v_result;
 elsif p_action is distinct from 'get_customer_sheet' then
  raise exception 'Unsupported customer map action' using errcode='22023';
 end if;

 if p_payload-'customerId'<>'{}'::jsonb or jsonb_typeof(p_payload->'customerId') is distinct from 'string'
  or (p_payload->>'customerId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  raise exception 'Invalid customer' using errcode='22023';end if;
 v_customer:=(p_payload->>'customerId')::uuid;
 select * into v_customer_row from private.stockflow_customers where id=v_customer and active;
 if not found then raise exception 'Active customer required' using errcode='22023';end if;
 v_result:=jsonb_build_object('customerId',v_customer,'name',v_customer_row.name,'town',v_customer_row.city);
 select jsonb_build_object('email',a.owner_email,'territoryId',a.territory_id,'since',a.effective_from) into v_data
 from private.stockflow_customer_assignments a where a.customer_id=v_customer and a.effective_to is null;
 if v_data is not null then v_result:=v_result||jsonb_build_object('owner',v_data);end if;
 v_class:=private.stockflow_account_class(v_customer,v_today);
 if v_class->>'state' in ('A','B') then v_result:=v_result||jsonb_build_object('class',v_class->>'state');end if;
 select jsonb_build_object('precision',l.precision,'lat',l.latitude,'lng',l.longitude,'version',l.version) into v_data
 from private.stockflow_customer_locations l where l.customer_id=v_customer and l.precision='pin';
 if v_data is not null then v_result:=v_result||jsonb_build_object('location',v_data);
 elsif exists(select 1 from private.stockflow_pin_centroids pc where pc.pin_code=v_customer_row.pin_code) then
  v_result:=v_result||jsonb_build_object('location',jsonb_build_object('approximate',jsonb_build_object('pinCode',v_customer_row.pin_code)));
 end if;

 select jsonb_build_object('opportunityId',cc.opportunity_id,'category',cc.category,
  'label',case cc.category when 'price' then 'Price' when 'portfolio' then 'Portfolio' when 'instrument' then 'Instrument'
   when 'service' then 'Service' when 'relationship' then 'Relationship' when 'credit' then 'Credit'
   when 'availability' then 'Availability' when 'clinical' then 'Clinical' when 'contract_tender' then 'Contract / tender'
   when 'competitor_lock_in' then 'Competitor lock-in' else 'Unknown' end||case when cc.category='price' and cc.source='our_view' then ' (not proven)' else '' end,
  'priceUnproven',cc.category='price' and cc.source='our_view') into v_data
 from private.stockflow_customer_map_constraints(v_customer) cc
 order by (cc.category is not null and cc.category<>'unknown') desc,cc.opened_at desc,cc.opportunity_id desc limit 1;
 if v_data is not null then v_result:=v_result||jsonb_build_object('heldBackBy',v_data);end if;
 select jsonb_build_object('id',a.id,'opportunityId',a.opportunity_id,'actionType',a.action_type,'detail',a.detail,
  'ownerEmail',a.owner_email,'dueOn',a.due_on,'overdue',a.due_on<v_today,'canPlan',v_financial,'canDone',a.owner_email=v_actor) into v_action
 from private.stockflow_commercial_actions a join private.stockflow_commercial_opportunities o on o.id=a.opportunity_id
 left join private.stockflow_commercial_action_results r on r.action_id=a.id
 where o.customer_id=v_customer and r.action_id is null order by a.due_on,a.created_at,a.id limit 1;
 if v_action is not null then v_result:=v_result||jsonb_build_object('nextAction',v_action);end if;
 select count(*) into v_overdue from private.stockflow_commercial_actions a
 join private.stockflow_commercial_opportunities o on o.id=a.opportunity_id
 left join private.stockflow_commercial_action_results r on r.action_id=a.id
 where o.customer_id=v_customer and r.action_id is null and a.due_on<v_today;
 v_tiles:='{}'::jsonb;
 select jsonb_build_object('visitedOn',v.visited_on,'visitedBy',v.visited_by,'outcome',v.outcome) into v_data
 from private.stockflow_customer_visits v where v.customer_id=v_customer order by v.visited_on desc,v.created_at desc,v.id desc limit 1;
 if v_data is not null then v_tiles:=v_tiles||jsonb_build_object('lastVisit',v_data);end if;
 -- Financial fields are constructed only here, never redacted from a raw read.
 if v_financial then
  v_wallet:=private.stockflow_wallet_read(v_today);
  select value into v_row from jsonb_array_elements(v_wallet->'rows') where value->>'customerId'=v_customer::text;
  v_result:=v_result||jsonb_build_object('wallet',jsonb_build_object('confidence',v_row->'confidence','asOf',v_row->'asOf'));
  v_tiles:=v_tiles||jsonb_build_object('walletPaise',v_row->'walletPaise','salesPaise',v_row->'salesPaise','gapPaise',v_row->'captureGapPaise');
  v_result:=v_result||jsonb_build_object('sharePermille',v_row->'sharePermille','certified',v_wallet#>'{coverage,certified}');
 end if;
 with orders as materialized (select * from private.stockflow_customer_map_orders(v_actor,v_roles,v_customer,v_financial)),
 open_work as (select * from orders where status<>'delivered' order by pending desc,created_at,id limit 3),
 recent as (select * from orders where status='delivered' order by created_at desc,id desc limit 3)
 select (select count(*) from orders where status<>'delivered'),jsonb_build_object(
  'openWork',(select jsonb_agg(jsonb_build_object('orderId',id,'number',order_number,'stage',status,'date',created_at,
   'kind',case when pending then 'price' else 'order' end,'approximate',pending)
   ||case when v_financial then jsonb_build_object('valuePaise',value_paise) else '{}'::jsonb end order by pending desc,created_at,id) from open_work),
  'recentOrders',(select jsonb_agg(jsonb_build_object('orderId',id,'number',order_number,'stage',status,'date',created_at)
   ||case when v_financial then jsonb_build_object('valuePaise',value_paise) else '{}'::jsonb end order by created_at desc,id desc) from recent))
 into v_open,v_data;
 v_result:=v_result||jsonb_strip_nulls(v_data);
 if not v_financial then
  v_tiles:=v_tiles||jsonb_build_object('openOrders',v_open,'overdue',v_overdue);
  if v_action is not null then v_tiles:=v_tiles||jsonb_build_object('nextActionDue',v_action->'dueOn');end if;
 end if;
 if v_tiles<>'{}'::jsonb then v_result:=v_result||jsonb_build_object('tiles',v_tiles);end if;

 select coalesce(jsonb_agg(jsonb_build_object('contactId',c.id,'name',c.name,'businessRole',c.business_role,
  'decisionRole',coalesce(a.decision_role,'unknown'),'stance',coalesce(a.stance,'unknown')) order by c.name,c.id),'[]'::jsonb) into v_contacts
 from private.stockflow_account_contacts c left join lateral(select decision_role,stance from private.stockflow_contact_assessments
  where contact_id=c.id order by recorded_at desc,id desc limit 1) a on true
 where c.customer_id=v_customer and c.removed_at is null;
 v_route:=private.stockflow_power_route(v_customer);
 select value into v_decider from jsonb_array_elements(v_contacts) where value->>'decisionRole'='decision_maker'
 order by (value->>'contactId'=v_route#>>array['steps',(jsonb_array_length(v_route->'steps')-1)::text,'contactId']) desc nulls last,
  value->>'name',value->>'contactId' limit 1;
 v_result:=v_result||jsonb_build_object('decisionMaker',case when v_decider is null then jsonb_build_object('label','No decider known','canAddContact',true)
  else v_decider end);
 if v_route is not null then v_result:=v_result||jsonb_build_object('route',v_route);end if;
 if jsonb_array_length(v_contacts)>0 then
  v_result:=v_result||jsonb_build_object('contacts',jsonb_build_object('total',jsonb_array_length(v_contacts),
   'champions',(select count(*) from jsonb_array_elements(v_contacts) where value->>'decisionRole'='champion')));
 end if;

 -- Read the same summary calculator as Economics, only for financial roles and
 -- only when the customer has a target. Project status, never its money fields.
 if v_financial and exists(select 1 from private.stockflow_economic_targets where customer_id=v_customer) then
  v_economics:=private.stockflow_economic_workspace_read(v_roles,true);
 end if;
 with ours as (
  select distinct on (i.instrument_id) i.instrument_id,i.id installation_id,coalesce(t.model_id,m.model_id,i.item_name) model,
   coalesce(t.effective_from,(i.completed_at at time zone 'Asia/Kolkata')::date,i.scheduled_date) placed_on,
   m.serial_number,t.id target_id
  from private.stockflow_equipment_installations i join private.stockflow_instruments m on m.id=i.instrument_id
  left join private.stockflow_orders o on o.id=i.order_id
  left join lateral(select t.id,t.model_id,t.effective_from from private.stockflow_economic_targets t
   where t.installation_id=i.id and t.customer_id=v_customer and t.kind='placement' and t.approval<>'rejected'
   order by t.effective_from desc,t.id desc limit 1) t on true
  where i.status='completed' and coalesce(i.customer_id,o.customer_id)=v_customer
  order by i.instrument_id,i.completed_at desc nulls last,i.id desc
 ), instrument_rows as (
  select 'ours:'||o.instrument_id stable_id,0 kind_order,jsonb_build_object('kind','ours','instrumentId',o.instrument_id,
   'installationId',o.installation_id,'targetId',o.target_id,'model',o.model,'placedOn',o.placed_on,'serial',o.serial_number)
   ||case when v_financial then jsonb_build_object('payback',case e.value#>>'{forecastReview,status}'
    when 'within_limit' then 'Paying back' when 'review_required' then 'Behind' when 'limit_exceeded' then 'Behind'
    when 'non_positive_gp' then 'Behind' else 'Awaiting data' end) else '{}'::jsonb end item
  from ours o left join lateral(select value from jsonb_array_elements(v_economics->'targets') where value->>'id'=o.target_id::text) e on true
  union all
  select 'theirs:'||cc.opportunity_id,1,jsonb_build_object('kind','theirs','opportunityId',cc.opportunity_id,
   'analyser',cc.facts->>'analyser','owner',cc.facts->>'owner','closedSystem',cc.facts->>'closedSystem')
  from private.stockflow_customer_map_constraints(v_customer) cc where cc.category='instrument'
  union all
  select 'lock:'||cc.opportunity_id,2,jsonb_build_object('kind','theirs','opportunityId',cc.opportunity_id,
   'competitor',cc.facts->>'competitor','endsOn',cc.facts->>'endsOn','daysLeft',(cc.facts->>'endsOn')::date-v_today)
  from private.stockflow_customer_map_constraints(v_customer) cc where cc.category='competitor_lock_in'
 ), numbered as (select *,row_number() over(order by kind_order,stable_id) ordinal from instrument_rows)
 select count(*),jsonb_agg(item order by ordinal) filter(where ordinal<=3) into v_count,v_instruments from numbered;
 if v_count>0 then v_result:=v_result||jsonb_build_object('instruments',jsonb_build_object('rows',v_instruments,'moreCount',greatest(v_count-3,0)));end if;
 -- Contacts have no primary flag; use their existing added_at/id ordering.
 select coalesce((select nullif(btrim(c.phone),'') from private.stockflow_account_contacts c
  where c.customer_id=v_customer and c.removed_at is null and nullif(btrim(c.phone),'') is not null
  order by c.added_at,c.id limit 1),nullif(btrim(v_customer_row.phone),'')) into v_phone;
 v_result:=v_result||jsonb_build_object('actions',jsonb_build_object('pin',case when v_result#>>'{location,precision}'='pin' then 'move' else 'place' end,
  'orderCustomerId',v_customer)||case when v_phone is not null then jsonb_build_object('call','tel:'||v_phone) else '{}'::jsonb end);
 return v_result;
end$$;

revoke all on function private.stockflow_customer_map_wallet_flags(boolean,boolean,numeric,boolean),
 private.stockflow_customer_map_tone(boolean,boolean,boolean,boolean,boolean,boolean,boolean,numeric,boolean),
 private.stockflow_customer_map_order_signals(uuid[],text,text[]),private.stockflow_customer_map_deciders(uuid[]),
 private.stockflow_customer_map_diagnoses(uuid[]),
 private.stockflow_customer_map_lab_tones(uuid[],date,jsonb,uuid[],text,text[],boolean) from public,anon,authenticated,service_role;
revoke all on function public.stockflow_customer_map_gateway(text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.stockflow_customer_map_gateway(text,text,text,jsonb) to service_role;
commit;
notify pgrst,'reload schema';

