begin;

create function private.stockflow_observed_price_changes(p_today date,p_page integer,p_direction text,p_volume text)
returns jsonb language sql stable security definer
set search_path=pg_catalog,private,public,extensions as $$
 -- Keep validation outside the read CTEs, including when no complete run exists.
 select case when p_page is null or p_page not between 1 and 100
  or (p_direction is not null and p_direction not in ('up','down'))
  or (p_volume is not null and p_volume not in ('fell','held','rose'))
 then to_jsonb(jsonb_array_length(jsonb_build_object('invalidRequest',true)))
 else (
 with run as materialized (
  select id,company_id from private.stockflow_company_gp_runs where status='complete'
  order by completed_at desc,id desc limit 1
 ), names as materialized (
  select p->>'id' product_id,p->>'name' item_name
  from (select c.content from private.stockflow_economic_item_catalogs c
   join run r on r.company_id=c.company_id order by c.observed_at desc,c.id desc limit 1) catalog
  cross join lateral jsonb_array_elements(catalog.content->'products') p
 ), l as materialized (
  select g.*,g.revenue_paise::numeric/g.quantity rate
  from private.stockflow_company_gp_lines g join run r on r.id=g.run_id
  where g.kind='sale' and g.status<>'instrument_billing' and g.quantity>0 and g.revenue_paise>0
 ), n as materialized (
  select g.* from private.stockflow_company_gp_lines g join run r on r.id=g.run_id
  where g.status<>'instrument_billing'
 ), distinct_dates as (
  select distinct customer_source_id,business_date from l
 ), gaps as (
  select customer_source_id,business_date-lag(business_date) over
   (partition by customer_source_id order by business_date) gap from distinct_dates
 ), lab_windows as (
  select customer_source_id,case when percentile_cont(0.5) within group(order by gap)>45
   then 180 else 90 end w from gaps group by customer_source_id
 ), rate_history as (
  select customer_source_id,product_id,business_date,rate,
   lag(rate) over(partition by customer_source_id,product_id order by business_date,rate) prev_rate from l
 ), first_changes as (
  select distinct on(customer_source_id,product_id,date_trunc('month',business_date))
   customer_source_id,product_id,business_date changed_on
  from rate_history where abs(rate-prev_rate)/prev_rate>0.02
  order by customer_source_id,product_id,date_trunc('month',business_date),business_date
 ), windows as materialized (
  select c.*,least(w.w,p_today-c.changed_on) window_days
  from first_changes c join lab_windows w on w.customer_source_id=c.customer_source_id
  where c.changed_on<=p_today-60
 ), window_sales as materialized (
  select c.customer_source_id,c.product_id,c.changed_on,
   s.business_date<c.changed_on is_before,
   percentile_cont(0.5) within group(order by s.rate)::numeric rate,
   count(*) lines,sum(s.revenue_paise)::bigint revenue,
   case when sum(s.revenue_paise) filter(where s.status='costed')>=0.8*sum(s.revenue_paise)
    then sum(s.gp_paise)::bigint end gp
  from windows c join l s on s.customer_source_id=c.customer_source_id and s.product_id=c.product_id
   and s.business_date>=c.changed_on-c.window_days and s.business_date<c.changed_on+c.window_days
  group by c.customer_source_id,c.product_id,c.changed_on,s.business_date<c.changed_on
 ), measured as (
  select c.*,b.rate before_rate,a.rate after_rate,b.lines before_lines,a.lines after_lines,
   b.revenue before_revenue,a.revenue after_revenue,b.gp before_gp,a.gp after_gp,
   q.before_qty,q.after_qty
  from windows c
  join window_sales b on b.customer_source_id=c.customer_source_id and b.product_id=c.product_id
   and b.changed_on=c.changed_on and b.is_before
  join window_sales a on a.customer_source_id=c.customer_source_id and a.product_id=c.product_id
   and a.changed_on=c.changed_on and not a.is_before
  cross join lateral (
   select coalesce(sum(quantity) filter(where business_date<c.changed_on),0) before_qty,
    coalesce(sum(quantity) filter(where business_date>=c.changed_on),0) after_qty
   from n where customer_source_id=c.customer_source_id and product_id=c.product_id
    and business_date>=c.changed_on-c.window_days and business_date<c.changed_on+c.window_days
  ) q
 ), kept as materialized (
  select m.*,coalesce(nm.item_name,m.product_id) item_key,
   coalesce(c.name,'Unlinked Tally ledger') customer_name
  from measured m cross join run r
  left join names nm on nm.product_id=m.product_id
  left join private.stockflow_economic_customer_identities i
   on i.company_id=r.company_id and i.source_id=m.customer_source_id
  left join private.stockflow_customers c on c.id=i.customer_id
  where m.before_lines>=2 and m.after_lines>=2 and abs(m.after_rate-m.before_rate)/m.before_rate>0.02
   and not exists (
    select 1 from private.stockflow_customer_product_prices pr
    join private.stockflow_economic_customer_identities ai on ai.customer_id=pr.customer_id
     and ai.company_id=r.company_id and ai.source_id=m.customer_source_id
    join names an on an.product_id=m.product_id and an.item_name=pr.tally_item_key
    where (pr.status='approved' or (pr.status='superseded' and pr.approved_at is not null))
     and abs(pr.valid_from-m.changed_on)<=30
   )
 ), classified as materialized (
  select *,case when after_rate>before_rate then 'up' else 'down' end direction,
   case when before_qty<=0 then case when after_qty>0 then 'rose' else 'held' end
    when after_qty>=1.1*before_qty then 'rose' when after_qty<0.9*before_qty then 'fell' else 'held' end volume
  from kept where after_rate/before_rate between 0.4 and 2.5
 ), filtered as materialized (
  select * from classified where (p_direction is null or direction=p_direction)
   and (p_volume is null or volume=p_volume)
 ), page as (
  select * from filtered order by (direction='up' and volume='fell') desc,changed_on desc,customer_name,item_key
  offset (p_page-1)*10 limit 10
 )
 select jsonb_build_object('view','observed_changes','asOf',p_today,
  'salesThrough',(select max(g.business_date) from private.stockflow_company_gp_lines g join run r on r.id=g.run_id),
  'page',p_page,'pageSize',10,'total',(select count(*) from filtered),
  'summary',(select jsonb_build_object('changes',count(*),'increases',count(*) filter(where direction='up'),
   'decreases',count(*) filter(where direction='down'),'increasesFell',count(*) filter(where direction='up' and volume='fell'),
   'increasesHeld',count(*) filter(where direction='up' and volume='held'),
   'increasesRose',count(*) filter(where direction='up' and volume='rose'),
   'labs',count(distinct customer_source_id),
   'unitChanges',(select count(*) from kept where after_rate/before_rate<0.4 or after_rate/before_rate>2.5)) from classified),
  'rows',coalesce((select jsonb_agg(jsonb_build_object('customerName',customer_name,'itemKey',item_key,
   'changedOn',changed_on,'windowDays',window_days,'direction',direction,'volume',volume,
   'beforeRatePaise',round(before_rate),'afterRatePaise',round(after_rate),
   'changePct',round((after_rate-before_rate)/before_rate*100,1),
   'beforeQty',before_qty,'afterQty',after_qty,'beforeRevenuePaise',before_revenue,'afterRevenuePaise',after_revenue,
   'beforeGpPaise',before_gp,'afterGpPaise',after_gp)
   order by (direction='up' and volume='fell') desc,changed_on desc,customer_name,item_key) from page),'[]'::jsonb))
 ) end;
$$;
revoke all on function private.stockflow_observed_price_changes(date,integer,text,text) from public,anon,authenticated,service_role;

alter function public.stockflow_pricing_gateway(text,text,text,jsonb) rename to stockflow_pricing_gateway_before_observed_changes;
revoke all on function public.stockflow_pricing_gateway_before_observed_changes(text,text,text,jsonb) from public,anon,authenticated,service_role;

create function public.stockflow_pricing_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,private,extensions as $$
declare
 actor_email text:=lower(btrim(coalesce(p_actor_email,'')));
 assigned_roles text[];
 secret text;
 page_number integer;
begin
 if p_action is distinct from 'get_order_pricing' or p_payload->>'view' is distinct from 'observed_changes' then
  return public.stockflow_pricing_gateway_before_observed_changes(p_gateway_key,p_actor_email,p_action,p_payload);
 end if;
 select secret_sha256 into secret from private.stockflow_gateway_config where name='orders';
 if secret is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>secret then
  raise exception 'Unauthorized gateway' using errcode='42501';
 end if;
 select m.roles into assigned_roles from public.stockflow_members m where m.email=actor_email and m.status='active';
 if not private.stockflow_valid_roles(assigned_roles)
  or not (assigned_roles && array['administrator','management']::text[]) then
  raise exception 'Observed price changes are restricted' using errcode='42501';
 end if;
 if jsonb_typeof(p_payload) is distinct from 'object'
  or p_payload-array['view','page','direction','volume']<>'{}'::jsonb
  or jsonb_typeof(p_payload->'page') is distinct from 'number'
  or (p_payload->>'page') !~ '^[1-9][0-9]{0,5}$'
  or (p_payload ? 'direction' and (jsonb_typeof(p_payload->'direction') is distinct from 'string'
   or p_payload->>'direction' not in ('up','down')))
  or (p_payload ? 'volume' and (jsonb_typeof(p_payload->'volume') is distinct from 'string'
   or p_payload->>'volume' not in ('fell','held','rose'))) then
  raise exception 'Invalid observed price changes request' using errcode='22023';
 end if;
 page_number:=(p_payload->>'page')::integer;
 if page_number>100 then
  raise exception 'Invalid observed price changes request' using errcode='22023';
 end if;
 return private.stockflow_observed_price_changes((now() at time zone 'Asia/Kolkata')::date,
  page_number,p_payload->>'direction',p_payload->>'volume');
end$$;
revoke all on function public.stockflow_pricing_gateway(text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.stockflow_pricing_gateway(text,text,text,jsonb) to service_role;

commit;
