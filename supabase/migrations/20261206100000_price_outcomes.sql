begin;

create function private.stockflow_price_outcomes(p_today date, p_page integer, p_state text) returns jsonb
language sql stable security definer
set search_path=pg_catalog,private,public,extensions as $$
 -- jsonb_array_length on an object raises 22023, retaining a SQL-only read function.
 select case when p_state is not null and p_state not in ('different','not_billed','matches','cannot_match')
  then to_jsonb(jsonb_array_length(jsonb_build_object('invalidState',p_state)))
  else (
 with prices as materialized (
  select p.id,p.customer_id,c.name customer_name,p.tally_item_key,p.valid_to,
   greatest(p.valid_from,(p.approved_at at time zone 'Asia/Kolkata')::date) effective_from,
   least(coalesce(p.valid_to,p_today),p_today) through,round(p.price_amount*100) approved_paise
  from private.stockflow_customer_product_prices p
  join private.stockflow_customers c on c.id=p.customer_id
  where (p.status='approved' or (p.status='superseded' and p.approved_at is not null))
   and p.valid_from<=p_today
 ), catalogs as materialized (
  select distinct on(company_id) company_id,content from private.stockflow_economic_item_catalogs
  order by company_id,observed_at desc,id desc
 ), names as materialized (
  select c.company_id,p->>'id' product_id,p->>'name' item_name
  from catalogs c cross join lateral jsonb_array_elements(c.content->'products') p
  where p->>'name' in (select tally_item_key from prices)
 ), window_lines as materialized (
  select p.id price_id,v.business_date,v.company_id,v.source_id,l.line_key,
   l.net_sales_paise::numeric/l.quantity billed_paise,
   l.net_sales_paise::numeric/l.quantity<p.approved_paise*0.4
    or l.net_sales_paise::numeric/l.quantity>p.approved_paise*2.5 pack
  from private.stockflow_economic_source_vouchers v
  join private.stockflow_economic_source_lines l on l.voucher_id=v.id
  join private.stockflow_economic_customer_identities i
   on i.company_id=v.company_id and i.source_id=v.customer_source_id
  join names n on n.company_id=v.company_id and n.product_id=l.product_id
  join prices p on p.customer_id=i.customer_id and p.tally_item_key=n.item_name
  where v.kind='sale' and not v.cancelled and l.quantity>0 and l.net_sales_paise>0
   and v.business_date between p.effective_from and p.through
   and not exists(select 1 from private.stockflow_economic_source_vouchers newer
    where newer.company_id=v.company_id and newer.source_id=v.source_id and newer.source_revision>v.source_revision)
 ), summarized as materialized (
  select p.*,s.lines,s.pack_lines,s.different_lines,last_line.business_date last_billed_on,
   round(last_line.billed_paise) last_billed_paise,round(worst.billed_paise-p.approved_paise) worst_diff_paise,
   case
    when not exists(select 1 from private.stockflow_economic_customer_identities i where i.customer_id=p.customer_id)
     then 'no_ledger_link'
    when not exists(select 1 from names n where n.item_name=p.tally_item_key)
     or not exists(select 1 from private.stockflow_products product where product.tally_item_key=p.tally_item_key)
     then 'item_not_in_tally'
    when s.lines=0 and s.pack_lines>0 then 'unit_differs'
   end reason
  from prices p
  cross join lateral (
   select count(*) filter(where not w.pack) lines,count(*) filter(where w.pack) pack_lines,
    count(*) filter(where not w.pack and abs(w.billed_paise-p.approved_paise)>100) different_lines
   from window_lines w where w.price_id=p.id
  ) s
  left join lateral (
   select w.business_date,w.billed_paise from window_lines w where w.price_id=p.id and not w.pack
   order by w.business_date desc,w.company_id collate "C",w.source_id collate "C",w.line_key collate "C" limit 1
  ) last_line on true
  left join lateral (
   select w.billed_paise from window_lines w where w.price_id=p.id and not w.pack
   order by abs(w.billed_paise-p.approved_paise) desc,w.business_date desc,
    w.company_id collate "C",w.source_id collate "C",w.line_key collate "C" limit 1
  ) worst on true
 ), classified as materialized (
  select *,case when reason is not null then 'cannot_match' when lines=0 then 'not_billed'
   when different_lines>0 then 'different' else 'matches' end state from summarized
 ), filtered as materialized (
  select *,case state when 'different' then 1 when 'not_billed' then 2 when 'matches' then 3 else 4 end priority
  from classified where p_state is null or state=p_state
 ), page as (
  select * from filtered order by priority,abs(worst_diff_paise) desc nulls last,effective_from desc,id
  limit 10 offset (p_page::bigint-1)*10
 )
 select jsonb_build_object('view','price_outcomes','asOf',p_today,'toleranceRupees',1,
  'page',p_page,'pageSize',10,'total',(select count(*) from filtered),
  'counts',jsonb_build_object('different',(select count(*) from classified where state='different'),
   'not_billed',(select count(*) from classified where state='not_billed'),
   'matches',(select count(*) from classified where state='matches'),
   'cannot_match',(select count(*) from classified where state='cannot_match')),
  'salesThrough',(select max(v.business_date) from private.stockflow_economic_source_vouchers v
   where v.kind='sale' and not v.cancelled and v.business_date between p_today-400 and p_today
    and not exists(select 1 from private.stockflow_economic_source_vouchers newer
     where newer.company_id=v.company_id and newer.source_id=v.source_id and newer.source_revision>v.source_revision)),
  'matureCount',(select count(*) from prices where effective_from<=p_today-60),
  'rows',coalesce((select jsonb_agg(jsonb_build_object(
   'priceId',id,'customerId',customer_id,'customerName',customer_name,'itemKey',tally_item_key,
   'approvedPaise',approved_paise,'effectiveFrom',effective_from,'validTo',valid_to,'state',state,'reason',reason,
   'lines',lines,'packLines',pack_lines,'lastBilledOn',last_billed_on,'lastBilledPaise',last_billed_paise,
   'worstDiffPaise',worst_diff_paise,'differentLines',different_lines)
   order by priority,abs(worst_diff_paise) desc nulls last,effective_from desc,id) from page),'[]'::jsonb))
 ) end;
$$;
revoke all on function private.stockflow_price_outcomes(date,integer,text) from public,anon,authenticated,service_role;

alter function public.stockflow_pricing_gateway(text,text,text,jsonb) rename to stockflow_pricing_gateway_before_price_outcomes;
revoke all on function public.stockflow_pricing_gateway_before_price_outcomes(text,text,text,jsonb) from public,anon,authenticated,service_role;

create function public.stockflow_pricing_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,private,extensions as $$
declare
 actor_email text:=lower(btrim(coalesce(p_actor_email,'')));
 assigned_roles text[];
 secret text;
 page_number integer;
begin
 if p_action is distinct from 'get_order_pricing' or p_payload->>'view' is distinct from 'price_outcomes' then
  return public.stockflow_pricing_gateway_before_price_outcomes(p_gateway_key,p_actor_email,p_action,p_payload);
 end if;
 select secret_sha256 into secret from private.stockflow_gateway_config where name='orders';
 if secret is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>secret then
  raise exception 'Unauthorized gateway' using errcode='42501';
 end if;
 select m.roles into assigned_roles from public.stockflow_members m where m.email=actor_email and m.status='active';
 if not private.stockflow_valid_roles(assigned_roles)
  or not (assigned_roles && array['administrator','management','accounts']::text[]) then
  raise exception 'Price outcomes are restricted' using errcode='42501';
 end if;
 if jsonb_typeof(p_payload) is distinct from 'object'
  or p_payload-array['view','page','state']<>'{}'::jsonb
  or jsonb_typeof(p_payload->'page') is distinct from 'number'
  or (p_payload->>'page') !~ '^[1-9][0-9]{0,5}$'
  or (p_payload ? 'state' and (jsonb_typeof(p_payload->'state') is distinct from 'string'
   or p_payload->>'state' not in ('different','not_billed','matches','cannot_match'))) then
  raise exception 'Invalid price outcomes request' using errcode='22023';
 end if;
 page_number:=(p_payload->>'page')::integer;
 return private.stockflow_price_outcomes((now() at time zone 'Asia/Kolkata')::date,page_number,p_payload->>'state');
end$$;
revoke all on function public.stockflow_pricing_gateway(text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.stockflow_pricing_gateway(text,text,text,jsonb) to service_role;

commit;
notify pgrst, 'reload schema';
