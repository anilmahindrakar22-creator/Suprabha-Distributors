begin;

create function private.stockflow_economic_line_rows(p_ids uuid[]) returns jsonb
language sql stable set search_path=pg_catalog,private as $$
select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'companyId',v.company_id,'voucherId',v.source_id,'revision',v.source_revision::text,'lineKey',l.line_key,'date',v.business_date,'kind',v.kind,'customerSourceId',v.customer_source_id,'productId',l.product_id,'productName',coalesce(l.evidence->>'label',l.product_id),'voucherNumber',nullif(btrim(v.evidence->>'sourceReference'),''),'quantity',l.quantity::text,'unit',l.unit,'netSalesPaise',l.net_sales_paise::text,'batchId',l.batch_id,
   'partyName',coalesce(nullif(v.evidence->>'partyName',''),nullif(v.evidence->>'supplierName',''),nullif(v.evidence->>'customerName',''),
    case when v.customer_source_id is not null and v.kind='sale' and l.quantity=1 and l.net_sales_paise>=5000000 then
     (select m.name from private.stockflow_economic_ledger_masters m join private.stockflow_economic_ledger_generations g on g.company_id=m.company_id and g.catalog_version=m.source_version where g.company_id=v.company_id and m.guid=v.customer_source_id order by g.observed_at desc limit 1) end),
   'usedByInstrument',exists(select 1 from private.stockflow_equipment_installations i where i.historical_sale_line_id=l.id or i.tally_key=v.company_id||':'||v.source_id||':'||l.line_key)
    or exists(select 1 from private.stockflow_economic_acquisition_links a where a.company_id=v.company_id and a.source_id=v.source_id and a.line_key=l.line_key)
    or exists(select 1 from private.stockflow_economic_instrument_billings b where b.company_id=v.company_id and b.source_id=v.source_id and b.line_key=l.line_key)
    or exists(select 1 from private.stockflow_economic_cost_links c join private.stockflow_economic_source_lines cl on cl.id=c.purchase_line_id join private.stockflow_economic_source_vouchers cv on cv.id=cl.voucher_id where cv.company_id=v.company_id and cv.source_id=v.source_id and cl.line_key=l.line_key)) order by requested.ord),'[]'::jsonb)
from unnest(p_ids) with ordinality requested(id,ord)
join private.stockflow_economic_source_lines l on l.id=requested.id
join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id
where not v.cancelled and not exists(select 1 from private.stockflow_economic_source_vouchers n where n.company_id=v.company_id and n.source_id=v.source_id and n.source_revision>v.source_revision)
$$;

create function private.stockflow_economic_source_lines_read(p jsonb) returns jsonb
language plpgsql stable set search_path=pg_catalog,private as $$
declare
 k text; ids uuid[]; page_ids uuid[]; n integer:=50; off integer:=0; total bigint; pattern text;
begin
 if jsonb_typeof(p) is distinct from 'object' then
  raise exception 'Invalid source lines payload' using errcode='22023';
 end if;
 if exists(select 1 from jsonb_object_keys(p) key where key not in ('kind','companyId','customerSourceId','productId','q','ids','limit','offset')) then
  raise exception 'Invalid source lines payload' using errcode='22023';
 end if;
 if p ? 'kind' and (jsonb_typeof(p->'kind') is distinct from 'string' or p->>'kind' not in ('sale','purchase','return','credit')) then
  raise exception 'Invalid source lines kind' using errcode='22023';
 end if;
 foreach k in array array['companyId','customerSourceId','productId'] loop
  if p ? k and (jsonb_typeof(p->k) is distinct from 'string' or length(btrim(p->>k))=0 or length(p->>k)>240) then
   raise exception 'Invalid source lines filter' using errcode='22023';
  end if;
 end loop;
 if p ? 'q' then
  if jsonb_typeof(p->'q') is distinct from 'string' or length(btrim(p->>'q')) not between 1 and 80 then
   raise exception 'Invalid source lines query' using errcode='22023';
  end if;
  pattern:='%'||replace(replace(replace(btrim(p->>'q'),E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';
 end if;
 if p ? 'ids' then
  if jsonb_typeof(p->'ids') is distinct from 'array' then
   raise exception 'Invalid source lines ids' using errcode='22023';
  end if;
  if jsonb_array_length(p->'ids') not between 1 and 200
   or exists(select 1 from jsonb_array_elements(p->'ids') x where jsonb_typeof(x) is distinct from 'string') then
   raise exception 'Invalid source lines ids' using errcode='22023';
  end if;
  begin
   select array_agg(value::uuid order by ord) into ids from jsonb_array_elements_text(p->'ids') with ordinality a(value,ord);
  exception when invalid_text_representation then
   raise exception 'Invalid source lines ids' using errcode='22023';
  end;
  n:=cardinality(ids);
 end if;
 foreach k in array array['limit','offset'] loop
  if p ? k then
   if jsonb_typeof(p->k) is distinct from 'number' or (p->>k) !~ '^[0-9]+$' then
    raise exception 'Invalid source lines pagination' using errcode='22023';
   end if;
   if (p->>k)::numeric not between (case when k='limit' then 1 else 0 end) and (case when k='limit' then 200 else 10000 end) then
    raise exception 'Invalid source lines pagination' using errcode='22023';
   end if;
   if k='limit' then n:=(p->>k)::integer; else off:=(p->>k)::integer; end if;
  end if;
 end loop;
 with candidates as materialized (
  select l.id,v.business_date,v.source_id,l.line_key
  from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id
  where not v.cancelled and not exists(select 1 from private.stockflow_economic_source_vouchers newer
   where newer.company_id=v.company_id and newer.source_id=v.source_id and newer.source_revision>v.source_revision)
   and (not p ? 'kind' or v.kind=p->>'kind')
   and (not p ? 'companyId' or v.company_id=p->>'companyId')
   and (not p ? 'customerSourceId' or v.customer_source_id=p->>'customerSourceId')
   and (not p ? 'productId' or l.product_id=p->>'productId')
   and (ids is null or l.id=any(ids))
   and (pattern is null or nullif(btrim(v.evidence->>'sourceReference'),'') ilike pattern escape E'\\'
    or v.source_id ilike pattern escape E'\\' or l.product_id ilike pattern escape E'\\'
    or l.evidence->>'label' ilike pattern escape E'\\' or v.evidence->>'partyName' ilike pattern escape E'\\'
    or v.evidence->>'supplierName' ilike pattern escape E'\\' or v.evidence->>'customerName' ilike pattern escape E'\\')
 ), page as (
  select * from candidates order by array_position(ids,id),business_date desc,source_id,line_key,id limit n offset off
 )
 select (select count(*) from candidates),
  (select array_agg(id order by array_position(ids,id),business_date desc,source_id,line_key,id) from page)
 into total,page_ids;
 return jsonb_build_object('rows',private.stockflow_economic_line_rows(page_ids),'total',total,'limit',n,'offset',off);
end $$;

create function private.stockflow_economic_exceptions_read(p jsonb) returns jsonb
language plpgsql stable set search_path=pg_catalog,private as $$
declare k text; n integer:=200; off integer:=0; run uuid; result jsonb;
begin
 if jsonb_typeof(p) is distinct from 'object' then
  raise exception 'Invalid exceptions payload' using errcode='22023';
 end if;
 if exists(select 1 from jsonb_object_keys(p) key where key not in ('limit','offset')) then
  raise exception 'Invalid exceptions payload' using errcode='22023';
 end if;
 foreach k in array array['limit','offset'] loop
  if p ? k then
   if jsonb_typeof(p->k) is distinct from 'number' or (p->>k) !~ '^[0-9]+$' then
    raise exception 'Invalid exceptions pagination' using errcode='22023';
   end if;
   if (p->>k)::numeric not between (case when k='limit' then 1 else 0 end) and (case when k='limit' then 500 else 100000 end) then
    raise exception 'Invalid exceptions pagination' using errcode='22023';
   end if;
   if k='limit' then n:=(p->>k)::integer; else off:=(p->>k)::integer; end if;
  end if;
 end loop;
 select id into run from private.stockflow_economic_runs where active;
 with errors as materialized (
    select jsonb_build_object('sourceId',v.source_id||':'||l.line_key,'sourceLineId',l.id,'productId',l.product_id,'date',v.business_date,'netSalesPaise',sum(r.revenue_paise)::text,'status',r.status,'reason',r.reason) x
    from private.stockflow_economic_results r join private.stockflow_economic_source_lines l on l.id=r.source_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where r.run_id=run and r.status not in ('verified','instrument_billing') and r.reason is distinct from 'no_verified_compatible_placement' group by v.source_id,l.id,v.business_date,r.status,r.reason
    union all select jsonb_build_object('sourceId','Customer '||v.customer_source_id,'productId',count(*)::text||' sales lines','date',max(v.business_date),'netSalesPaise',sum(r.revenue_paise)::text,'status','unattributed','reason','no_verified_compatible_placement','lineCount',count(*))
    from private.stockflow_economic_results r join private.stockflow_economic_source_lines l on l.id=r.source_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where r.run_id=run and r.status not in ('verified','instrument_billing') and r.reason='no_verified_compatible_placement' group by v.company_id,v.customer_source_id
    union all select jsonb_build_object('sourceId',coalesce(source_id,'import'),'productId','','date',private.stockflow_economic_business_date(recorded_at),'netSalesPaise','0','status','import_rejected','reason',reason,'voucherNumber',evidence->>'sourceReference','voucherType',evidence->>'voucherType','voucherDate',evidence->>'date','detail',evidence->>'error','kind',evidence->>'kind') from private.stockflow_economic_import_exceptions e where private.stockflow_economic_import_exception_open(e.id)
 ), groups as (
  select x->>'status' status,x->>'reason' reason,count(*) count,sum((x->>'netSalesPaise')::numeric)::text net
  from errors group by x->>'status',x->>'reason'
 ), page as (
  select x from errors order by x->>'date' desc nulls last,x->>'sourceId',x->>'sourceLineId' nulls last,x::text limit n offset off
 )
 select jsonb_build_object(
  'groups',coalesce((select jsonb_agg(jsonb_build_object('status',status,'reason',reason,'count',count,'netSalesPaise',net) order by count desc,status,reason) from groups),'[]'::jsonb),
  'rows',coalesce((select jsonb_agg(x order by x->>'date' desc nulls last,x->>'sourceId',x->>'sourceLineId' nulls last,x::text) from page),'[]'::jsonb),
  'total',(select count(*) from errors),'limit',n,'offset',off) into result;
 return result;
end $$;

revoke all on function private.stockflow_economic_line_rows(uuid[]) from public,anon,authenticated,service_role;
revoke all on function private.stockflow_economic_source_lines_read(jsonb) from public,anon,authenticated,service_role;
revoke all on function private.stockflow_economic_exceptions_read(jsonb) from public,anon,authenticated,service_role;

alter function public.stockflow_economics_gateway(text,text,text,jsonb)
 rename to stockflow_economics_gateway_before_line_reads;
create function public.stockflow_economics_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private,extensions set statement_timeout='20s' as $$
declare v_hash text; v_roles text[];
begin
 if p_action in ('get_economic_source_lines','get_economic_exceptions') then
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_hash then
   raise exception 'Unauthorized gateway' using errcode='42501';
  end if;
  select roles into v_roles from public.stockflow_members
   where email=lower(btrim(coalesce(p_actor_email,''))) and status='active';
  if not private.stockflow_valid_roles(v_roles) or not coalesce(v_roles&&array['administrator','management'],false) then
   raise exception 'Economics evidence is restricted' using errcode='42501';
  end if;
  if p_action='get_economic_source_lines' then
   return private.stockflow_economic_source_lines_read(coalesce(p_payload,'{}'::jsonb));
  end if;
  return private.stockflow_economic_exceptions_read(coalesce(p_payload,'{}'::jsonb));
 end if;
 return public.stockflow_economics_gateway_before_line_reads(p_gateway_key,p_actor_email,p_action,p_payload);
end $$;
revoke all on function public.stockflow_economics_gateway_before_line_reads(text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.stockflow_economics_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_economics_gateway(text,text,text,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;

