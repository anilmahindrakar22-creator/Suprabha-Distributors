begin;

create function private.stockflow_economic_cost_review_read(p jsonb) returns jsonb
language plpgsql stable set search_path=pg_catalog,private as $$
declare run uuid; result jsonb;
begin
 if jsonb_typeof(p) is distinct from 'object' then
  raise exception 'Invalid cost review payload' using errcode='22023';
 end if;
 if p<>'{}'::jsonb then
  raise exception 'Invalid cost review payload' using errcode='22023';
 end if;
 select id into run from private.stockflow_economic_runs where active;
 with sales as materialized (
  select l.id,v.company_id,l.product_id,l.unit,v.business_date,coalesce(l.evidence->>'label',l.product_id) label
  from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id
  where v.kind='sale' and l.quantity>0 and not v.cancelled
   and not exists(select 1 from private.stockflow_economic_source_vouchers n
    where n.company_id=v.company_id and n.source_id=v.source_id and n.source_revision>v.source_revision)
   and exists(select 1 from private.stockflow_economic_results r where r.run_id=run and r.source_line_id=l.id
    and r.target_id is not null and r.status='cost_unavailable' and r.cost_paise is null)
 ), sale_groups as materialized (
  select company_id,product_id,unit,max(business_date) max_date from sales group by company_id,product_id,unit
 ), purchases as materialized (
  select l.id,v.business_date,v.source_id,l.line_key
  from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id
  where v.kind='purchase' and not v.cancelled
   and not exists(select 1 from private.stockflow_economic_source_vouchers n
    where n.company_id=v.company_id and n.source_id=v.source_id and n.source_revision>v.source_revision)
   and exists(select 1 from sale_groups s where s.company_id=v.company_id and s.product_id=l.product_id
    and s.unit=l.unit and v.business_date<=s.max_date)
 ), sale_page as (
  select * from sales order by business_date,label,id limit 500
 ), purchase_page as (
  select * from purchases order by business_date,source_id,line_key,id limit 5000
 )
 select jsonb_build_object(
  'sales',private.stockflow_economic_line_rows((select array_agg(id order by business_date,label,id) from sale_page)),
  'salesTotal',(select count(*) from sales),
  'purchases',private.stockflow_economic_line_rows((select array_agg(id order by business_date,source_id,line_key,id) from purchase_page)),
  'purchasesTotal',(select count(*) from purchases)) into result;
 return result;
end $$;

create function private.stockflow_economic_line_refs_read(p jsonb) returns jsonb
language plpgsql stable set search_path=pg_catalog,private as $$
declare k text; run uuid; result jsonb;
begin
 if jsonb_typeof(p) is distinct from 'object' then
  raise exception 'Invalid line refs payload' using errcode='22023';
 end if;
 if exists(select 1 from jsonb_object_keys(p) key where key not in ('companyId','customerSourceId')) then
  raise exception 'Invalid line refs payload' using errcode='22023';
 end if;
 foreach k in array array['companyId','customerSourceId'] loop
  if jsonb_typeof(p->k) is distinct from 'string' or length(btrim(p->>k))=0 or length(p->>k)>240 then
   raise exception 'Invalid line refs payload' using errcode='22023';
  end if;
 end loop;
 select id into run from private.stockflow_economic_runs where active;
 with refs as materialized (
  select l.id,v.kind,nullif(btrim(v.evidence->>'sourceReference'),'') voucher_number,v.business_date
  from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id
  where run is not null and v.company_id=p->>'companyId' and v.customer_source_id=p->>'customerSourceId'
   and not v.cancelled and not exists(select 1 from private.stockflow_economic_source_vouchers n
    where n.company_id=v.company_id and n.source_id=v.source_id and n.source_revision>v.source_revision)
 ), page as (
  select * from refs order by business_date desc,id limit 5000
 )
 select jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('id',id,'kind',kind,'voucherNumber',voucher_number)
  order by business_date desc,id) from page),'[]'::jsonb),'total',(select count(*) from refs),'limit',5000) into result;
 return result;
end $$;

revoke all on function private.stockflow_economic_cost_review_read(jsonb) from public,anon,authenticated,service_role;
revoke all on function private.stockflow_economic_line_refs_read(jsonb) from public,anon,authenticated,service_role;
alter function public.stockflow_economics_gateway(text,text,text,jsonb)
 rename to stockflow_economics_gateway_before_cost_review;
create function public.stockflow_economics_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private,extensions set statement_timeout='20s' as $$
declare v_hash text; v_roles text[];
begin
 if p_action in ('get_economic_cost_review','get_economic_line_refs') then
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_hash then
   raise exception 'Unauthorized gateway' using errcode='42501';
  end if;
  v_roles:=private.stockflow_active_member_roles(lower(btrim(coalesce(p_actor_email,''))));
  if not coalesce(v_roles&&array['administrator','management','accounts'],false) then
   raise exception 'Economics evidence is restricted' using errcode='42501';
  end if;
  if p_action='get_economic_cost_review' then
   return private.stockflow_economic_cost_review_read(p_payload);
  end if;
  return private.stockflow_economic_line_refs_read(p_payload);
 end if;
 return public.stockflow_economics_gateway_before_cost_review(p_gateway_key,p_actor_email,p_action,p_payload);
end $$;
revoke all on function public.stockflow_economics_gateway_before_cost_review(text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.stockflow_economics_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_economics_gateway(text,text,text,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
