begin;

create table private.stockflow_item_demand_estimates (
  id bigint generated always as identity primary key,
  request_id uuid not null unique,
  item_key text not null check (length(btrim(item_key)) between 1 and 220),
  monthly_qty numeric not null check (monthly_qty > 0 and monthly_qty <= 1000000),
  reason text not null check (length(btrim(reason)) between 10 and 300),
  review_on date not null,
  created_by text not null,
  created_at timestamptz not null default now()
);
create index stockflow_item_demand_estimates_item on private.stockflow_item_demand_estimates (item_key, created_at desc, id desc);
create trigger stockflow_item_demand_estimates_append_only before update or delete
  on private.stockflow_item_demand_estimates for each row
  execute function private.stockflow_economic_exception_ack_append_only();
revoke all on private.stockflow_item_demand_estimates from public,anon,authenticated,service_role;

create function private.stockflow_set_item_demand_estimate(p_actor text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,private,public,extensions as $$
declare
  v_request uuid; v_item text; v_qty numeric; v_reason text; v_review date;
  v_today date:=(now() at time zone 'Asia/Kolkata')::date;
  v_row private.stockflow_item_demand_estimates%rowtype;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'Invalid expected use' using errcode='22023';
  end if;
  if not (p_payload ?& array['requestId','itemKey','monthlyQty','reason','reviewOn'])
    or p_payload-array['requestId','itemKey','monthlyQty','reason','reviewOn']<>'{}'::jsonb
    or jsonb_typeof(p_payload->'requestId') is distinct from 'string'
    or jsonb_typeof(p_payload->'itemKey') is distinct from 'string'
    or jsonb_typeof(p_payload->'monthlyQty') is distinct from 'number'
    or jsonb_typeof(p_payload->'reason') is distinct from 'string'
    or jsonb_typeof(p_payload->'reviewOn') is distinct from 'string'
    or length(btrim(p_payload->>'itemKey')) not between 1 and 220
    or length(btrim(p_payload->>'reason')) not between 10 and 300
    or (p_payload->>'reviewOn') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'Invalid expected use' using errcode='22023';
  end if;
  begin
    v_request:=(p_payload->>'requestId')::uuid;
    v_qty:=(p_payload->>'monthlyQty')::numeric;
    v_review:=(p_payload->>'reviewOn')::date;
  exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then
    raise exception 'Invalid expected use' using errcode='22023';
  end;
  v_item:=btrim(p_payload->>'itemKey');
  v_reason:=btrim(p_payload->>'reason');
  if v_qty<=0 or v_qty>1000000 or v_review<v_today+7 or v_review>v_today+183 then
    raise exception 'Invalid expected use' using errcode='22023';
  end if;
  -- Serialize retries before reading, so concurrent requests return the same audit row.
  perform pg_advisory_xact_lock(hashtext('stockflow-item-demand-estimate'),hashtext(v_request::text));
  select * into v_row from private.stockflow_item_demand_estimates where request_id=v_request;
  if not found then
    if not exists (
      select 1 from public.stockflow_snapshots s cross join lateral
        jsonb_array_elements(case when jsonb_typeof(s.payload->'catalog')='array'
          then s.payload->'catalog' else '[]'::jsonb end) item
      where s.id='suprabha' and item->>'item'=v_item
    ) or exists (
      with catalogs as materialized (
        select distinct on(company_id) company_id,content from private.stockflow_economic_item_catalogs
        order by company_id,observed_at desc,id desc
      ), names as materialized (
        select c.company_id,p->>'id' product_id,p->>'name' name
        from catalogs c cross join lateral jsonb_array_elements(c.content->'products') p
        where p->>'name'=v_item
      )
      select 1 from names n join private.stockflow_item_forecast f
        on f.company_id=n.company_id and f.product_id=n.product_id where not f.is_new
    ) then
      raise exception 'Only new items take an expected use' using errcode='22023';
    end if;
    insert into private.stockflow_item_demand_estimates(request_id,item_key,monthly_qty,reason,review_on,created_by)
    values(v_request,v_item,v_qty,v_reason,v_review,p_actor) returning * into v_row;
  end if;
  return jsonb_build_object('itemKey',v_row.item_key,'monthlyQty',v_row.monthly_qty,
    'reason',v_row.reason,'reviewOn',v_row.review_on,'setBy',v_row.created_by,'setAt',v_row.created_at);
end $$;
revoke all on function private.stockflow_set_item_demand_estimate(text,jsonb) from public,anon,authenticated,service_role;

create or replace function private.stockflow_forecast_trial(p_today date) returns jsonb
language sql stable security definer set search_path=pg_catalog,private,public,extensions as $$
with policy as (
  select lead_time_days from private.stockflow_stock_policies
  where effective_from<=p_today order by effective_from desc,created_at desc limit 1
), demand as (
    select l.tally_item_key,min(l.item_name) as item_name,
      sum(greatest(l.quantity-l.fulfilled_quantity,0)) as open_demand,
      count(distinct o.id) as waiting_orders,min(o.created_at) as oldest_order_at
    from private.stockflow_orders o join private.stockflow_order_lines l on l.order_id=o.id
    where o.archived_at is null
      and o.status not in ('draft','phone_order_received','awaiting_confirmation','awaiting_approval','cancelled','delivered')
      and l.quantity>l.fulfilled_quantity
    group by l.tally_item_key
), reorder_values as (
  select item->>'item' as item_key,
    case when char_length(item->>'closing')<=30 and item->>'closing' ~ '^-?[0-9]+(\.[0-9]+)?$'
      then (item->>'closing')::numeric end as closing,
    case when char_length(item->>'purchaseOrder')<=30 and item->>'purchaseOrder' ~ '^-?[0-9]+(\.[0-9]+)?$'
      then (item->>'purchaseOrder')::numeric end as purchase_order
  from public.stockflow_snapshots s cross join lateral
    jsonb_array_elements(case when jsonb_typeof(s.payload->'rows')='array'
      then s.payload->'rows' else '[]'::jsonb end) item
  where s.id='suprabha' and nullif(item->>'item','') is not null
), reorder as (
  select item_key,case when count(*)=1 then min(closing) end as closing,
    case when count(*)=1 then min(purchase_order) end as purchase_order
  from reorder_values group by item_key order by item_key collate "C" limit 2000
), latest as materialized (
  -- Check newer revisions across all dates, including moved/cancelled vouchers.
  select distinct on(v.company_id,v.source_id) v.*
  from private.stockflow_economic_source_vouchers v
  where v.business_date>p_today-90 and v.business_date<=p_today
    and not exists(select 1 from private.stockflow_economic_source_vouchers n
      where n.company_id=v.company_id and n.source_id=v.source_id and n.source_revision>v.source_revision)
  order by v.company_id,v.source_id,v.source_revision desc
), catalogs as materialized (
 select distinct on(company_id) company_id,content from private.stockflow_economic_item_catalogs
 order by company_id,observed_at desc,id desc
), names as materialized (
 select c.company_id,p->>'id' product_id,p->>'name' name
 from catalogs c cross join lateral jsonb_array_elements(c.content->'products') p
 where p->>'name' in (select item_key from reorder)
), window_lines as materialized (
  select v.company_id,v.kind,l.product_id,l.quantity
  from latest v join private.stockflow_economic_source_lines l on l.voucher_id=v.id
  where not v.cancelled and v.kind in ('sale','return','credit') and v.business_date>p_today-90
), usage as (
  select n.name as item_key,
    sum(case when w.kind='sale' then w.quantity else -w.quantity end) as used_90
  from window_lines w join names n on n.company_id=w.company_id and n.product_id=w.product_id
  group by n.name
), available as (
  select r.item_key,r.closing,u.used_90,
    r.closing+coalesce(r.purchase_order,0)-coalesce(d.open_demand,0) as available,
    case when u.used_90>0 then u.used_90/90.0 end as daily_use
  from reorder r left join demand d on d.tally_item_key=r.item_key
  left join usage u on u.item_key=r.item_key
), days as (
  select *,case when available is not null and daily_use is not null
    then floor(greatest(available,0)/daily_use)::integer end as days_left
  from available
), run as (
  select * from private.stockflow_forecast_runs order by computed_on desc limit 1
), estimates as (
  select distinct on (item_key) * from private.stockflow_item_demand_estimates
  order by item_key,created_at desc,id desc
), items as (
  select d.item_key,f.is_new,f.first_sale_month,round(d.used_90/90*30.4375,2) as now_monthly,
    d.days_left as now_days_left,round(f.avg6_rate,2) as avg6_monthly,round(f.cap12_rate,2) as cap12_monthly,
    case when f.avg6_rate>0 then floor(greatest(d.available,0)/(f.avg6_rate/30.4375))::integer end as avg6_days_left,
    case when f.cap12_rate>0 then floor(greatest(d.available,0)/(f.cap12_rate/30.4375))::integer end as cap12_days_left,
    e.monthly_qty,e.reason,e.review_on,e.created_by,e.created_at,
    case when e.monthly_qty>0 then floor(greatest(d.available,0)/(e.monthly_qty/30.4375))::integer end as estimate_days_left
  from names n join private.stockflow_item_forecast f on f.company_id=n.company_id and f.product_id=n.product_id
  join days d on d.item_key=n.name
  left join estimates e on e.item_key=d.item_key and f.is_new where d.used_90>0 and exists(select 1 from run)
), ranked as (
  select *,greatest(abs(cap12_monthly-now_monthly),abs(avg6_monthly-now_monthly))/greatest(now_monthly,0.01) as distance
  from items
), page as (
  select * from ranked order by distance desc,item_key collate "C" limit 200
), checks as (
  select horizon,segment,method,count(distinct cutoff_month) as cutoffs,sum(item_months) as item_months,
    round(100*sum(abs_error)/nullif(sum(actual),0),1) as wape,
    round(100*(sum(forecast)-sum(actual))/nullif(sum(actual),0),1) as bias
  from private.stockflow_forecast_checks where computed_on=(select computed_on from run)
  group by horizon,segment,method
)
select jsonb_build_object('view','forecast_trial','asOf',p_today,
  'computedAt',(select computed_at from run),'throughMonth',(select through_month from run),
  'stale',coalesce((select computed_at<now()-interval '36 hours' from run),true),
  'uncertifiedMonths',coalesce((select to_jsonb(uncertified_months) from run),'[]'::jsonb),
  'check',case when exists(select 1 from run) then coalesce((select jsonb_agg(jsonb_build_object(
    'horizon',horizon,'segment',segment,'method',method,'cutoffs',cutoffs,'itemMonths',item_months,'wape',wape,'bias',bias)
    order by horizon,case segment when 'established' then 0 else 1 end,
      case method when 'base' then 0 when 'avg6' then 1 else 2 end) from checks),'[]'::jsonb) end,
  'itemCount',(select count(*) from items),
  'items',coalesce((select jsonb_agg(jsonb_build_object('itemKey',item_key,'isNew',is_new,'firstSaleMonth',first_sale_month,
    'nowMonthly',now_monthly,'nowDaysLeft',now_days_left,'avg6Monthly',avg6_monthly,'avg6DaysLeft',avg6_days_left,
    'cap12Monthly',cap12_monthly,'cap12DaysLeft',cap12_days_left,
    'estimate',case when monthly_qty is not null then jsonb_build_object('monthly',round(monthly_qty,2),
      'daysLeft',estimate_days_left,'reason',reason,'reviewOn',review_on,'setBy',created_by,'setAt',created_at) end) order by distance desc,item_key collate "C") from page),'[]'::jsonb))
$$;
revoke all on function private.stockflow_forecast_trial(date) from public,anon,authenticated,service_role;

alter function public.stockflow_requirements_gateway(text,text,text,jsonb)
  rename to stockflow_requirements_gateway_before_item_estimates;
create function public.stockflow_requirements_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private,public,extensions as $$
declare v_hash text; v_roles text[];
begin
  if p_action='set_item_demand_estimate' then
    select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
    if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_hash then
      raise exception 'Unauthorized gateway' using errcode='42501';
    end if;
    select roles into v_roles from public.stockflow_members
      where email=lower(btrim(coalesce(p_actor_email,''))) and status='active';
    if not found or not coalesce(private.stockflow_valid_roles(v_roles) and v_roles && array['administrator','management'],false) then
      raise exception 'Role cannot set expected use' using errcode='42501';
    end if;
    return private.stockflow_set_item_demand_estimate(lower(btrim(p_actor_email)),p_payload);
  end if;
  return public.stockflow_requirements_gateway_before_item_estimates(p_gateway_key,p_actor_email,p_action,p_payload);
end $$;
revoke all on function public.stockflow_requirements_gateway_before_item_estimates(text,text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.stockflow_requirements_gateway(text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.stockflow_requirements_gateway(text,text,text,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
