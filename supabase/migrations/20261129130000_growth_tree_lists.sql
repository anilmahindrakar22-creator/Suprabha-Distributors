begin;

create function private.stockflow_growth_tree_labs_read(p_today date,p_roles text[],p_payload jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,private,public,extensions as $$
declare list_name text:=p_payload->>'list'; sort_name text:='value'; half_name text:=p_payload->>'half';
 page_number integer; window_end date:=date_trunc('month',p_today)::date;
 scope_start date:=(window_end-interval '12 months')::date; scope_end date:=window_end;
 model jsonb; result jsonb;
begin
 if not coalesce(p_roles&&array['administrator','management'],false) then
  raise exception 'Growth access required' using errcode='42501';end if;
 if p_today is null or jsonb_typeof(p_payload) is distinct from 'object' then
  raise exception 'Invalid growth tree request' using errcode='22023';end if;
 if exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('list','page','sort','half'))
 or jsonb_typeof(p_payload->'list') is distinct from 'string'
 or list_name not in ('window_labs','bulk_invoices')
 or jsonb_typeof(p_payload->'page') is distinct from 'number'
 or (p_payload->>'page') !~ '^[1-9][0-9]*$' or length(p_payload->>'page')>10 then
  raise exception 'Invalid growth tree request' using errcode='22023';end if;
 begin page_number:=(p_payload->>'page')::integer;
 exception when numeric_value_out_of_range then raise exception 'Invalid page' using errcode='22023';end;
 if p_payload ? 'sort' then
  if jsonb_typeof(p_payload->'sort') is distinct from 'string' then raise exception 'Invalid sort' using errcode='22023';end if;
  sort_name:=p_payload->>'sort';end if;
 if sort_name not in ('value','months','last','per_month')
 or (list_name='bulk_invoices' and sort_name not in ('value','last'))
 or (p_payload ? 'half' and (jsonb_typeof(p_payload->'half') is distinct from 'string' or half_name not in ('H1','H2'))) then
  raise exception 'Invalid growth tree options' using errcode='22023';end if;
 if half_name='H1' then scope_end:=(window_end-interval '6 months')::date;
 elsif half_name='H2' then scope_start:=(window_end-interval '6 months')::date;end if;
 if list_name='window_labs' then model:=private.stockflow_growth_p1b_model(p_today);end if;

 with vouchers as materialized (
  -- The same latest-revision and half-open scope rule as stockflow_growth_read.
  select v.id,v.company_id,v.customer_source_id,v.business_date,v.kind,sum(l.net_sales_paise::numeric) net
  from private.stockflow_economic_source_vouchers v
  join private.stockflow_economic_source_lines l on l.voucher_id=v.id
  where v.business_date>=scope_start and v.business_date<scope_end
   and not v.cancelled and v.kind in ('sale','return','credit')
   and not exists(select 1 from private.stockflow_economic_source_vouchers n
    where n.company_id=v.company_id and n.source_id=v.source_id and n.source_revision>v.source_revision)
  group by v.id
 ), sales as materialized (
  select *,kind='sale' and net>=20000000 bulk from vouchers
 ), lab_months as (
  select company_id,customer_source_id,date_trunc('month',business_date) m,sum(net) net,
   coalesce(sum(net) filter(where not bulk),0) repeat_net
  from sales group by 1,2,3
 ), labs as (
  -- Match the tree's repeat-only rupees per buying month; bulk affects val only.
  select company_id,customer_source_id,sum(net) net,sum(repeat_net) repeat_net,
   count(*) filter(where repeat_net>0) repeat_bought_months
  from lab_months group by 1,2
  -- Exact tree.labsBuying membership: at least one positive non-bulk lab-month.
  -- Do not additionally filter the scope net: later returns can make it <= 0.
  having bool_or(repeat_net>0)
 ), selected as materialized (
  select s.company_id,s.customer_source_id,s.id::text row_key,s.net val,s.business_date last_on,
   null::jsonb lab,null::numeric per_month
  from sales s where list_name='bulk_invoices' and s.bulk
  union all
  select l.company_id,l.customer_source_id,j->>'lab_key',l.net,(j->>'last_bought')::date,j,
   l.repeat_net/nullif(l.repeat_bought_months,0)
  from labs l join jsonb_array_elements(model->'labs') j on j->>'company_id'=l.company_id
   and j->>'customer_source_id' is not distinct from l.customer_source_id
  where list_name='window_labs'
 ), ranked as (
  select *,row_number() over(order by
   case when sort_name='value' then val when sort_name='per_month' then per_month end desc nulls last,
   case when sort_name='months' then (lab->>'months_bought')::int end desc,
   case when sort_name in ('months','last') then last_on end desc nulls last,
   row_key) ordinal from selected
 ), page as (
  select * from ranked order by ordinal limit 20 offset (page_number::bigint-1)*20
 ) select jsonb_build_object('list',list_name,'month',null,'total',(select count(*) from selected),
  'page',page_number,'pageSize',20,'rows',coalesce(jsonb_agg(
   case when list_name='bulk_invoices' then jsonb_build_object('invoice',true,
    'name',coalesce(c.name,private.stockflow_growth_ledger_name(p.company_id,p.customer_source_id)),
    'customerId',c.id,'valuePaise',val,'date',last_on)
   else jsonb_build_object('labKey',row_key,'customerId',c.id,
    'name',coalesce(c.name,private.stockflow_growth_ledger_name(p.company_id,p.customer_source_id)),
    'town',c.city,'valuePaise',val,'monthsBought',(lab->>'months_bought')::int,
    'lastBoughtOn',lab->>'last_bought','trend',case
     when (lab->>'recent')::numeric<=0 and (lab->>'prior')::numeric<=0 then null
     when (lab->>'recent')::numeric>1.1*(lab->>'prior')::numeric then 'up'
     when (lab->>'recent')::numeric<0.9*(lab->>'prior')::numeric then 'down' else 'flat' end) end
   order by ordinal),'[]')) into result
 from page p left join private.stockflow_economic_customer_identities i
  on i.company_id=p.company_id and i.source_id=p.customer_source_id
 left join private.stockflow_customers c on c.id=i.customer_id;
 return result;
end$$;

-- Dispatch only the two new lists. Every existing validation, query, row and
-- ordering expression remains byte-for-byte equivalent to the P1b function.
do $patch$
declare f text; anchor text:='if p_today is null or jsonb_typeof(p_payload) is distinct from ''object'' then';
begin
 select replace(pg_get_functiondef('private.stockflow_growth_labs_read(date,text[],jsonb)'::regprocedure),chr(13),'') into f;
 if (length(f)-length(replace(f,anchor,'')))/length(anchor)<>1 then raise exception 'Unexpected Growth labs dispatch seam';end if;
 execute replace(f,anchor,$new$if list_name in ('window_labs','bulk_invoices') then
  return private.stockflow_growth_tree_labs_read(p_today,p_roles,p_payload);
 end if;
 if p_today is null or jsonb_typeof(p_payload) is distinct from 'object' then$new$);
end$patch$;

revoke all on function private.stockflow_growth_tree_labs_read(date,text[],jsonb) from public,anon,authenticated,service_role;
revoke all on function private.stockflow_growth_labs_read(date,text[],jsonb) from public,anon,authenticated,service_role;
revoke all on function public.stockflow_growth_gateway(text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.stockflow_growth_gateway(text,text,text,jsonb) to service_role;
commit;
notify pgrst,'reload schema';
