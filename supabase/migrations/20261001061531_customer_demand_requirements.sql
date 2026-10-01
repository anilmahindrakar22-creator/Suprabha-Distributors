-- Rebuildable operational projection. No inventory ledger or allocation write.
create function public.stockflow_requirements_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb)
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
  ), paged as (
    select * from requirements order by priority_rank desc,oldest_order_at,tally_item_key limit 25 offset (v_page-1)*25
  )
  select jsonb_build_object(
    'fetchedAt',v_fetched,
    'rows',coalesce((select jsonb_agg(jsonb_build_object('tallyKey',tally_item_key,'itemName',item_name,
      'openDemand',open_demand,'currentStock',current_stock,'shortage',shortage,'affectedOrders',affected_orders,
      'priority',case priority_rank when 3 then 'urgent' when 2 then 'high' else 'normal' end,'oldestOrderAt',oldest_order_at)
      order by priority_rank desc,oldest_order_at,tally_item_key) from paged),'[]'::jsonb),
    'pagination',jsonb_build_object('page',v_page,'pageCount',greatest(1,ceil((select count(*) from requirements)/25.0)),'total',(select count(*) from requirements))
  ) into v_result;
  return v_result;
end $$;
revoke all on function public.stockflow_requirements_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_requirements_gateway(text,text,text,jsonb) to service_role;
