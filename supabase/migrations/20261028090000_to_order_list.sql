begin;

alter function public.stockflow_requirements_gateway(text,text,text,jsonb)
  rename to stockflow_requirements_gateway_before_to_order;

-- Operational read only; StockFlow demand replaces Tally salesOrder (zero today).
-- Do not add salesOrder again: that would double-count customer demand.
create function private.stockflow_to_order(p_page int)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private,extensions as $$
declare v_snapshot jsonb; v_result jsonb;
begin
  if p_page is null or p_page<1 or p_page>4000 then
    raise exception 'Invalid requirements page' using errcode='22023';
  end if;
  select payload into v_snapshot from public.stockflow_snapshots where id='suprabha';
  with demand as (
    select l.tally_item_key,min(l.item_name) as item_name,
      sum(greatest(l.quantity-l.fulfilled_quantity,0)) as open_demand,
      count(distinct o.id) as waiting_orders,min(o.created_at) as oldest_order_at
    from private.stockflow_orders o join private.stockflow_order_lines l on l.order_id=o.id
    where o.archived_at is null
      and o.status not in ('draft','phone_order_received','awaiting_confirmation','awaiting_approval','cancelled','delivered')
      and l.quantity>l.fulfilled_quantity
    group by l.tally_item_key
  ), catalog as (
    select item->>'tallyKey' as item_key,min(item->>'group') as item_group,
      case when count(*)=1 then min(case
        when char_length(item->>'closing')<=30 and item->>'closing' ~ '^-?[0-9]+(\.[0-9]+)?$'
        then (item->>'closing')::numeric end) end as closing
    from jsonb_array_elements(case when jsonb_typeof(v_snapshot->'catalog')='array'
      then v_snapshot->'catalog' else '[]'::jsonb end) item
    group by item->>'tallyKey'
  ), reorder_values as (
    select item->>'item' as item_key,item->>'group' as item_group,n.*
    from jsonb_array_elements(case when jsonb_typeof(v_snapshot->'rows')='array'
      then v_snapshot->'rows' else '[]'::jsonb end) item
    cross join lateral (
      select max(value) filter (where key='closing') as closing,
        max(value) filter (where key='reorderLevel') as reorder_level,
        max(value) filter (where key='minimumOrder') as minimum_order,
        max(value) filter (where key='purchaseOrder') as purchase_order,
        max(value) filter (where key='orderToBePlaced') as order_to_be_placed
      from (
        select key,case when char_length(item->>key)<=30
          and item->>key ~ '^-?[0-9]+(\.[0-9]+)?$' then (item->>key)::numeric end as value
        from unnest(array['closing','reorderLevel','minimumOrder','purchaseOrder','orderToBePlaced']) key
      ) parsed
    ) n
    where nullif(item->>'item','') is not null
  ), reorder as (
    -- Duplicate evidence must not multiply demand or invent stock availability.
    select item_key,min(item_group) as item_group,
      case when count(*)=1 then min(closing) end as closing,
      case when count(*)=1 then min(reorder_level) end as reorder_level,
      case when count(*)=1 then min(minimum_order) end as minimum_order,
      case when count(*)=1 then min(purchase_order) end as purchase_order,
      case when count(*)=1 then min(order_to_be_placed) end as order_to_be_placed
    from reorder_values group by item_key
  ), item_keys as (
    select item_key from reorder union select tally_item_key from demand
  ), combined as (
    select k.item_key,coalesce(d.item_name,k.item_key) as item_name,
      coalesce(r.item_group,c.item_group) as item_group,
      case when r.item_key is not null then r.closing else c.closing end as closing,
      r.reorder_level,r.minimum_order,r.purchase_order,r.order_to_be_placed,
      coalesce(d.open_demand,0) as open_demand,coalesce(d.waiting_orders,0) as waiting_orders,
      d.oldest_order_at
    from item_keys k left join reorder r on r.item_key=k.item_key
    left join demand d on d.tally_item_key=k.item_key left join catalog c on c.item_key=k.item_key
  ), calculated as (
    select *,open_demand+coalesce(reorder_level,0)-closing-coalesce(purchase_order,0) as need,
      coalesce(open_demand>0 and open_demand>closing,false) as waiting,
      array_remove(array[case when open_demand>0 and open_demand>closing then 'waiting_orders' end,
        case when order_to_be_placed>0 then 'below_reorder' end],null) as reasons
    from combined
  ), listed as (
    select *,case when closing is null then 'stock_unknown' else 'order' end as state,
      case when closing is not null then ceil(greatest(need,coalesce(minimum_order,0))) end as suggested_qty
    from calculated where need>0 or (closing is null and open_demand>0)
  ), ranked as (
    select *,row_number() over (order by (state='stock_unknown'),waiting desc,
      case when waiting then oldest_order_at end asc nulls last,
      case when not waiting then suggested_qty/greatest(reorder_level,minimum_order,1) end desc nulls last,
      item_name,item_key) as position from listed
  ), paged as (
    select * from ranked order by position limit 25 offset (p_page-1)*25
  )
  select jsonb_build_object('view','to_order','page',p_page,'pageSize',25,
    'total',(select count(*) from listed where state='order'),
    'waitingCount',(select count(*) from listed where waiting),
    'unknownCount',(select count(*) from listed where state='stock_unknown'),
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'itemKey',item_key,'itemName',item_name,'group',item_group,'closing',closing,
      'reorderLevel',reorder_level,'minimumOrder',minimum_order,'tallyOpenPurchase',purchase_order,
      'openDemand',open_demand,'waitingOrders',waiting_orders,'oldestOrderAt',oldest_order_at,
      'reasons',reasons,'state',state,'suggestedQty',suggested_qty) order by position) from paged),'[]'::jsonb))
    into v_result;
  return v_result;
end $$;

create function public.stockflow_requirements_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,extensions as $$
declare v_hash text;
begin
  if p_action='get_requirements' and coalesce(p_payload->>'view','')='to_order' then
    select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
    if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_hash then
      raise exception 'Unauthorized gateway' using errcode='42501';
    end if;
    if not exists(select 1 from public.stockflow_members
      where email=lower(btrim(coalesce(p_actor_email,''))) and status='active') then
      raise exception 'Active membership required' using errcode='42501';
    end if;
    return private.stockflow_to_order(coalesce((p_payload->>'page')::integer,1));
  end if;
  return public.stockflow_requirements_gateway_before_to_order(p_gateway_key,p_actor_email,p_action,p_payload);
end $$;
revoke all on function private.stockflow_to_order(int) from public,anon,authenticated,service_role;
revoke all on function public.stockflow_requirements_gateway_before_to_order(text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.stockflow_requirements_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_requirements_gateway(text,text,text,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
