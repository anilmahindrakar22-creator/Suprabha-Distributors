begin;

create function private.stockflow_growth_new_labs_read(p_today date) returns jsonb
language sql stable security definer set search_path=pg_catalog,private,public,extensions as $$
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
), dated_sales as (
 select s.*,min(business_date) over(partition by company_id,customer_source_id) first_sale
 from positive_sales s where customer_source_id is not null
), labs as (
 select company_id,customer_source_id,company_id||'|'||customer_source_id lab_key,
  min(business_date) first_sale,sum(net) filter(where business_date=first_sale) first_order_paise,
  count(distinct business_date) order_days,max(business_date) last_sale,sum(net) total_paise
 from dated_sales group by company_id,customer_source_id
), new_labs as materialized (
 select l.*,case when order_days>=2 then 'repeat'
  when p_today-first_sale>=45 then 'overdue'
  when p_today-first_sale>=30 then 'due' else 'early' end status
 from labs l where first_sale>p_today-90
), ranked as (
 select n.*,case status when 'overdue' then 0 when 'due' then 1 when 'early' then 2 else 3 end status_rank
 from new_labs n
), selected as (
 select * from ranked order by status_rank,first_order_paise desc,lab_key collate "C" limit 50
)
select private.stockflow_growth_integer_paise(jsonb_build_object(
 'filter','new','windowDays',90,'asOf',p_today,
 'totalLabs',(select count(*) from new_labs),
 'repeatLabs',(select count(*) from new_labs where status='repeat'),
 'rows',coalesce((select jsonb_agg(jsonb_build_object('labKey',t.lab_key,'customerId',c.id,
   'name',coalesce(c.name,private.stockflow_growth_ledger_name(t.company_id,t.customer_source_id)),
   'town',c.city,'phone',c.phone,'firstPurchaseOn',t.first_sale::text,'firstOrderPaise',t.first_order_paise,
   'orderDays',t.order_days,'lastPurchaseOn',t.last_sale::text,'daysSinceFirst',p_today-t.first_sale,
   'totalPaise',t.total_paise,'status',t.status)
   order by t.status_rank,t.first_order_paise desc,t.lab_key collate "C")
  from selected t left join private.stockflow_economic_customer_identities i
   on i.company_id=t.company_id and i.source_id=t.customer_source_id
  left join private.stockflow_customers c on c.id=i.customer_id),'[]'::jsonb)))
$$;

alter function public.stockflow_growth_gateway(text,text,text,jsonb) rename to stockflow_growth_gateway_before_new_labs;
create function public.stockflow_growth_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=pg_catalog,private,public,extensions
set statement_timeout to '20s' as $$
declare hash text; roles text[];
begin
 if p_action='get_growth_lab_months' and p_payload='{"filter":"new"}'::jsonb then
  select secret_sha256 into hash from private.stockflow_gateway_config where name='orders';
  if hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>hash then
   raise exception 'Unauthorized gateway' using errcode='42501';end if;
  begin roles:=private.stockflow_active_member_roles(lower(btrim(p_actor_email)));
  exception when sqlstate '42501' then raise exception 'Growth access required' using errcode='PT403';end;
  if not coalesce(roles&&array['administrator','management'],false) then
   raise exception 'Growth access required' using errcode='PT403';end if;
  return private.stockflow_growth_new_labs_read((now() at time zone 'Asia/Kolkata')::date);
 end if;
 return public.stockflow_growth_gateway_before_new_labs(p_gateway_key,p_actor_email,p_action,p_payload);
end$$;

revoke all on function private.stockflow_growth_new_labs_read(date) from public,anon,authenticated,service_role;
revoke all on function public.stockflow_growth_gateway_before_new_labs(text,text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.stockflow_growth_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_growth_gateway(text,text,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
