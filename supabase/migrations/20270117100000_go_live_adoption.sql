begin;

create function private.stockflow_go_live_read(p_now timestamptz default now()) returns jsonb
language sql stable security definer
set search_path=pg_catalog,private,public set statement_timeout to '5s' as $$
with bounds as (
 select date_trunc('week',p_now at time zone 'Asia/Kolkata')::date as monday
), weeks as (
 select (monday - n*7)::date as start from bounds cross join generate_series(0,4) n
), latest as (
 select distinct on (v.company_id,v.source_id) v.source_id,v.kind,v.cancelled,v.business_date
 from private.stockflow_economic_source_vouchers v
 where (v.company_id,v.source_id) in (select company_id,source_id from private.stockflow_economic_source_vouchers where business_date>=(select min(start) from weeks))
 order by v.company_id,v.source_id,v.source_revision desc
), members as (
 select email,roles from public.stockflow_members where status='active'
), people as (
 select m.email,m.roles,
 (select count(*) from private.stockflow_command_results c,bounds b where c.actor_email=m.email and c.completed_at>=b.monday::timestamp at time zone 'Asia/Kolkata' and c.completed_at<(b.monday+7)::timestamp at time zone 'Asia/Kolkata') as actions,
 (select count(*) from private.stockflow_orders o,bounds b where o.created_by_email=m.email and o.archived_at is null and o.created_at>=b.monday::timestamp at time zone 'Asia/Kolkata' and o.created_at<(b.monday+7)::timestamp at time zone 'Asia/Kolkata') as orders,
 (select count(*) from private.stockflow_customer_visits v,bounds b where v.visited_by=m.email and v.visited_on>=b.monday and v.visited_on<b.monday+7) as visits,
 (select max(completed_at) from private.stockflow_command_results c where c.actor_email=m.email) as last_action
 from members m order by actions desc,m.email limit 50
)
select jsonb_build_object(
 'weeks',(select jsonb_agg(jsonb_build_object(
 'weekStart',w.start,
 'ordersEntered',(select count(*) from private.stockflow_orders o where o.archived_at is null and o.created_at>=w.start::timestamp at time zone 'Asia/Kolkata' and o.created_at<(w.start+7)::timestamp at time zone 'Asia/Kolkata'),
 'ordersLinkedToTally',(select count(*) from private.stockflow_orders o where o.archived_at is null and o.created_at>=w.start::timestamp at time zone 'Asia/Kolkata' and o.created_at<(w.start+7)::timestamp at time zone 'Asia/Kolkata' and exists(select 1 from private.stockflow_order_tally_invoices i where i.order_id=o.id)),
 'tallySaleInvoices',(select count(*) from latest v where v.kind='sale' and not v.cancelled and v.business_date>=w.start and v.business_date<w.start+7),
 'visitsLogged',(select count(*) from private.stockflow_customer_visits v where v.visited_on>=w.start and v.visited_on<w.start+7),
 'activePeople',(select count(distinct actor_email) from private.stockflow_command_results c where c.completed_at>=w.start::timestamp at time zone 'Asia/Kolkata' and c.completed_at<(w.start+7)::timestamp at time zone 'Asia/Kolkata')
 ) order by w.start desc) from weeks w),
 'people',coalesce((select jsonb_agg(jsonb_build_object('email',email,'roles',roles,'actionsThisWeek',actions,'ordersThisWeek',orders,'visitsThisWeek',visits,'lastActionAt',last_action) order by actions desc,email) from people),'[]'::jsonb),
 'membersByRole',(select jsonb_object_agg(role,(select count(*) from members m where role=any(m.roles))) from unnest(array['sales','operations','warehouse','accounts','billing','management','administrator','viewer']) role),
 'generatedAt',p_now)
$$;
revoke all on function private.stockflow_go_live_read(timestamptz) from public,anon,authenticated,service_role;

alter function public.stockflow_economics_gateway(text,text,text,jsonb)
 rename to stockflow_economics_gateway_before_go_live;
create function public.stockflow_economics_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private,extensions set statement_timeout='20s' as $$
declare v_hash text; v_roles text[];
begin
 if p_action='get_go_live' then
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_hash then
   raise exception 'Unauthorized gateway' using errcode='42501';
  end if;
  v_roles:=private.stockflow_active_member_roles(lower(btrim(coalesce(p_actor_email,''))));
  if not coalesce(v_roles&&array['administrator','management'],false) then
   raise exception 'Go-live view is restricted' using errcode='42501';
  end if;
  if p_payload is distinct from '{}'::jsonb then
   raise exception 'Invalid go-live request' using errcode='22023';
  end if;
  return private.stockflow_go_live_read();
 end if;
 return public.stockflow_economics_gateway_before_go_live(p_gateway_key,p_actor_email,p_action,p_payload);
end $$;
revoke all on function public.stockflow_economics_gateway_before_go_live(text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.stockflow_economics_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_economics_gateway(text,text,text,jsonb) to service_role;

notify pgrst, 'reload schema';
commit;
