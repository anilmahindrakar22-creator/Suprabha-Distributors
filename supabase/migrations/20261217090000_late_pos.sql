begin;

create or replace function private.stockflow_stock_on_po() returns jsonb
language sql stable security definer set search_path=pg_catalog,private,public as $$
with clock as (
  select (now() at time zone 'Asia/Kolkata')::date as v_today
), policy as (
  select lead_time_days from private.stockflow_stock_policies,clock
  where effective_from<=v_today order by effective_from desc,created_at desc limit 1
), outstanding as (
  select l.tally_item_key,l.quantity-l.received_quantity as due,p.id,p.po_number,p.created_at,
    case when policy.lead_time_days is null then 0 else
      greatest(0,(v_today-(p.created_at at time zone 'Asia/Kolkata')::date)-policy.lead_time_days) end as late_days
  from private.stockflow_purchase_order_lines l
  join private.stockflow_purchase_orders p on p.id=l.po_id
  cross join clock left join policy on true
  where p.status='open' and l.quantity-l.received_quantity>0
), grouped as (
  select tally_item_key,round(sum(due),3) as due_quantity,count(distinct id) as po_count,
    (array_agg(po_number order by created_at desc,po_number desc))[1] as latest_po_number,
    max(created_at) as latest_created_at,max(late_days) as late_days,
    (array_agg(po_number order by late_days desc,po_number) filter(where late_days>0))[1] as late_po_number
  from outstanding group by tally_item_key
  order by tally_item_key collate "C" limit 2000
)
select jsonb_build_object('view','on_po','items',coalesce((select jsonb_agg(
  jsonb_build_object('itemKey',tally_item_key,'dueQuantity',due_quantity,'poCount',po_count,
    'latestPoNumber',latest_po_number,'latestCreatedAt',latest_created_at,
    'lateDays',late_days,'latePoNumber',late_po_number)
  order by tally_item_key collate "C") from grouped),'[]'::jsonb))
$$;
revoke all on function private.stockflow_stock_on_po() from public,anon,authenticated,service_role;

create function private.stockflow_late_pos() returns jsonb
language sql stable security definer set search_path=pg_catalog,private,public as $$
with clock as (
  select (now() at time zone 'Asia/Kolkata')::date as v_today
), policy as (
  select lead_time_days from private.stockflow_stock_policies,clock
  where effective_from<=v_today order by effective_from desc,created_at desc limit 1
), overdue as (
  select p.po_number,p.supplier_name,p.created_at,
    greatest(0,(v_today-(p.created_at at time zone 'Asia/Kolkata')::date)-policy.lead_time_days) as late_days,
    count(*) as due_lines,round(sum(l.quantity-l.received_quantity),3) as due_quantity
  from private.stockflow_purchase_orders p
  join private.stockflow_purchase_order_lines l on l.po_id=p.id
  cross join clock cross join policy
  where p.status='open' and l.quantity-l.received_quantity>0
  group by p.id,v_today,policy.lead_time_days
  having greatest(0,(v_today-(p.created_at at time zone 'Asia/Kolkata')::date)-policy.lead_time_days)>0
), limited as (
  select * from overdue order by late_days desc,po_number limit 100
)
select jsonb_build_object('view','late_pos','leadTimeDays',(select lead_time_days from policy),
  'total',(select count(*) from overdue),'items',coalesce((select jsonb_agg(
    jsonb_build_object('poNumber',po_number,'supplierName',supplier_name,'createdAt',created_at,
      'lateDays',late_days,'dueLines',due_lines,'dueQuantity',due_quantity)
    order by late_days desc,po_number) from limited),'[]'::jsonb))
$$;
revoke all on function private.stockflow_late_pos() from public,anon,authenticated,service_role;

alter function public.stockflow_requirements_gateway(text,text,text,jsonb)
  rename to stockflow_requirements_gateway_before_late_pos;
create function public.stockflow_requirements_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,extensions as $$
declare v_hash text; v_roles text[];
begin
  if p_action='get_requirements' and coalesce(p_payload->>'view','')='late_pos' then
    select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
    if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_hash then
      raise exception 'Unauthorized gateway' using errcode='42501';
    end if;
    select roles into v_roles from public.stockflow_members
      where email=lower(btrim(coalesce(p_actor_email,''))) and status='active';
    if not found then
      raise exception 'Active membership required' using errcode='42501';
    end if;
    if not coalesce(private.stockflow_valid_roles(v_roles) and v_roles && array['administrator','management','operations'],false) then
      raise exception 'Role cannot see late purchase orders' using errcode='42501';
    end if;
    if p_payload - 'view' <> '{}'::jsonb then
      raise exception 'Invalid requirements view' using errcode='22023';
    end if;
    return private.stockflow_late_pos();
  end if;
  return public.stockflow_requirements_gateway_before_late_pos(p_gateway_key,p_actor_email,p_action,p_payload);
end $$;
revoke all on function public.stockflow_requirements_gateway_before_late_pos(text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.stockflow_requirements_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_requirements_gateway(text,text,text,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
