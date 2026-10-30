begin;

-- Current means latest constraint per open opportunity, as in wallet diagnosis.
create function private.stockflow_customer_map_constraints(p_customer uuid)
returns table(opportunity_id uuid,customer_id uuid,category text,source text,facts jsonb,opened_at timestamptz)
language sql stable security definer set search_path=pg_catalog,public,private,extensions as $$
 select o.id,o.customer_id,cc.category,cc.source,cc.facts,o.opened_at
 from private.stockflow_commercial_opportunities o
 left join private.stockflow_commercial_opportunity_closures cl on cl.opportunity_id=o.id
 join lateral(select c.category,c.source,c.facts from private.stockflow_commercial_constraints c
  where c.opportunity_id=o.id order by c.recorded_at desc,c.id desc limit 1) cc on true
 where cl.opportunity_id is null and (p_customer is null or o.customer_id=p_customer)
$$;

-- The public deadline read is management-only. Never impersonate a manager:
-- use it with the same key and actor when permitted; for operational roles,
-- mirror its exact current-constraint, date-window and unplanned predicates.
create function private.stockflow_customer_map_deadlines(p_key text,p_actor text,p_financial boolean,p_today date)
returns uuid[] language plpgsql security definer set search_path=pg_catalog,public,private,extensions as $$
declare v_page int:=1; v_data jsonb; v_ids uuid[]:='{}'; v_page_ids uuid[];
begin
 if p_financial then
  loop
   v_data:=public.stockflow_contract_window_gateway(p_key,p_actor,'get_contract_windows',jsonb_build_object('page',v_page));
   select coalesce(array_agg((value->>'customerId')::uuid),'{}'::uuid[]) into v_page_ids
   from jsonb_array_elements(v_data->'rows');
   v_ids:=v_ids||v_page_ids;
   exit when v_page*20>=(v_data->>'total')::bigint or v_page=4000;
   v_page:=v_page+1;
  end loop;
 else
  select coalesce(array_agg(distinct cc.customer_id),'{}'::uuid[]) into v_ids
  from private.stockflow_customer_map_constraints(null) cc
  cross join lateral(select (case when cc.category='unknown' then cc.facts->>'askBy' else cc.facts->>'endsOn' end)::date ends_on) deadline
  where cc.category in ('competitor_lock_in','contract_tender','unknown')
   and deadline.ends_on between p_today-30 and p_today+case when cc.category='unknown' then 14 else 120 end
   and not exists(select 1 from private.stockflow_commercial_actions a
    left join private.stockflow_commercial_action_results r on r.action_id=a.id
    where a.opportunity_id=cc.opportunity_id and r.action_id is null and a.due_on<=deadline.ends_on);
 end if;
 return v_ids;
end$$;

-- Shared U1 pending inbox join; U3 excludes exactly these orders. Values follow
-- Today T-4: approved customer rate x remaining units; pending proposed rate x
-- full units. Delivered history uses approved customer rate x delivered units.
create function private.stockflow_customer_map_orders(p_actor text,p_roles text[],p_customer uuid,p_financial boolean)
returns table(id uuid,customer_id uuid,order_number text,status text,created_at timestamptz,updated_at timestamptz,
 pending boolean,stuck boolean,value_paise numeric)
language sql stable security definer set search_path=pg_catalog,public,private,extensions as $$
 with accessible as materialized (
  select o.* from private.stockflow_orders o where o.archived_at is null and o.status<>'cancelled'
   and (p_customer is null or o.customer_id=p_customer)
   and private.stockflow_can_access_order(p_actor,p_roles,o.id)
 ), pending_lines as materialized (
  select o.id order_id,l.id line_id,d.proposed_rate
  from accessible o join private.stockflow_price_exceptions e on e.order_id=o.id and e.state='pending'
  join private.stockflow_order_pricing_decisions d on d.id=e.decision_id and d.order_id=o.id and d.order_line_id=e.order_line_id
  join private.stockflow_order_lines l on l.id=d.order_line_id and l.order_id=o.id
  where o.status<>'delivered' and o.pricing_state='approval_required'
 ), pending_orders as (select distinct order_id from pending_lines)
 select o.id,o.customer_id,o.order_number,o.status,o.created_at,o.updated_at,p.order_id is not null,
  o.status in ('awaiting_approval','partially_reserved','packed','ready_for_picking')
   and o.updated_at<now()-interval '24 hours' and p.order_id is null,
  case when p_financial then amounts.value_paise end
 from accessible o left join pending_orders p on p.order_id=o.id
 left join lateral (
  select case when bool_and(case when pl.line_id is not null then pl.proposed_rate is not null
    else l.approved_pricing_decision_id is not null and d.approved_rate is not null end)
   then round(sum(case when pl.line_id is not null then pl.proposed_rate*l.quantity
    else d.approved_rate*case when o.status='delivered' then l.fulfilled_quantity else l.quantity-l.fulfilled_quantity end end)*100) end value_paise
  from private.stockflow_order_lines l
  left join private.stockflow_order_pricing_decisions d on d.id=l.approved_pricing_decision_id
   and d.order_line_id=l.id and d.order_id=o.id and d.state='approved'
  left join pending_lines pl on pl.line_id=l.id
  where p_financial and l.order_id=o.id and
   case when o.status='delivered' then l.fulfilled_quantity>0 else l.quantity>l.fulfilled_quantity end
 ) amounts on p_financial
$$;

create function public.stockflow_customer_map_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,extensions as $$
declare
 v_actor text:=lower(btrim(p_actor_email)); v_roles text[]; v_hash text; v_financial boolean;
 v_today date:=(now() at time zone 'Asia/Kolkata')::date;
 v_south numeric; v_west numeric; v_north numeric; v_east numeric; v_page numeric; v_query text;
 v_customer uuid; v_customer_row private.stockflow_customers%rowtype;
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
    and (strpos(lower(c.name),v_query)>0 or strpos(lower(coalesce(c.city,'')),v_query)>0)
  ), selected as (select * from unplaced order by name,id limit 20 offset (v_page::int-1)*20)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('customerId',id,'name',name,'city',city) order by name,id) from selected),'[]'::jsonb),
   'page',v_page,'pageSize',20,'total',(select count(*) from unplaced)) into v_result;
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
  with selected as materialized (
   select c.id,c.name,l.latitude,l.longitude from private.stockflow_customers c
   join private.stockflow_customer_locations l on l.customer_id=c.id and l.precision='pin'
   where c.active and l.latitude between v_south and v_north and l.longitude between v_west and v_east
   order by c.name,c.id limit 500
  ), orders as materialized (
   select o.* from selected s cross join lateral private.stockflow_customer_map_orders(v_actor,v_roles,s.id,false) o
  ), wallet as (select value w from jsonb_array_elements(v_wallet->'rows'))
  select jsonb_build_object('coverage',jsonb_build_object('total',(select count(*) from private.stockflow_customers where active),
   'placed',(select count(*) from private.stockflow_customers c join private.stockflow_customer_locations l on l.customer_id=c.id and l.precision='pin' where c.active)),
   'notOnMapCount',(select count(*) from private.stockflow_customers c where c.active and not exists(select 1 from private.stockflow_customer_locations l where l.customer_id=c.id and l.precision='pin')),
   'pins',coalesce((select jsonb_agg(jsonb_build_object('customerId',s.id,'name',s.name,'lat',s.latitude,'lng',s.longitude,
    'tone',case
     when exists(select 1 from private.stockflow_commercial_actions a join private.stockflow_commercial_opportunities o on o.id=a.opportunity_id
      left join private.stockflow_commercial_action_results r on r.action_id=a.id where o.customer_id=s.id and r.action_id is null and a.due_on<v_today)
      or exists(select 1 from orders o where o.customer_id=s.id and o.stuck) then 'red'
     when s.id=any(v_deadlines)
      or (v_wallet#>>'{coverage,certified}'='true' and (w->>'inFocusBand')::boolean and not exists(
       select 1 from private.stockflow_customer_map_constraints(s.id) cc where cc.category is not null and cc.category<>'unknown'))
      or private.stockflow_power_alerts(s.id,v_today) ? 'no_decision_maker' then 'amber'
     when v_wallet#>>'{coverage,certified}'='true' and (w->>'sharePermille')::numeric>=800 then 'green'
     else 'grey' end,
    'focus',coalesce(v_wallet#>>'{coverage,certified}'='true' and (w->>'inFocusBand')::boolean,false),
    'openOrders',(select count(*) from orders o where o.customer_id=s.id and o.status<>'delivered')) order by s.name,s.id)
    from selected s left join wallet on w->>'customerId'=s.id::text),'[]'::jsonb)) into v_result;
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
 if v_data is not null then v_result:=v_result||jsonb_build_object('location',v_data);end if;

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
 v_result:=v_result||jsonb_build_object('actions',jsonb_build_object('pin',case when v_result ? 'location' then 'move' else 'place' end,
  'orderCustomerId',v_customer)||case when v_phone is not null then jsonb_build_object('call','tel:'||v_phone) else '{}'::jsonb end);
 return v_result;
end$$;

revoke all on function private.stockflow_customer_map_constraints(uuid),private.stockflow_customer_map_deadlines(text,text,boolean,date),
 private.stockflow_customer_map_orders(text,text[],uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function public.stockflow_customer_map_gateway(text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.stockflow_customer_map_gateway(text,text,text,jsonb) to service_role;
commit;
notify pgrst,'reload schema';
