-- Advisory only: an increase reported by Tally is not a reservation or receipt.
create unique index stockflow_stock_notice_dedup_idx on private.stockflow_order_events
  (order_id,(metadata->>'tallyKey'),(metadata->>'catalogSourceAt')) where event_type='stock_increase_reported';
create index stockflow_stock_notice_created_idx on private.stockflow_order_events(created_at desc)
  where event_type='stock_increase_reported';

create function private.stockflow_report_stock_increase()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare v_old_source text; v_new_source text; v_old_at timestamptz; v_new_at timestamptz; v_source text;
begin
  if new.id<>'suprabha' or new.company is distinct from old.company then return new; end if;
  v_old_source:=coalesce(nullif(old.payload->'sourceFetchedAtIso'->>'catalog',''),nullif(old.payload->>'catalogVersion',''));
  v_new_source:=coalesce(nullif(new.payload->'sourceFetchedAtIso'->>'catalog',''),nullif(new.payload->>'catalogVersion',''));
  if v_new_source is null or v_old_source is null or v_new_source=v_old_source then return new; end if;
  begin
    v_old_at:=v_old_source::timestamptz; v_new_at:=v_new_source::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then return new; end;
  if not isfinite(v_old_at) or not isfinite(v_new_at) or v_new_at<=v_old_at then return new; end if;
  if jsonb_typeof(old.payload->'catalog') is distinct from 'array' or jsonb_typeof(new.payload->'catalog') is distinct from 'array' then return new; end if;
  if not exists(select 1 from private.stockflow_orders o join private.stockflow_order_lines l on l.order_id=o.id
    where o.archived_at is null and o.status not in ('draft','phone_order_received','awaiting_confirmation','awaiting_approval','cancelled','delivered')
      and l.quantity>l.fulfilled_quantity) then return new; end if;
  v_source:=to_char(v_new_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  with waiting as materialized (
    select o.id,l.tally_item_key,min(l.item_name) as item_name,sum(l.quantity-l.fulfilled_quantity) as remaining
    from private.stockflow_orders o join private.stockflow_order_lines l on l.order_id=o.id
    where o.archived_at is null and o.status not in ('draft','phone_order_received','awaiting_confirmation','awaiting_approval','cancelled','delivered')
      and l.quantity>l.fulfilled_quantity group by o.id,l.tally_item_key
  ), before_stock as (
    select item->>'tallyKey' as tally_key,
      case when count(*)=1 then min(case when char_length(item->>'closing')<=30 and item->>'closing' ~ '^-?[0-9]+(\.[0-9]+)?$' then (item->>'closing')::numeric end) end as quantity
    from jsonb_array_elements(old.payload->'catalog') item
    where item->>'tallyKey' in (select tally_item_key from waiting) group by item->>'tallyKey'
  ), after_stock as (
    select item->>'tallyKey' as tally_key,
      case when count(*)=1 then min(case when char_length(item->>'closing')<=30 and item->>'closing' ~ '^-?[0-9]+(\.[0-9]+)?$' then (item->>'closing')::numeric end) end as quantity
    from jsonb_array_elements(new.payload->'catalog') item
    where item->>'tallyKey' in (select tally_item_key from waiting) group by item->>'tallyKey'
  ), notices as (
    insert into private.stockflow_order_events(order_id,event_type,reason,actor_email,actor_role,metadata)
    select w.id,'stock_increase_reported','Tally reported more stock; review availability before fulfilment.','tally-sync','system',
      jsonb_build_object('tallyKey',w.tally_item_key,'itemName',w.item_name,'stockBefore',b.quantity,
        'stockAfter',a.quantity,'catalogSourceAt',v_source,'remainingQuantity',w.remaining)
    from waiting w join before_stock b on b.tally_key=w.tally_item_key join after_stock a on a.tally_key=w.tally_item_key
    where a.quantity>0 and a.quantity>b.quantity
    on conflict do nothing returning order_id,metadata
  )
  insert into private.stockflow_outbox(topic,aggregate_id,payload)
    select 'stockflow.stock_increase_reported',order_id,metadata from notices;
  return new;
end $$;
revoke all on function private.stockflow_report_stock_increase() from public,anon,authenticated;
create trigger stockflow_report_stock_increase after update of payload on public.stockflow_snapshots
  for each row execute function private.stockflow_report_stock_increase();

create function public.stockflow_stock_alert_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb)
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
  )
  select jsonb_build_object('alerts',coalesce((select jsonb_agg(jsonb_build_object('tallyKey',tally_key,'itemName',item_name,
    'stockBefore',stock_before,'stockAfter',stock_after,'sourceAt',source_at,'affectedOrders',affected_orders)
    order by source_at desc,tally_key) from paged),'[]'::jsonb),
    'pagination',jsonb_build_object('page',v_page,'pageCount',greatest(1,ceil((select count(*) from alerts)/20.0)),
      'total',(select count(*) from alerts))) into v_result;
  return v_result;
end $$;
revoke all on function public.stockflow_stock_alert_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_stock_alert_gateway(text,text,text,jsonb) to service_role;
