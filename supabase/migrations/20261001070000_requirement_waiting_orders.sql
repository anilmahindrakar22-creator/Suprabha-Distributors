-- Bounded operational drilldown; no commercial facts or allocation writes.
create index stockflow_waiting_lines_item_order_idx on private.stockflow_order_lines(tally_item_key,order_id)
  where quantity>fulfilled_quantity;
create function public.stockflow_requirement_orders_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,extensions as $$
declare v_hash text; v_key text; v_page integer; v_result jsonb;
begin
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_hash then raise exception 'Unauthorized gateway' using errcode='42501'; end if;
  if not exists(select 1 from public.stockflow_members where email=lower(btrim(coalesce(p_actor_email,''))) and status='active') then raise exception 'Active membership required' using errcode='42501'; end if;
  if p_action is distinct from 'get_requirement_orders' then raise exception 'Unsupported requirements action' using errcode='22023'; end if;
  v_key:=p_payload->>'itemKey';
  v_page:=coalesce((p_payload->>'page')::integer,1);
  if v_key is null or char_length(v_key)<1 or char_length(v_key)>220 or v_page<1 or v_page>4000 then raise exception 'Invalid requirement query' using errcode='22023'; end if;
  with waiting as (
    select o.id,o.order_number,o.customer_name,o.status,o.priority,o.created_at,
      sum(l.quantity-l.fulfilled_quantity) as remaining_quantity,
      case o.priority when 'urgent' then 3 when 'high' then 2 else 1 end as priority_rank
    from private.stockflow_orders o join private.stockflow_order_lines l on l.order_id=o.id
    where l.tally_item_key=v_key and o.archived_at is null
      and o.status not in ('draft','phone_order_received','awaiting_confirmation','awaiting_approval','cancelled','delivered')
      and l.quantity>l.fulfilled_quantity
    group by o.id
  ), paged as (
    select * from waiting order by priority_rank desc,created_at,id limit 20 offset (v_page-1)*20
  )
  select jsonb_build_object('orders',coalesce((select jsonb_agg(jsonb_build_object(
    'orderId',id,'orderNumber',coalesce(order_number,id::text),'customerName',customer_name,
    'status',status,'remainingQuantity',remaining_quantity,'priority',priority,'createdAt',created_at)
    order by priority_rank desc,created_at,id) from paged),'[]'::jsonb),
    'pagination',jsonb_build_object('page',v_page,'pageCount',greatest(1,ceil((select count(*) from waiting)/20.0)),
    'total',(select count(*) from waiting))) into v_result;
  return v_result;
end $$;
revoke all on function public.stockflow_requirement_orders_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_requirement_orders_gateway(text,text,text,jsonb) to service_role;
