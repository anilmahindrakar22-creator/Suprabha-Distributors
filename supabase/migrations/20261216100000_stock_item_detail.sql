begin;

create function private.stockflow_stock_item_detail(p_item_key text, p_today date, p_show_supplier boolean, p_show_rate boolean) returns jsonb
language sql stable security definer set search_path=pg_catalog,private,public,extensions as $$
with catalogs as materialized (
  select distinct on(company_id) company_id,content from private.stockflow_economic_item_catalogs
  order by company_id,observed_at desc,id desc
), names as materialized (
  select distinct c.company_id,p->>'id' as product_id
  from catalogs c cross join lateral jsonb_array_elements(c.content->'products') p
  where p->>'name'=p_item_key
), item_lines as materialized (
  -- Narrow to this item's product ids before examining voucher revisions.
  select v.company_id,v.source_id,v.source_revision,v.business_date,v.kind,v.cancelled,l.quantity
  from names n join private.stockflow_economic_source_lines l on l.product_id=n.product_id
  join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id and v.company_id=n.company_id
  where v.business_date>=(date_trunc('month',p_today::timestamp)-interval '5 months')::date
    and v.business_date<=p_today
), usage as (
  select date_trunc('month',v.business_date::timestamp)::date as month,
    sum(case when v.kind='sale' then v.quantity else -v.quantity end) as sold
  from item_lines v
  where not v.cancelled and v.kind in ('sale','return','credit')
    and not exists(select 1 from private.stockflow_economic_source_vouchers n
      where n.company_id=v.company_id and n.source_id=v.source_id and n.source_revision>v.source_revision)
  group by 1
), months as (
  select (date_trunc('month',p_today::timestamp)-make_interval(months=>i))::date as month
  from generate_series(5,0,-1) i
), outstanding as materialized (
  select p.id,p.po_number,p.created_at,l.quantity-l.received_quantity as due
  from private.stockflow_purchase_order_lines l join private.stockflow_purchase_orders p on p.id=l.po_id
  where l.tally_item_key=p_item_key and p.status='open' and l.quantity-l.received_quantity>0
), po_list as (
  select * from outstanding order by created_at desc,po_number desc limit 10
), demand as (
  select count(distinct o.id) as orders,coalesce(sum(greatest(l.quantity-l.fulfilled_quantity,0)),0) as quantity
  from private.stockflow_orders o join private.stockflow_order_lines l on l.order_id=o.id
  where l.tally_item_key=p_item_key and o.archived_at is null
    and o.status not in ('draft','phone_order_received','awaiting_confirmation','awaiting_approval','cancelled','delivered')
    and l.quantity>l.fulfilled_quantity
), supplier as (
  select supplier_name,unit,effective_at,rate from private.stockflow_supplier_prices
  where p_show_supplier and tally_item_key=p_item_key
  order by effective_at desc,imported_at desc,supplier_name limit 1
)
select jsonb_build_object('view','item_detail','itemKey',p_item_key,'asOf',p_today,
  'months',(select jsonb_agg(jsonb_build_object('month',to_char(m.month,'YYYY-MM'),'sold',round(coalesce(u.sold,0),3)) order by m.month)
    from months m left join usage u on u.month=m.month),
  'openPos',coalesce((select jsonb_agg(jsonb_build_object('poNumber',po_number,'due',round(due,3),'createdAt',created_at)
    order by created_at desc,po_number desc) from po_list),'[]'::jsonb),
  'openPoCount',(select count(distinct id) from outstanding),
  'waiting',(select jsonb_build_object('orders',orders,'quantity',quantity) from demand))
  || case when p_show_supplier then jsonb_build_object('supplierPrice',
    (select jsonb_build_object('name',supplier_name,'unit',unit,'effectiveAt',effective_at)
      || case when p_show_rate then jsonb_build_object('rate',rate) else '{}'::jsonb end from supplier))
    else '{}'::jsonb end
$$;
revoke all on function private.stockflow_stock_item_detail(text,date,boolean,boolean) from public,anon,authenticated,service_role;

alter function public.stockflow_requirements_gateway(text,text,text,jsonb)
  rename to stockflow_requirements_gateway_before_item_detail;
create function public.stockflow_requirements_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,extensions as $$
declare v_hash text; v_roles text[]; v_show_supplier boolean; v_show_rate boolean;
begin
  if p_action='get_requirements' and coalesce(p_payload->>'view','')='item_detail' then
    select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
    if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_hash then
      raise exception 'Unauthorized gateway' using errcode='42501';
    end if;
    select roles into v_roles from public.stockflow_members
      where email=lower(btrim(coalesce(p_actor_email,''))) and status='active';
    if not found then
      raise exception 'Active membership required' using errcode='42501';
    end if;
    if jsonb_typeof(p_payload) is distinct from 'object'
      or p_payload - array['view','itemKey'] <> '{}'::jsonb
      or jsonb_typeof(p_payload->'itemKey') is distinct from 'string'
      or char_length(p_payload->>'itemKey') not between 1 and 220
      or btrim(p_payload->>'itemKey')='' then
      raise exception 'Invalid requirements view' using errcode='22023';
    end if;
    v_show_supplier := coalesce(private.stockflow_valid_roles(v_roles) and v_roles && array['administrator','management','operations'], false);
    v_show_rate := coalesce(private.stockflow_valid_roles(v_roles) and v_roles && array['administrator','management'], false);
    return private.stockflow_stock_item_detail(p_payload->>'itemKey', (now() at time zone 'Asia/Kolkata')::date, v_show_supplier, v_show_rate);
  end if;
  return public.stockflow_requirements_gateway_before_item_detail(p_gateway_key,p_actor_email,p_action,p_payload);
end $$;
revoke all on function public.stockflow_requirements_gateway_before_item_detail(text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.stockflow_requirements_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_requirements_gateway(text,text,text,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
