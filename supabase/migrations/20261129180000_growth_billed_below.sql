begin;

-- Approved INR prices are per-unit, before GST (the order billing-sheet basis).
-- Use sales and price evidence directly; this read has no costing dependency.
create function private.stockflow_growth_billed_below(p_today date,p_payload jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,private,public,extensions as $$
declare page_number integer; result jsonb;
begin
 if p_today is null or jsonb_typeof(p_payload) is distinct from 'object' then
  raise exception 'Invalid billed-below request' using errcode='22023';end if;
 if p_payload-array['page']<>'{}'::jsonb
  or jsonb_typeof(p_payload->'page') is distinct from 'number'
  or (p_payload->>'page') !~ '^[1-9][0-9]*$' or length(p_payload->>'page')>10 then
  raise exception 'Invalid billed-below page' using errcode='22023';end if;
 begin page_number:=(p_payload->>'page')::integer;
 exception when numeric_value_out_of_range then
  raise exception 'Invalid billed-below page' using errcode='22023';end;

 with bounds as (
  select date_trunc('month',p_today)::date window_end,
   (date_trunc('month',p_today)-interval '12 months')::date window_start
 ), catalogs as materialized (
  select distinct on(company_id) company_id,content from private.stockflow_economic_item_catalogs
  order by company_id,observed_at desc,id desc
 ), names as (
  select c.company_id,p->>'id' product_id,p->>'name' item_name
  from catalogs c cross join lateral jsonb_array_elements(c.content->'products') p
 ), priced as materialized (
  select v.company_id,v.source_id,l.line_key,v.business_date,c.id customer_id,c.name,c.city town,
   n.item_name,l.quantity,l.net_sales_paise::numeric/l.quantity billed,price.approved
  from private.stockflow_economic_source_vouchers v cross join bounds b
  join private.stockflow_economic_source_lines l on l.voucher_id=v.id
  join private.stockflow_economic_customer_identities i
   on i.company_id=v.company_id and i.source_id=v.customer_source_id
  join private.stockflow_customers c on c.id=i.customer_id
  join names n on n.company_id=v.company_id and n.product_id=l.product_id
  join lateral (
   select round(p.price_amount*100) approved from private.stockflow_customer_product_prices p
   where p.customer_id=c.id and p.tally_item_key=n.item_name
    and p.status in ('approved','superseded')
    and p.valid_from<=v.business_date and (p.valid_to is null or p.valid_to>=v.business_date)
    and (p.approved_at at time zone 'Asia/Kolkata')::date<=v.business_date
   order by p.approved_at desc,p.version desc,p.id desc limit 1
  ) price on true
  where v.kind='sale' and not v.cancelled and l.quantity>0 and l.net_sales_paise>0
   and v.business_date>=b.window_start and v.business_date<b.window_end
   and not exists(select 1 from private.stockflow_economic_source_vouchers newer
    where newer.company_id=v.company_id and newer.source_id=v.source_id and newer.source_revision>v.source_revision)
   and exists(select 1 from private.stockflow_products p where p.tally_item_key=n.item_name)
 ), classified as materialized (
  select *,billed<approved*0.4 or billed>approved*2.5 mismatch,
   round((approved-billed)*quantity) gap from priced
 ), flagged as materialized (
  select * from classified where not mismatch and billed<approved*0.995
 ), page as (
  select * from flagged order by gap desc,business_date desc,source_id collate "C",line_key collate "C",company_id collate "C"
  limit 20 offset (page_number::bigint-1)*20
 )
 select jsonb_build_object('lines',(select count(*) from flagged),
  'gapPaise',(select coalesce(sum(gap),0) from flagged),
  'unitMismatchLines',(select count(*) from classified where mismatch),
  -- Status inventory, independent of the historical sales window and pagination.
  'approvedPricesInUse',(select count(*) from private.stockflow_customer_product_prices where status='approved'),
  'page',page_number,'pageSize',20,'total',(select count(*) from flagged),
  'rows',coalesce(jsonb_agg(jsonb_build_object('date',business_date,'customerId',customer_id,
   'name',name,'town',town,'itemName',item_name,'quantity',quantity,'billedRatePaise',billed,
   'approvedRatePaise',approved,'gapPaise',gap,'voucherRef',source_id)
   order by gap desc,business_date desc,source_id collate "C",line_key collate "C",company_id collate "C"),'[]')) into result from page;
 return result;
end$$;

do $patch$
declare f text; anchor text:='if p_action is distinct from ''get_growth'' or p_payload is distinct from ''{}''::jsonb then';
begin
 select replace(pg_get_functiondef('public.stockflow_growth_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'') into f;
 if (length(f)-length(replace(f,anchor,'')))/length(anchor)<>1 then
  raise exception 'Unexpected billed-below gateway seam';end if;
 execute replace(f,anchor,$new$if p_action='get_growth_billed_below' then
  return private.stockflow_growth_billed_below((now() at time zone 'Asia/Kolkata')::date,p_payload);
 end if;
 if p_action is distinct from 'get_growth' or p_payload is distinct from '{}'::jsonb then$new$);
end$patch$;

revoke all on function private.stockflow_growth_billed_below(date,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.stockflow_growth_gateway(text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.stockflow_growth_gateway(text,text,text,jsonb) to service_role;
commit;
notify pgrst,'reload schema';
