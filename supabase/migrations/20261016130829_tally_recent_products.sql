begin;
-- Read the existing connector's sales-only snapshot. Never consult app drafts,
-- economic Debit Notes, prices, or another customer's bills for suggestions.
create function public.stockflow_recent_products_gateway(
 p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
 v_email text:=lower(btrim(coalesce(p_actor_email,''))); v_hash text;
 v_customer uuid; v_ledger text; v_snapshot jsonb; v_result jsonb;
begin
 select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
 if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_hash then
  raise exception 'Unauthorized gateway' using errcode='42501';
 end if;
 if p_action<>'get_tally_recent_products' then raise exception 'Unsupported recent products action' using errcode='22023';end if;
 if not exists(select 1 from public.stockflow_members where email=v_email and status='active' and private.stockflow_valid_roles(roles)) then
  raise exception 'Account is not approved' using errcode='42501';
 end if;
 if coalesce(p_payload->>'customerId','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
  raise exception 'Valid customer ID is required' using errcode='22023';
 end if;
 v_customer:=(p_payload->>'customerId')::uuid;
 select nullif(btrim(tally_key),'') into v_ledger from private.stockflow_customers where id=v_customer and active;
 if not found then raise exception 'Customer is unavailable' using errcode='22023';end if;
 if v_ledger is null then return jsonb_build_object('customerId',v_customer,'linked',false,'billCount',0,'products','[]'::jsonb);end if;
 select payload into v_snapshot from public.stockflow_snapshots where id='suprabha';
 if not found then raise exception 'Tally snapshot is unavailable' using errcode='22023';end if;
 with
 -- Keep canonical catalog keys. Ambiguous names cannot be guessed.
 catalog as materialized (
  select lower(regexp_replace(btrim(c->>'item'),'\s+',' ','g')) name,
   min(c->>'tallyKey') tally_key
  from jsonb_array_elements(coalesce(v_snapshot->'catalog','[]'::jsonb)) c
  where c->>'active'='true' and nullif(c->>'tallyKey','') is not null
  group by 1 having count(*)=1
 ), raw_bills as materialized (
  select invoice,
   coalesce(nullif(invoice->>'masterId',''),(invoice->>'voucherNumber')||':'||(invoice->>'date')) identity
  from jsonb_array_elements(coalesce(v_snapshot->'tallyInvoices','[]'::jsonb)) invoice
  where lower(regexp_replace(btrim(invoice->>'party'),'\s+',' ','g'))=lower(regexp_replace(btrim(v_ledger),'\s+',' ','g'))
   and nullif(btrim(invoice->>'voucherNumber'),'') is not null
   and invoice->>'date' ~ '^20[0-9]{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])$'
   and case when invoice->>'date' ~ '^20[0-9]{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])$'
    then to_char(to_date(invoice->>'date','YYYYMMDD'),'YYYYMMDD')=invoice->>'date' else false end
   and invoice->>'date'<=to_char(now() at time zone 'Asia/Kolkata','YYYYMMDD')
   and jsonb_typeof(invoice->'lineItems')='array'
 ), bills as materialized (
  select (jsonb_agg(invoice)->0) invoice, identity
  from raw_bills group by identity
  having count(distinct invoice)=1
  order by (jsonb_agg(invoice)->0)->>'date' desc,identity limit 20
 ), bill_items as (
  select b.identity,b.invoice->>'date' billed_at,c.tally_key,
   sum(case when jsonb_typeof(line->'quantity')='number' then (line->>'quantity')::numeric else 0 end) quantity
  from bills b cross join lateral jsonb_array_elements(b.invoice->'lineItems') line
  join catalog c on c.name=lower(regexp_replace(btrim(line->>'itemName'),'\s+',' ','g'))
  group by b.identity,b.invoice->>'date',c.tally_key
 ), ranked as (
  select *,count(*) over(partition by tally_key) bill_count,
   row_number() over(partition by tally_key order by billed_at desc,identity) rn
  from bill_items where quantity>0 and quantity<=1000000
 ), products as (
  select tally_key,bill_count,billed_at,quantity from ranked where rn=1
  order by bill_count desc,billed_at desc,tally_key limit 100
 )
 select jsonb_build_object('customerId',v_customer,'linked',true,'billCount',(select count(*) from bills),
  'products',coalesce((select jsonb_agg(jsonb_build_object('tallyKey',tally_key,'billCount',bill_count,
   'lastBilledAt',substr(billed_at,1,4)||'-'||substr(billed_at,5,2)||'-'||substr(billed_at,7,2),
   'lastQuantity',quantity) order by bill_count desc,billed_at desc,tally_key) from products),'[]'::jsonb)) into v_result;
 return v_result;
end $$;
revoke all on function public.stockflow_recent_products_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_recent_products_gateway(text,text,text,jsonb) to service_role;
commit;
