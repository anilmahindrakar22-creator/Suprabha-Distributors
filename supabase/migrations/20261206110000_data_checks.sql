begin;

create function private.stockflow_data_checks(p_today date) returns jsonb
language sql stable security definer set search_path=pg_catalog,private,public,extensions as $$
with latest as materialized (
  select distinct on(v.company_id,v.source_id) v.*
  from private.stockflow_economic_source_vouchers v
  where v.business_date>p_today-90 and v.business_date<=p_today
    and not exists(select 1 from private.stockflow_economic_source_vouchers n
      where n.company_id=v.company_id and n.source_id=v.source_id and n.source_revision>v.source_revision)
  order by v.company_id,v.source_id,v.source_revision desc
), sales as materialized (
  select * from latest where kind='sale' and not cancelled
), buying as materialized (
  select company_id,customer_source_id,count(*) vouchers,max(business_date) last_sale_on
  from sales where customer_source_id is not null group by company_id,customer_source_id
), unlinked as materialized (
  select b.*,private.stockflow_growth_ledger_name(b.company_id,b.customer_source_id) name
  from buying b where not exists(select 1 from private.stockflow_economic_customer_identities i
    where i.company_id=b.company_id and i.source_id=b.customer_source_id)
), customers as materialized (
  select c.id,c.name,c.city,c.pin_code,sum(b.vouchers) vouchers
  from buying b join private.stockflow_economic_customer_identities i
    on i.company_id=b.company_id and i.source_id=b.customer_source_id
  join private.stockflow_customers c on c.id=i.customer_id
  group by c.id,c.name,c.city,c.pin_code
), no_pin as materialized (
  select * from customers c where c.pin_code is null or not exists(
    select 1 from private.stockflow_pin_centroids p where p.pin_code=c.pin_code)
), catalogs as materialized (
  select distinct on(company_id) company_id,content from private.stockflow_economic_item_catalogs
  order by company_id,observed_at desc,id desc
), names as materialized (
  select c.company_id,p->>'id' product_id,p->>'name' name
  from catalogs c cross join lateral jsonb_array_elements(c.content->'products') p
), sold as materialized (
  select distinct v.company_id,l.product_id from sales v
  join private.stockflow_economic_source_lines l on l.voucher_id=v.id
), items as materialized (
  select distinct s.product_id from sold s where not exists(
    select 1 from names n join private.stockflow_products p on p.tally_item_key=n.name
    where n.company_id=s.company_id and n.product_id=s.product_id)
)
select jsonb_build_object('view','data_checks','asOf',p_today,
  'unlinkedLedgers',jsonb_build_object('count',(select count(*) from unlinked),
    'ofBuying',(select count(*) from buying),
    'top',coalesce((select jsonb_agg(jsonb_build_object('name',name,'lastSaleOn',last_sale_on)
      order by vouchers desc,name,company_id,customer_source_id)
      from (select * from unlinked order by vouchers desc,name,company_id,customer_source_id limit 10) t),'[]'::jsonb)),
  'noPinCode',jsonb_build_object('count',(select count(*) from no_pin),
    'ofBuying',(select count(*) from customers),
    'top',coalesce((select jsonb_agg(jsonb_build_object('customerId',id,'name',name,'town',city)
      order by vouchers desc,name,id)
      from (select * from no_pin order by vouchers desc,name,id limit 20) t),'[]'::jsonb)),
  'itemsNotInStockFlow',jsonb_build_object('count',(select count(*) from items),
    'ofSold',(select count(distinct product_id) from sold)),
  'freshness',jsonb_build_object('salesThrough',(select max(business_date) from sales),
    'itemListReadAt',(select max(observed_at) from private.stockflow_economic_item_catalogs)))
$$;
revoke all on function private.stockflow_data_checks(date) from public,anon,authenticated,service_role;

alter function public.stockflow_economics_gateway(text,text,text,jsonb)
  rename to stockflow_economics_gateway_before_data_checks;
create function public.stockflow_economics_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,extensions as $$
declare v_hash text; v_roles text[];
begin
  if p_action='get_data_checks' then
    select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
    if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_hash then
      raise exception 'Unauthorized gateway' using errcode='42501';
    end if;
    select roles into v_roles from public.stockflow_members
      where email=lower(btrim(coalesce(p_actor_email,''))) and status='active';
    if not private.stockflow_valid_roles(v_roles) or not coalesce(v_roles&&array['administrator','management'],false) then
      raise exception 'Data checks are restricted' using errcode='42501';
    end if;
    if p_payload is distinct from '{}'::jsonb then
      raise exception 'Invalid data checks payload' using errcode='22023';
    end if;
    return private.stockflow_data_checks((now() at time zone 'Asia/Kolkata')::date);
  end if;
  return public.stockflow_economics_gateway_before_data_checks(p_gateway_key,p_actor_email,p_action,p_payload);
end $$;
revoke all on function public.stockflow_economics_gateway_before_data_checks(text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.stockflow_economics_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_economics_gateway(text,text,text,jsonb) to service_role;
alter function public.stockflow_economics_gateway(text,text,text,jsonb) set statement_timeout='20s';
notify pgrst, 'reload schema';
commit;
