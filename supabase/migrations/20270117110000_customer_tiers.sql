begin;

create function public.stockflow_customer_tier_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer
set search_path=pg_catalog,private,public,extensions set statement_timeout to '5s' as $$
declare
 hash text; v_email text:=lower(btrim(p_actor_email)); v_role text; v_roles text[];
 v_ids uuid[]; v_result jsonb;
begin
 select secret_sha256 into hash from private.stockflow_gateway_config where name='orders';
 if hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>hash then
  raise exception 'Unauthorized gateway' using errcode='42501';end if;
 if p_action is distinct from 'get_customer_tiers' then
  raise exception 'Invalid customer tiers action' using errcode='22023';
 end if;
 select role, roles into v_role, v_roles from public.stockflow_members where email=v_email and status='active';
 if v_role is null or not private.stockflow_valid_roles(v_roles) then raise exception 'Account is not approved' using errcode='42501'; end if;

 if jsonb_typeof(p_payload) is distinct from 'object' then
  raise exception 'Invalid customer tiers request' using errcode='22023';
 end if;
 if p_payload - 'orderIds' <> '{}'::jsonb or jsonb_typeof(p_payload->'orderIds') is distinct from 'array' then
  raise exception 'Invalid customer tiers request' using errcode='22023';
 end if;
 if jsonb_array_length(p_payload->'orderIds') not between 1 and 100
  or exists(select 1 from jsonb_array_elements(p_payload->'orderIds') e where jsonb_typeof(e) <> 'string') then
  raise exception 'Invalid customer tiers request' using errcode='22023';
 end if;
 begin
  select array_agg(id::uuid) into v_ids from jsonb_array_elements_text(p_payload->'orderIds') t(id);
 exception when invalid_text_representation then
  raise exception 'Invalid customer tiers request' using errcode='22023';
 end;
 if (select count(distinct id) from unnest(v_ids) id) <> cardinality(v_ids) then
  raise exception 'Invalid customer tiers request' using errcode='22023';
 end if;

 with latest as (
  select max(month) as month from private.stockflow_lab_tier_snapshots
 ), ranked as (
  select o.id, min(case s.tier when 'diamond' then 1 when 'platinum' then 2 when 'gold' then 3 when 'silver' then 4 end) as tier_rank
  from private.stockflow_orders o
  join private.stockflow_economic_customer_identities i on i.customer_id=o.customer_id
  join private.stockflow_lab_tier_snapshots s on s.company_id=i.company_id and s.customer_source_id=i.source_id
  join latest l on l.month=s.month
  where o.id=any(v_ids) and o.archived_at is null
   and private.stockflow_role_can_read_order(v_email, v_roles, o.created_by_email)
   and s.tier in ('diamond','platinum','gold','silver')
  group by o.id
 )
 select jsonb_build_object('month',to_char(l.month,'YYYY-MM-DD'),'tiers',
  coalesce((select jsonb_object_agg(id::text,(array['diamond','platinum','gold','silver'])[tier_rank]) from ranked),'{}'::jsonb))
 into v_result from latest l;
 return v_result;
end $$;

revoke all on function public.stockflow_customer_tier_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_customer_tier_gateway(text,text,text,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
