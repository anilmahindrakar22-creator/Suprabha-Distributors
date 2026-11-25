begin;

create table private.stockflow_forecast_runs (
  computed_on date primary key,
  computed_at timestamptz not null,
  through_month date not null,
  item_count integer not null check (item_count >= 0),
  uncertified_months date[] not null default '{}'
);
create table private.stockflow_item_forecast (
  company_id text not null, product_id text not null,
  through_month date not null, first_sale_month date, is_new boolean not null,
  base_rate numeric not null check (base_rate >= 0),
  avg6_rate numeric not null check (avg6_rate >= 0),
  cap12_rate numeric not null check (cap12_rate >= 0),
  computed_at timestamptz not null,
  primary key (company_id, product_id)
);
create table private.stockflow_forecast_checks (
  computed_on date not null references private.stockflow_forecast_runs(computed_on) on delete cascade,
  cutoff_month date not null, horizon smallint not null check (horizon in (1,2)),
  segment text not null check (segment in ('established','new')),
  method text not null check (method in ('base','avg6','cap12')),
  item_months integer not null, actual numeric not null, forecast numeric not null, abs_error numeric not null,
  primary key (computed_on, cutoff_month, horizon, segment, method)
);
alter table private.stockflow_forecast_runs enable row level security;
alter table private.stockflow_item_forecast enable row level security;
alter table private.stockflow_forecast_checks enable row level security;
revoke all on private.stockflow_forecast_runs,private.stockflow_item_forecast,private.stockflow_forecast_checks
  from public,anon,authenticated,service_role;

create function private.stockflow_forecast_median_positive(p numeric[]) returns numeric
language sql immutable security definer set search_path=pg_catalog,private,public,extensions as $$
  select avg(v) from (
    select v,row_number() over(order by v) as i,count(*) over() as n
    from unnest(p) v where v>0
  ) positives where i in ((n+1)/2,(n+2)/2)
$$;
create function private.stockflow_forecast_rates(p_hist numeric[])
returns table(base_rate numeric,avg6_rate numeric,cap12_rate numeric)
language sql immutable security definer set search_path=pg_catalog,private,public,extensions as $$
  with samples as (
    select v,i,count(*) over() as n from unnest(p_hist) with ordinality as u(v,i)
  ), cap as (
    select 3*private.stockflow_forecast_median_positive(array_agg(v)) as cap
    from samples where i>n-12
  )
  select coalesce(sum(v) filter(where i>n-3)/least(3,max(n)),0),
    coalesce(sum(v) filter(where i>n-6)/least(6,max(n)),0),
    coalesce(sum(least(v,cap.cap)) filter(where i>n-12 and cap.cap is not null)/least(12,max(n)),0)
  from samples cross join cap
$$;
revoke all on function private.stockflow_forecast_median_positive(numeric[]),private.stockflow_forecast_rates(numeric[])
  from public,anon,authenticated,service_role;

create function private.stockflow_refresh_item_forecast(p_today date) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog,private,public,extensions as $$
declare v_through date:=(date_trunc('month',p_today)-interval '1 month')::date;
  v_items integer; v_checks integer; v_uncertified date[];
begin
  perform pg_advisory_xact_lock(hashtext('stockflow-item-forecast-refresh'));
  -- Fully qualify temporary reads; drop after use so a same-transaction rerun is safe.
  create temporary table stockflow_forecast_series on commit drop as
  with latest as materialized (
    select distinct on(company_id,source_id) * from private.stockflow_economic_source_vouchers
    order by company_id,source_id,source_revision desc
  ), companies as (
    select company_id,greatest((v_through-interval '35 months')::date,
      date_trunc('month',min(business_date))::date) as start_month
    from latest where not cancelled and kind='sale' and business_date<v_through+interval '1 month'
    group by company_id
  ), monthly as materialized (
    select v.company_id,l.product_id,date_trunc('month',v.business_date)::date as month,
      greatest(sum(case when v.kind='sale' then l.quantity else -l.quantity end),0) as q
    from latest v join companies c using(company_id)
    join private.stockflow_economic_source_lines l on l.voucher_id=v.id
    where not v.cancelled and v.kind in ('sale','return','credit')
      and v.business_date>=c.start_month and v.business_date<v_through+interval '1 month'
    group by v.company_id,l.product_id,date_trunc('month',v.business_date)::date
  ), products as (select distinct company_id,product_id from monthly)
  select p.company_id,p.product_id,m.month::date as month,coalesce(q.q,0) as q
  from products p join companies c using(company_id)
  cross join lateral generate_series(c.start_month::timestamp,v_through::timestamp,interval '1 month') m(month)
  left join monthly q on q.company_id=p.company_id and q.product_id=p.product_id and q.month=m.month;

  delete from private.stockflow_item_forecast;
  insert into private.stockflow_item_forecast
  select s.company_id,s.product_id,v_through,s.first_sale_month,
    s.first_sale_month>v_through-interval '6 months',r.base_rate,r.avg6_rate,r.cap12_rate,now()
  from (select company_id,product_id,min(month) filter(where q>0) as first_sale_month,
    array_agg(q order by month) as hist from pg_temp.stockflow_forecast_series
    group by company_id,product_id having bool_or(q>0)) s
  cross join lateral private.stockflow_forecast_rates(s.hist) r;
  get diagnostics v_items = row_count;

  select coalesce(array_agg(distinct m::date order by m::date),'{}'::date[]) into v_uncertified
  from (select distinct company_id from pg_temp.stockflow_forecast_series) c
  cross join generate_series((v_through-interval '13 months')::timestamp,v_through::timestamp,interval '1 month') m
  where private.stockflow_sales_coverage_status(c.company_id,m::date,(m+interval '1 month')::date-1)->>'complete' is distinct from 'true'
    or private.stockflow_sales_reconciliation(c.company_id,m::date)->>'state' is distinct from 'matches';
  delete from private.stockflow_forecast_runs where computed_on=p_today;
  insert into private.stockflow_forecast_runs values(p_today,now(),v_through,v_items,v_uncertified);

  insert into private.stockflow_forecast_checks
  with cutoffs as (
    select c::date as cutoff,h::smallint as horizon
    from generate_series((v_through-interval '5 months')::timestamp,v_through::timestamp,interval '1 month') c
    cross join generate_series(1,2) h where c+(h-1)*interval '1 month'<=v_through
  ), histories as (
    select c.cutoff,c.horizon,s.company_id,s.product_id,
      array_agg(s.q order by s.month) filter(where s.month<c.cutoff) as hist,
      min(s.month) filter(where s.month<c.cutoff and s.q>0) as first_positive,
      coalesce(sum(s.q) filter(where s.month>=c.cutoff and s.month<c.cutoff+c.horizon*interval '1 month'),0) as actual
    from cutoffs c cross join pg_temp.stockflow_forecast_series s
    group by c.cutoff,c.horizon,s.company_id,s.product_id
    having sum(s.q) filter(where s.month>=c.cutoff-interval '3 months' and s.month<c.cutoff)>0
  ), predictions as (
    select h.*,case when first_positive>=cutoff-interval '6 months' then 'new' else 'established' end as segment,
      m.method,m.rate*h.horizon as forecast
    from histories h cross join lateral private.stockflow_forecast_rates(h.hist) r
    cross join lateral (values('base',r.base_rate),('avg6',r.avg6_rate),('cap12',r.cap12_rate)) m(method,rate)
  )
  select p_today,cutoff,horizon,segment,method,count(*)::integer,sum(actual),sum(forecast),sum(abs(forecast-actual))
  from predictions group by cutoff,horizon,segment,method;
  get diagnostics v_checks = row_count;
  delete from private.stockflow_forecast_runs where computed_on<p_today-120;
  drop table pg_temp.stockflow_forecast_series;
  return jsonb_build_object('computedOn',p_today,'throughMonth',v_through,'items',v_items,'checks',v_checks);
end $$;
revoke all on function private.stockflow_refresh_item_forecast(date) from public,anon,authenticated,service_role;

create function private.stockflow_forecast_trial(p_today date) returns jsonb
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
), items as (
  select d.item_key,f.is_new,f.first_sale_month,round(d.used_90/90*30.4375,2) as now_monthly,
    d.days_left as now_days_left,round(f.avg6_rate,2) as avg6_monthly,round(f.cap12_rate,2) as cap12_monthly,
    case when f.avg6_rate>0 then floor(greatest(d.available,0)/(f.avg6_rate/30.4375))::integer end as avg6_days_left,
    case when f.cap12_rate>0 then floor(greatest(d.available,0)/(f.cap12_rate/30.4375))::integer end as cap12_days_left
  from names n join private.stockflow_item_forecast f on f.company_id=n.company_id and f.product_id=n.product_id
  join days d on d.item_key=n.name where d.used_90>0 and exists(select 1 from run)
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
    'cap12Monthly',cap12_monthly,'cap12DaysLeft',cap12_days_left) order by distance desc,item_key collate "C") from page),'[]'::jsonb))
$$;
revoke all on function private.stockflow_forecast_trial(date) from public,anon,authenticated,service_role;

do $cron$
begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname='stockflow-item-forecast-refresh';
    perform cron.schedule('stockflow-item-forecast-refresh','20 21 * * *',$job$select private.stockflow_refresh_item_forecast((now() at time zone 'Asia/Kolkata')::date)$job$);
  end if;
end $cron$;

alter function public.stockflow_requirements_gateway(text,text,text,jsonb)
  rename to stockflow_requirements_gateway_before_forecast_trial;
create function public.stockflow_requirements_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private,public,extensions as $$
declare v_hash text; v_roles text[];
begin
  if p_action='get_requirements' and coalesce(p_payload->>'view','')='forecast_trial' then
    select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
    if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_hash then
      raise exception 'Unauthorized gateway' using errcode='42501';
    end if;
    select roles into v_roles from public.stockflow_members
      where email=lower(btrim(coalesce(p_actor_email,''))) and status='active';
    if not found then
      raise exception 'Active membership required' using errcode='42501';
    end if;
    if not coalesce(private.stockflow_valid_roles(v_roles) and v_roles && array['administrator','management'],false) then
      raise exception 'Role cannot see the forecast trial' using errcode='42501';
    end if;
    if p_payload - 'view' <> '{}'::jsonb then
      raise exception 'Invalid requirements view' using errcode='22023';
    end if;
    return private.stockflow_forecast_trial((now() at time zone 'Asia/Kolkata')::date);
  end if;
  return public.stockflow_requirements_gateway_before_forecast_trial(p_gateway_key,p_actor_email,p_action,p_payload);
end $$;
revoke all on function public.stockflow_requirements_gateway_before_forecast_trial(text,text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.stockflow_requirements_gateway(text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.stockflow_requirements_gateway(text,text,text,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
