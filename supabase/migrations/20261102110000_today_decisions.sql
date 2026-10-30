begin;

-- Read-only composition. Customer rates are stored in rupees; the wire uses paise.
create function public.stockflow_today_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,extensions as $$
declare
 v_actor text:=lower(btrim(p_actor_email));
 v_roles text[];
 v_role text;
 v_secret_hash text;
 v_today date:=(now() at time zone 'Asia/Kolkata')::date;
 v_wallet jsonb;
 v_windows jsonb;
 v_result jsonb;
begin
 select secret_sha256 into v_secret_hash from private.stockflow_gateway_config where name='orders';
 if v_secret_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_secret_hash then raise exception 'Unauthorized gateway' using errcode='42501';end if;
 v_roles:=private.stockflow_active_member_roles(v_actor);
 if not coalesce(v_roles&&array['administrator','management'],false) then raise exception 'Wallet management access required' using errcode='PT403';end if;
 v_role:=case when 'administrator'=any(v_roles) then 'administrator' else 'management' end;
 if p_action is distinct from 'get_today' then raise exception 'Unsupported today action' using errcode='22023';end if;
 if p_payload is distinct from '{}'::jsonb then raise exception 'Invalid today request' using errcode='22023';end if;
 v_wallet:=private.stockflow_wallet_read(v_today);
 v_windows:=public.stockflow_contract_window_gateway(p_gateway_key,p_actor_email,'get_contract_windows','{"page":1}'::jsonb);

 with accessible as materialized (
  select o.* from private.stockflow_orders o
  where o.archived_at is null and o.status not in ('delivered','cancelled')
   and private.stockflow_can_access_order(v_actor,v_role,o.id)
 ), pending_lines as materialized (
  -- The inbox loads open orders with pricingState=approval_required, then keeps
  -- nonempty exceptions from get_order_pricing / stockflow_order_pricing_payload:
  -- e.order_id=o.id and e.state='pending'. Join that exception's decision, not history.
  select o.id order_id,l.id line_id,d.proposed_rate,e.requested_at
  from accessible o join private.stockflow_price_exceptions e on e.order_id=o.id and e.state='pending'
  join private.stockflow_order_pricing_decisions d on d.id=e.decision_id and d.order_id=o.id
   and d.order_line_id=e.order_line_id
  join private.stockflow_order_lines l on l.id=d.order_line_id and l.order_id=o.id
  where o.pricing_state='approval_required'
 ), pending_orders as (
  select order_id,count(*) line_count,min(requested_at) since from pending_lines group by order_id
 ), order_values as materialized (
  select o.id,
   case when bool_and(l.approved_pricing_decision_id is not null and d.approved_rate is not null)
    then round(sum(d.approved_rate*(l.quantity-l.fulfilled_quantity))*100) end value_paise,
   -- Pending lines use proposed rate x quantity (T-4); already-approved lines
   -- use remaining quantity. A missing rate on any remaining line stays unknown.
   case when bool_and(case when p.line_id is not null then p.proposed_rate is not null
     else l.approved_pricing_decision_id is not null and d.approved_rate is not null end)
    then round(sum(case when p.line_id is not null then p.proposed_rate*l.quantity
     else d.approved_rate*(l.quantity-l.fulfilled_quantity) end)*100) end proposed_paise
  from accessible o join private.stockflow_order_lines l on l.order_id=o.id and l.quantity>l.fulfilled_quantity
  left join private.stockflow_order_pricing_decisions d on d.id=l.approved_pricing_decision_id
   and d.order_line_id=l.id and d.order_id=o.id and d.state='approved'
  left join pending_lines p on p.line_id=l.id
  group by o.id
 ), alerts as (
  -- One release decision per item, even if several increases were reported.
  select e.metadata->>'tallyKey' tally_key,min(e.metadata->>'itemName') item_name,max(e.created_at) since
  from private.stockflow_order_events e join accessible o on o.id=e.order_id
  where e.event_type='stock_increase_reported' and e.created_at>=now()-interval '7 days'
   and o.status not in ('draft','phone_order_received','awaiting_confirmation','awaiting_approval','cancelled','delivered')
   and exists(select 1 from private.stockflow_order_lines l where l.order_id=o.id
    and l.tally_item_key=e.metadata->>'tallyKey' and l.quantity>l.fulfilled_quantity)
  group by e.metadata->>'tallyKey'
 ), stock as (
  -- Mirror stockflow_stock_alert_gateway (20261011090000), without its page cap.
  select item->>'tallyKey' tally_key,
   case when count(*)=1 then min(case when char_length(item->>'closing')<=30
    and item->>'closing' ~ '^-?[0-9]+(\.[0-9]+)?$' then (item->>'closing')::numeric end) end current_stock
  from public.stockflow_snapshots snap
  cross join lateral jsonb_array_elements(case when jsonb_typeof(snap.payload->'catalog')='array'
   then snap.payload->'catalog' else '[]'::jsonb end) item
  where snap.id='suprabha' and item->>'tallyKey' in (select tally_key from alerts)
  group by item->>'tallyKey'
 ), waiting as (
  select l.tally_item_key,o.id,o.created_at,
   case o.priority when 'urgent' then 3 when 'high' then 2 else 1 end priority_rank,
   sum(l.quantity-l.fulfilled_quantity) remaining
  from accessible o join private.stockflow_order_lines l on l.order_id=o.id
  where o.status not in ('draft','phone_order_received','awaiting_confirmation','awaiting_approval','cancelled','delivered')
   and l.quantity>l.fulfilled_quantity and l.tally_item_key in (select tally_key from alerts)
  group by l.tally_item_key,o.id,o.created_at,o.priority
 ), cumulative as (
  select *,sum(remaining) over(partition by tally_item_key order by priority_rank desc,created_at,id rows unbounded preceding) cumulative_remaining
  from waiting
 ), coverage as (
  select w.tally_item_key,count(*) waiting_orders,
   count(*) filter(where w.cumulative_remaining<=greatest(s.current_stock,0)) covered_orders,
   case when bool_and(v.value_paise is not null) then sum(v.value_paise) end value_paise
  from cumulative w left join stock s on s.tally_key=w.tally_item_key
  left join order_values v on v.id=w.id
  group by w.tally_item_key
 ), unblock as (
  select 'approve_price:'||o.id stable_id,v.proposed_paise amount,p.since sort_at,
   jsonb_build_object('type','approve_price','title',o.customer_name,
    'subtitle',p.line_count||' lines awaiting price approval','valuePaise',v.proposed_paise,
    'approximate',true,'since',p.since,'target',jsonb_build_object('kind','order','orderId',o.id)) item
  from pending_orders p join accessible o on o.id=p.order_id left join order_values v on v.id=o.id
  union all
  select 'stock_covers:'||a.tally_key,c.value_paise,a.since,
   jsonb_build_object('type','stock_covers','title',a.item_name,
    'subtitle',c.waiting_orders||' waiting orders covered','valuePaise',c.value_paise,
    'approximate',false,'since',a.since,'target',jsonb_build_object('kind','stock','itemKey',a.tally_key))
  from alerts a join coverage c on c.tally_item_key=a.tally_key join stock s on s.tally_key=a.tally_key
  where s.current_stock is not null and c.waiting_orders>0 and c.covered_orders=c.waiting_orders
  union all
  select 'stuck_order:'||o.id,v.value_paise,o.updated_at,
   jsonb_build_object('type','stuck_order','title',o.customer_name,
    'subtitle',replace(o.status,'_',' ')||' for over 24 hours','valuePaise',v.value_paise,
    'approximate',false,'since',o.updated_at,'target',jsonb_build_object('kind','order','orderId',o.id))
  from accessible o left join order_values v on v.id=o.id
  -- stockflow_operations_summary.urgentExceptions, plus the two fulfilment states.
  where o.status in ('awaiting_approval','partially_reserved','packed','ready_for_picking')
   and o.updated_at<now()-interval '24 hours'
   and not exists(select 1 from pending_orders p where p.order_id=o.id)
 ), wallet_rows as materialized (
  select value row_data,(value->>'customerId')::uuid customer_id,
   case when v_wallet#>>'{coverage,certified}'='true' then (value->>'captureGapPaise')::numeric end gap
  from jsonb_array_elements(v_wallet->'rows')
 ), grow as (
  select 'diagnose:'||w.customer_id stable_id,w.gap amount,null::timestamptz sort_at,
   jsonb_build_object('type','diagnose','title',w.row_data->>'name','subtitle','Focus account needs a diagnosis',
    'valuePaisePerMonth',w.gap,'valueKind','gap','due',null,
    'target',jsonb_build_object('kind','lab','customerId',w.customer_id)) item
  from wallet_rows w
  -- Same current-known-constraint exclusion as get_wallet_diagnoses.
  where v_wallet#>>'{coverage,certified}'='true' and (w.row_data->>'inFocusBand')::boolean
   and not exists(
    select 1 from private.stockflow_commercial_opportunities o
    left join private.stockflow_commercial_opportunity_closures cl on cl.opportunity_id=o.id
    left join lateral(select category from private.stockflow_commercial_constraints where opportunity_id=o.id
     order by recorded_at desc,id desc limit 1) cc on true
    where o.customer_id=w.customer_id and cl.opportunity_id is null and cc.category is not null and cc.category<>'unknown')
  union all
  select 'deadline:'||(r.value->>'opportunityId'),w.gap,(r.value->>'endsOn')::date::timestamp at time zone 'Asia/Kolkata',
   jsonb_build_object('type','deadline','title',r.value->>'customerName','subtitle',r.value->>'party',
    'valuePaisePerMonth',w.gap,'valueKind',case when w.gap is not null then 'gap' end,'due',r.value->>'endsOn',
    'target',jsonb_build_object('kind','lab','customerId',r.value->>'customerId'))
  from jsonb_array_elements(v_windows->'rows') r(value)
  left join wallet_rows w on w.customer_id=(r.value->>'customerId')::uuid
  union all
  select 'overdue_action:'||a.id,a.expected_monthly_gain_paise,a.due_on::timestamp at time zone 'Asia/Kolkata',
   jsonb_build_object('type','overdue_action','title',c.name,'subtitle',a.detail,
    'valuePaisePerMonth',a.expected_monthly_gain_paise,
    'valueKind',case when a.expected_monthly_gain_paise is not null then 'expected' end,'due',a.due_on,
    'target',jsonb_build_object('kind','lab','customerId',c.id))
  from private.stockflow_commercial_actions a
  join private.stockflow_commercial_opportunities o on o.id=a.opportunity_id
  join private.stockflow_customers c on c.id=o.customer_id
  left join private.stockflow_commercial_action_results r on r.action_id=a.id
  where r.action_id is null and a.due_on<v_today
 ), lanes as (
  select 'unblock' lane,* from unblock union all select 'grow' lane,* from grow
 ), ranked as (
  select *,row_number() over(partition by lane order by (amount is null),amount desc,sort_at asc nulls last,stable_id) ordinal,
   case when amount is null then 'value_unknown'
    when sort_at is not null and count(*) over(partition by lane,amount)>1 then 'due_soon'
    else 'value_known' end rank_reason
  from lanes
 )
 select jsonb_build_object('policyVersion','today-v1','generatedAt',now(),
  'unblock',jsonb_build_object('total',(select count(*) from unblock),'rows',
   coalesce((select jsonb_agg(item||jsonb_build_object('rankReason',rank_reason) order by ordinal)
    from ranked where lane='unblock' and ordinal<=5),'[]'::jsonb)),
  -- G2 intentionally composes page 1; its total still includes unshown windows.
  'grow',jsonb_build_object('total',(select count(*) from grow)+(v_windows->>'total')::bigint-jsonb_array_length(v_windows->'rows'),'rows',
   coalesce((select jsonb_agg(item||jsonb_build_object('rankReason',rank_reason) order by ordinal)
    from ranked where lane='grow' and ordinal<=5),'[]'::jsonb))) into v_result;
 return v_result;
end$$;

revoke all on function public.stockflow_today_gateway(text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.stockflow_today_gateway(text,text,text,jsonb) to service_role;
commit;
notify pgrst,'reload schema';
