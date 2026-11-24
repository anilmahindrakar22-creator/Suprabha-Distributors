begin;

create function private.stockflow_economic_products_read(p jsonb) returns jsonb
language plpgsql stable set search_path=pg_catalog,private as $$
declare k text; n integer:=200; off integer:=0; words text[]; ids text[]; result jsonb;
begin
 if jsonb_typeof(p) is distinct from 'object' then
  raise exception 'Invalid products payload' using errcode='22023';
 end if;
 if exists(select 1 from jsonb_object_keys(p) key where key not in ('companyId','q','productIds','limit','offset')) then
  raise exception 'Invalid products payload' using errcode='22023';
 end if;
 if p ? 'companyId' and (jsonb_typeof(p->'companyId') is distinct from 'string' or length(btrim(p->>'companyId'))=0 or length(p->>'companyId')>240) then
  raise exception 'Invalid products payload' using errcode='22023';
 end if;
 if p ? 'q' then
  if jsonb_typeof(p->'q') is distinct from 'string' or length(btrim(p->>'q')) not between 1 and 80 then
   raise exception 'Invalid products payload' using errcode='22023';
  end if;
  select array_agg('%'||replace(replace(replace(word,E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%')
   into words from regexp_split_to_table(btrim(p->>'q'),'\s+') word;
  if cardinality(words)>6 then
   raise exception 'Invalid products payload' using errcode='22023';
  end if;
 end if;
 if p ? 'productIds' then
  if jsonb_typeof(p->'productIds') is distinct from 'array' then
   raise exception 'Invalid products payload' using errcode='22023';
  end if;
  if jsonb_array_length(p->'productIds') not between 1 and 200
   or exists(select 1 from jsonb_array_elements(p->'productIds') x where jsonb_typeof(x) is distinct from 'string' or length(btrim(x#>>'{}'))=0 or length(x#>>'{}')>240) then
   raise exception 'Invalid products payload' using errcode='22023';
  end if;
  select array_agg(value) into ids from jsonb_array_elements_text(p->'productIds');
 end if;
 foreach k in array array['limit','offset'] loop
  if p ? k then
   if jsonb_typeof(p->k) is distinct from 'number' or (p->>k) !~ '^[0-9]+$' then
    raise exception 'Invalid products payload' using errcode='22023';
   end if;
   if (p->>k)::numeric not between (case when k='limit' then 1 else 0 end) and (case when k='limit' then 500 else 100000 end) then
    raise exception 'Invalid products payload' using errcode='22023';
   end if;
   if k='limit' then n:=(p->>k)::integer; else off:=(p->>k)::integer; end if;
  end if;
 end loop;
 with latest as materialized (
  select distinct on (v.company_id,l.product_id) v.company_id,l.product_id,
   coalesce(l.evidence->>'label',l.product_id) product_name,v.business_date last_date
  from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id
  where not v.cancelled and not exists(select 1 from private.stockflow_economic_source_vouchers newer
   where newer.company_id=v.company_id and newer.source_id=v.source_id and newer.source_revision>v.source_revision)
  order by v.company_id,l.product_id,v.business_date desc,v.source_revision desc,l.id desc
 ), filtered as materialized (
  select * from latest
  where (not p ? 'companyId' or company_id=p->>'companyId')
   and (ids is null or product_id=any(ids))
   and (words is null or not exists(select 1 from unnest(words) w where not coalesce((
    product_id ilike w escape E'\\' or product_name ilike w escape E'\\'),false)))
 ), page as (
  select * from filtered order by lower(product_name),product_id collate "C",company_id collate "C" limit n offset off
 )
 select jsonb_build_object(
  'rows',coalesce((select jsonb_agg(jsonb_build_object('companyId',company_id,'productId',product_id,'productName',product_name,'lastDate',last_date)
   order by lower(product_name),product_id collate "C",company_id collate "C") from page),'[]'::jsonb),
  'total',(select count(*) from filtered),'limit',n,'offset',off,
  'companies',coalesce((select jsonb_agg(company_id order by company_id collate "C") from (select distinct company_id from latest) c),'[]'::jsonb)) into result;
 return result;
end $$;

revoke all on function private.stockflow_economic_products_read(jsonb) from public,anon,authenticated,service_role;
alter function public.stockflow_economics_gateway(text,text,text,jsonb)
 rename to stockflow_economics_gateway_before_products;
create function public.stockflow_economics_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private,extensions set statement_timeout='20s' as $$
declare v_hash text; v_roles text[];
begin
 if p_action='get_economic_products' then
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_hash then
   raise exception 'Unauthorized gateway' using errcode='42501';
  end if;
  v_roles:=private.stockflow_active_member_roles(lower(btrim(coalesce(p_actor_email,''))));
  if not coalesce(v_roles&&array['administrator','management','accounts'],false) then
   raise exception 'Economics evidence is restricted' using errcode='42501';
  end if;
  return private.stockflow_economic_products_read(coalesce(p_payload,'{}'::jsonb));
 end if;
 return public.stockflow_economics_gateway_before_products(p_gateway_key,p_actor_email,p_action,p_payload);
end $$;
revoke all on function public.stockflow_economics_gateway_before_products(text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.stockflow_economics_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_economics_gateway(text,text,text,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
