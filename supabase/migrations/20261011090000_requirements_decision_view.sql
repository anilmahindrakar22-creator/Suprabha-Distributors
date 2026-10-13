begin;

-- Advisory decision view: both gateways only read operational projections.
-- Rebuildable operational projection. No inventory ledger or allocation write.
create or replace function public.stockflow_requirements_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,extensions as $$
declare
  v_hash text; v_snapshot jsonb; v_fetched text; v_page integer; v_result jsonb;
begin
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_hash then raise exception 'Unauthorized gateway' using errcode='42501'; end if;
  if not exists(select 1 from public.stockflow_members where email=lower(btrim(coalesce(p_actor_email,''))) and status='active') then raise exception 'Active membership required' using errcode='42501'; end if;
  if p_action is distinct from 'get_requirements' then raise exception 'Unsupported requirements action' using errcode='22023'; end if;
  v_page:=coalesce((p_payload->>'page')::integer,1);
  if v_page<1 or v_page>4000 then raise exception 'Invalid requirements page' using errcode='22023'; end if;
  select payload,coalesce(nullif(payload->'sourceFetchedAtIso'->>'catalog',''),nullif(payload->>'catalogVersion',''),nullif(payload->>'fetchedAtIso',''),nullif(payload->>'fetchedAt',''),fetched_at)
    into v_snapshot,v_fetched from public.stockflow_snapshots where id='suprabha';
  with demand as (
    select l.tally_item_key,min(l.item_name) as item_name,
      sum(greatest(l.quantity-l.fulfilled_quantity,0)) as open_demand,
      count(distinct o.id) as affected_orders,min(o.created_at) as oldest_order_at,
      max(case o.priority when 'urgent' then 3 when 'high' then 2 else 1 end) as priority_rank
    from private.stockflow_orders o join private.stockflow_order_lines l on l.order_id=o.id
    where o.archived_at is null and o.status not in ('draft','phone_order_received','awaiting_confirmation','awaiting_approval','cancelled','delivered')
      and l.quantity>l.fulfilled_quantity
    group by l.tally_item_key
  ), stock as (
    select item->>'tallyKey' as tally_key,
      case when count(*)=1 then min(case when char_length(item->>'closing')<=30 and item->>'closing' ~ '^-?[0-9]+(\.[0-9]+)?$' then (item->>'closing')::numeric end) end as current_stock
    from jsonb_array_elements(case when jsonb_typeof(v_snapshot->'catalog')='array' then v_snapshot->'catalog' else '[]'::jsonb end) item
    group by item->>'tallyKey'
  ), requirements as (
    select d.*,s.current_stock,
      case when s.current_stock is null then null else greatest(d.open_demand-greatest(s.current_stock,0),0) end as shortage
    from demand d left join stock s on s.tally_key=d.tally_item_key
  ), classified as (
    select *,case when shortage>0 then 'shortage' when current_stock is null then 'unknown' else 'covered' end as state,
      case when shortage>0 then 0 when current_stock is null then 1 else 2 end as state_rank
    from requirements
  ), paged as (
    select * from classified order by state_rank,priority_rank desc,oldest_order_at,tally_item_key limit 25 offset (v_page-1)*25
  )
  select jsonb_build_object(
    'fetchedAt',v_fetched,
    'counts',(select jsonb_build_object('shortageItems',count(*) filter (where state='shortage'),
      'unknownItems',count(*) filter (where state='unknown'),'coveredItems',count(*) filter (where state='covered')) from classified),
    'rows',coalesce((select jsonb_agg(jsonb_build_object('tallyKey',tally_item_key,'itemName',item_name,
      'openDemand',open_demand,'currentStock',current_stock,'shortage',shortage,'affectedOrders',affected_orders,
      'priority',case priority_rank when 3 then 'urgent' when 2 then 'high' else 'normal' end,'oldestOrderAt',oldest_order_at,'state',state)
      order by state_rank,priority_rank desc,oldest_order_at,tally_item_key) from paged),'[]'::jsonb),
    'pagination',jsonb_build_object('page',v_page,'pageCount',greatest(1,ceil((select count(*) from requirements)/25.0)),'total',(select count(*) from requirements))
  ) into v_result;
  return v_result;
end $$;
revoke all on function public.stockflow_requirements_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_requirements_gateway(text,text,text,jsonb) to service_role;

create or replace function public.stockflow_stock_alert_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,extensions as $$
declare v_hash text; v_page integer; v_result jsonb;
begin
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_hash then raise exception 'Unauthorized gateway' using errcode='42501'; end if;
  if not exists(select 1 from public.stockflow_members where email=lower(btrim(coalesce(p_actor_email,''))) and status='active') then raise exception 'Active membership required' using errcode='42501'; end if;
  if p_action is distinct from 'get_stock_alerts' then raise exception 'Unsupported alert action' using errcode='22023'; end if;
  v_page:=coalesce((p_payload->>'page')::integer,1);
  if v_page<1 or v_page>4000 then raise exception 'Invalid alert page' using errcode='22023'; end if;
  with alerts as (
    select e.metadata->>'tallyKey' as tally_key,min(e.metadata->>'itemName') as item_name,
      (e.metadata->>'stockBefore')::numeric as stock_before,(e.metadata->>'stockAfter')::numeric as stock_after,
      e.metadata->>'catalogSourceAt' as source_at,count(distinct o.id) as affected_orders
    from private.stockflow_order_events e join private.stockflow_orders o on o.id=e.order_id
    where e.event_type='stock_increase_reported' and e.created_at>=now()-interval '7 days'
      and o.archived_at is null and o.status not in ('draft','phone_order_received','awaiting_confirmation','awaiting_approval','cancelled','delivered')
      and exists(select 1 from private.stockflow_order_lines l where l.order_id=o.id and l.tally_item_key=e.metadata->>'tallyKey' and l.quantity>l.fulfilled_quantity)
    group by e.metadata->>'tallyKey',e.metadata->>'stockBefore',e.metadata->>'stockAfter',e.metadata->>'catalogSourceAt'
  ), paged as (
    select * from alerts order by source_at desc,tally_key limit 20 offset (v_page-1)*20
  ), stock as (
    select item->>'tallyKey' as tally_key,
      case when count(*)=1 then min(case when char_length(item->>'closing')<=30 and item->>'closing' ~ '^-?[0-9]+(\.[0-9]+)?$' then (item->>'closing')::numeric end) end as current_stock
    from public.stockflow_snapshots snap
    cross join lateral jsonb_array_elements(case when jsonb_typeof(snap.payload->'catalog')='array' then snap.payload->'catalog' else '[]'::jsonb end) item
    where snap.id='suprabha' and item->>'tallyKey' in (select tally_key from paged)
    group by item->>'tallyKey'
  ), waiting as (
    select l.tally_item_key,o.id,o.created_at,
      case o.priority when 'urgent' then 3 when 'high' then 2 else 1 end as priority_rank,
      sum(l.quantity-l.fulfilled_quantity) as remaining
    from private.stockflow_orders o join private.stockflow_order_lines l on l.order_id=o.id
    where o.archived_at is null and o.status not in ('draft','phone_order_received','awaiting_confirmation','awaiting_approval','cancelled','delivered')
      and l.quantity>l.fulfilled_quantity and l.tally_item_key in (select tally_key from paged)
    group by l.tally_item_key,o.id
  ), cumulative as (
    select *,sum(remaining) over (partition by tally_item_key order by priority_rank desc,created_at,id rows unbounded preceding) as cumulative_remaining
    from waiting
  ), coverage as (
    select w.tally_item_key,count(*) as waiting_orders,sum(w.remaining) as waiting_quantity,
      count(*) filter (where w.cumulative_remaining<=greatest(s.current_stock,0)) as covered_orders
    from cumulative w left join stock s on s.tally_key=w.tally_item_key
    group by w.tally_item_key
  ), enriched as (
    select p.*,s.current_stock,coalesce(c.waiting_orders,0) as waiting_orders,coalesce(c.waiting_quantity,0) as waiting_quantity,
      case when s.current_stock is null then null else coalesce(c.covered_orders,0) end as covered_orders
    from paged p left join stock s on s.tally_key=p.tally_key left join coverage c on c.tally_item_key=p.tally_key
  )
  select jsonb_build_object('windowDays',7,'alerts',coalesce((select jsonb_agg(jsonb_build_object('tallyKey',tally_key,'itemName',item_name,
    'stockBefore',stock_before,'stockAfter',stock_after,'sourceAt',source_at,'affectedOrders',affected_orders,
    'currentStock',current_stock,'waitingOrders',waiting_orders,'waitingQuantity',waiting_quantity,'coveredOrders',covered_orders)
    order by source_at desc,tally_key) from enriched),'[]'::jsonb),
    'pagination',jsonb_build_object('page',v_page,'pageCount',greatest(1,ceil((select count(*) from alerts)/20.0)),
      'total',(select count(*) from alerts))) into v_result;
  return v_result;
end $$;
revoke all on function public.stockflow_stock_alert_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_stock_alert_gateway(text,text,text,jsonb) to service_role;

commit;
