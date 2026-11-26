begin;

create function private.stockflow_growth_cohorts_read(p_today date,p_cohort text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,private,public,extensions as $$
declare result jsonb;
begin
 with sale_latest as materialized (
 select distinct on(v.company_id,v.source_id) v.*
 from private.stockflow_economic_source_vouchers v
 where v.business_date<=p_today
  and not exists(select 1 from private.stockflow_economic_source_vouchers n
   where n.company_id=v.company_id and n.source_id=v.source_id and n.source_revision>v.source_revision)
 order by v.company_id,v.source_id,v.source_revision desc
), positive_sales as (
 select v.company_id,v.customer_source_id,v.id,v.business_date,sum(l.net_sales_paise::numeric) net
 from sale_latest v join private.stockflow_economic_source_lines l on l.voucher_id=v.id
 where not v.cancelled and v.kind='sale'
 group by v.company_id,v.customer_source_id,v.id,v.business_date
 having sum(l.net_sales_paise::numeric)>0
), history as (
 select date_trunc('month',min(business_date))::date hist_start from positive_sales
), bounds as (
 select hist_start,(hist_start+interval '3 months')::date existing_until from history
), labs as materialized (
 select company_id,customer_source_id,company_id||'|'||customer_source_id lab_key,
  min(business_date) first_sale,max(business_date) last_sale
 from positive_sales where customer_source_id is not null group by company_id,customer_source_id
), classified as materialized (
 select l.*,case when first_sale<existing_until then 'existing' else to_char(first_sale,'YYYY') end cohort,
  last_sale>=p_today-90 active,last_sale<p_today-180 stopped,
  case when last_sale<p_today-180 then coalesce((
   select sum(s.net) from positive_sales s
   where s.company_id=l.company_id and s.customer_source_id=l.customer_source_id
    and s.business_date>l.last_sale-365 and s.business_date<=l.last_sale),0) else 0 end lost
 from labs l cross join bounds
), cohorts as (
 select cohort,count(*) labs,count(*) filter(where active) active,count(*) filter(where stopped) stopped,sum(lost) lost
 from classified group by cohort
), labelled as (
 select c.*,case when cohort='existing' then 'Buying when records start ('||to_char(hist_start,'Mon YYYY')||'–'||
  to_char(existing_until-1,'Mon YYYY')||')' else cohort||case when cohort=to_char(existing_until,'YYYY')
  then ' (from '||to_char(existing_until,'Mon')||')' else '' end end label
 from cohorts c cross join bounds
), selected as (
 select * from classified where cohort=p_cohort and stopped order by lost desc,lab_key collate "C" limit 50
), companies as (
 select distinct company_id from positive_sales
)
 select case when p_cohort is null then jsonb_build_object(
  'rows',coalesce((select jsonb_agg(jsonb_build_object('cohort',cohort,'label',label,'labs',labs,
   'active',active,'activePct',round(100.0*active/labs),'stopped',stopped,'lostPaise',lost)
   order by cohort<>'existing',cohort collate "C") from labelled),'[]'::jsonb),
  'totals',(select jsonb_build_object('labs',count(*),'active',count(*) filter(where active),
   'activePct',coalesce(round(100.0*count(*) filter(where active)/nullif(count(*),0)),0),
   'stopped',count(*) filter(where stopped),'lostPaise',coalesce(sum(lost),0)) from classified),
  'historyFrom',(select hist_start from bounds),'asOf',p_today,
  'reconciled',not exists(select 1 from companies c
   where private.stockflow_sales_coverage_status(c.company_id,(select hist_start from bounds),
    (date_trunc('month',p_today)-interval '1 day')::date)->>'complete' is distinct from 'true'))
 else (select jsonb_build_object('cohort',cohort,'label',label,'totalLabs',stopped,
  'rows',coalesce((select jsonb_agg(jsonb_build_object('labKey',t.lab_key,'customerId',c.id,
   'name',coalesce(c.name,private.stockflow_growth_ledger_name(t.company_id,t.customer_source_id)),
   'town',c.city,'firstPurchaseOn',t.first_sale::text,'lastPurchaseOn',t.last_sale::text,'lostPaise',t.lost)
   order by t.lost desc,t.lab_key collate "C")
   from selected t left join private.stockflow_economic_customer_identities i
    on i.company_id=t.company_id and i.source_id=t.customer_source_id
   left join private.stockflow_customers c on c.id=i.customer_id),'[]'::jsonb))
  from labelled where cohort=p_cohort) end into result;
 if result is null then raise exception 'Invalid growth cohorts request' using errcode='22023';end if;
 return private.stockflow_growth_integer_paise(result);
end$$;

alter function public.stockflow_growth_gateway(text,text,text,jsonb) rename to stockflow_growth_gateway_before_cohorts;
create function public.stockflow_growth_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=pg_catalog,private,public,extensions
set statement_timeout to '20s' as $$
declare hash text; roles text[];
begin
 if p_action='get_growth_cohorts' then
  select secret_sha256 into hash from private.stockflow_gateway_config where name='orders';
  if hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>hash then
   raise exception 'Unauthorized gateway' using errcode='42501';end if;
  begin roles:=private.stockflow_active_member_roles(lower(btrim(p_actor_email)));
  exception when sqlstate '42501' then raise exception 'Growth access required' using errcode='PT403';end;
  if not coalesce(roles&&array['administrator','management'],false) then
   raise exception 'Growth access required' using errcode='PT403';end if;
  if jsonb_typeof(p_payload) is distinct from 'object'
   or p_payload-'cohort' is distinct from '{}'::jsonb
   or (p_payload ? 'cohort' and (jsonb_typeof(p_payload->'cohort') is distinct from 'string'
    or char_length(p_payload->>'cohort') not between 1 and 20)) then
   raise exception 'Invalid growth cohorts request' using errcode='22023';end if;
  return private.stockflow_growth_cohorts_read((now() at time zone 'Asia/Kolkata')::date,p_payload->>'cohort');
 end if;
 return public.stockflow_growth_gateway_before_cohorts(p_gateway_key,p_actor_email,p_action,p_payload);
end$$;

revoke all on function private.stockflow_growth_cohorts_read(date,text) from public,anon,authenticated,service_role;
revoke all on function public.stockflow_growth_gateway_before_cohorts(text,text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.stockflow_growth_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_growth_gateway(text,text,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
