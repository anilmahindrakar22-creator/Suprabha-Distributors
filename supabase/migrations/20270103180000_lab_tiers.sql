begin;

create table private.stockflow_lab_tier_policies (
 id bigint generated always as identity primary key, effective_from date not null,
 diamond_paise bigint not null, platinum_paise bigint not null, gold_paise bigint not null, silver_paise bigint not null,
 check (diamond_paise > platinum_paise and platinum_paise > gold_paise and gold_paise > silver_paise and silver_paise > 0),
 created_by text not null, reason text not null, created_at timestamptz not null default now()
);
create trigger stockflow_lab_tier_policies_append_only before update or delete
 on private.stockflow_lab_tier_policies for each row
 execute function private.stockflow_economic_exception_ack_append_only();
insert into private.stockflow_lab_tier_policies(effective_from,diamond_paise,platinum_paise,gold_paise,silver_paise,created_by,reason)
values('2026-01-01',100000000,30000000,10000000,2500000,'owner-form@stockflow.local','Owner form 26 Nov 2026: Diamond > Platinum > Gold > Silver on 12-month consumables (Rs 10 L / 3 L / 1 L / 25k)');

create table private.stockflow_lab_tier_snapshots (
 month date not null, company_id text not null, customer_source_id text not null,
 tier text not null check (tier in ('diamond','platinum','gold','silver','untiered')),
 consumables_paise numeric not null, has_instrument boolean not null, computed_at timestamptz not null,
 primary key (month, company_id, customer_source_id)
);
revoke all on private.stockflow_lab_tier_policies,private.stockflow_lab_tier_snapshots from public,anon,authenticated,service_role;

create function private.stockflow_compute_lab_tiers(p_month date)
returns table(company_id text,customer_source_id text,tier text,consumables_paise numeric,has_instrument boolean)
language sql stable security definer set search_path=pg_catalog,private,public,extensions as $$
with policy as (
 select * from private.stockflow_lab_tier_policies where effective_from<=p_month
 order by effective_from desc,id desc limit 1
), latest as materialized (
 select distinct on(v.company_id,v.source_id) v.*
 from private.stockflow_economic_source_vouchers v where v.business_date<p_month
 and not exists(select 1 from private.stockflow_economic_source_vouchers n
  where n.company_id=v.company_id and n.source_id=v.source_id and n.source_revision>v.source_revision)
 order by v.company_id,v.source_id,v.source_revision desc
), kinds as materialized (
 select * from private.stockflow_growth_item_kinds()
), lines as materialized (
 select v.company_id,v.customer_source_id,v.business_date,v.kind,l.net_sales_paise,
  coalesce(k.kind,'consumable') item_kind
 from latest v join private.stockflow_economic_source_lines l on l.voucher_id=v.id
 left join kinds k on k.company_id=v.company_id and k.product_id=l.product_id
 where not v.cancelled and v.kind in ('sale','return','credit') and v.customer_source_id is not null
), labs as (
 select l.company_id,l.customer_source_id,
  sum(case when l.kind='sale' then l.net_sales_paise::numeric else -abs(l.net_sales_paise::numeric) end) consumables_paise
 from lines l where l.item_kind='consumable' and l.business_date>=p_month-interval '12 months'
 group by l.company_id,l.customer_source_id
 having sum(case when l.kind='sale' then l.net_sales_paise::numeric else -abs(l.net_sales_paise::numeric) end)>0
)
select l.company_id,l.customer_source_id,
 case when l.consumables_paise>=p.diamond_paise then 'diamond'
  when l.consumables_paise>=p.platinum_paise then 'platinum'
  when l.consumables_paise>=p.gold_paise then 'gold'
  when l.consumables_paise>=p.silver_paise then 'silver' else 'untiered' end,
 l.consumables_paise,
 exists(select 1 from lines s where s.company_id=l.company_id and s.customer_source_id=l.customer_source_id
  and s.kind='sale' and s.item_kind='instrument' and s.net_sales_paise>0)
 or exists(select 1 from private.stockflow_equipment_installations e
  join private.stockflow_economic_customer_identities i on i.customer_id=e.customer_id
  where e.status='completed' and i.company_id=l.company_id and i.source_id=l.customer_source_id)
from labs l cross join policy p
$$;

create function private.stockflow_refresh_lab_tiers(p_today date) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog,private,public,extensions as $$
declare m date:=date_trunc('month',p_today)::date; labs bigint; seeded boolean:=false;
begin
 perform pg_advisory_xact_lock(hashtext('stockflow-lab-tiers-refresh'));
 delete from private.stockflow_lab_tier_snapshots where month=m;
 insert into private.stockflow_lab_tier_snapshots
 select m,t.*,now() from private.stockflow_compute_lab_tiers(m) t;
 get diagnostics labs=row_count;
 if not exists(select 1 from private.stockflow_lab_tier_snapshots where month=(m-interval '1 month')::date) then
  insert into private.stockflow_lab_tier_snapshots
  select (m-interval '1 month')::date,t.*,now()
  from private.stockflow_compute_lab_tiers((m-interval '1 month')::date) t;
  seeded:=true;
 end if;
 delete from private.stockflow_lab_tier_snapshots where month<m-interval '24 months';
 return jsonb_build_object('month',m,'labs',labs,'previousMonthSeeded',seeded);
end$$;

create function private.stockflow_growth_lab_tiers_read(p_today date,p_payload jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,private,public,extensions as $$
declare m date:=date_trunc('month',p_today)::date; stale boolean; result jsonb;
begin
 if not coalesce(p_payload='{}'::jsonb or p_payload in (
  '{"tier":"diamond"}'::jsonb,'{"tier":"platinum"}'::jsonb,'{"tier":"gold"}'::jsonb,
  '{"tier":"silver"}'::jsonb,'{"tier":"untiered"}'::jsonb,
  '{"list":"movers"}'::jsonb,'{"list":"placement"}'::jsonb),false) then
  raise exception 'Invalid lab tiers request' using errcode='22023';end if;
 stale:=not exists(select 1 from private.stockflow_lab_tier_snapshots where month=m);
 with ranks(tier,rank) as (values ('diamond',5),('platinum',4),('gold',3),('silver',2),('untiered',1)),
 cur as materialized (
  select company_id,customer_source_id,tier,consumables_paise,has_instrument
  from private.stockflow_lab_tier_snapshots where month=m and not stale
  union all
  select * from private.stockflow_compute_lab_tiers(m) where stale
 ), labs as materialized (
  select c.*,c.company_id||'|'||c.customer_source_id lab_key,p.tier previous_tier,
   case when p.tier is null then 'new' when r.rank>pr.rank then 'up'
    when r.rank<pr.rank then 'down' else 'same' end change
  from cur c join ranks r on r.tier=c.tier
  left join private.stockflow_lab_tier_snapshots p on p.month=(m-interval '1 month')::date
   and p.company_id=c.company_id and p.customer_source_id=c.customer_source_id
  left join ranks pr on pr.tier=p.tier
 ), filtered as materialized (
  select * from labs where tier=p_payload->>'tier'
   or (p_payload->>'list'='movers' and change in ('up','down'))
   or (p_payload->>'list'='placement' and tier in ('gold','platinum') and not has_instrument)
 ), selected as (
  select * from filtered order by case when p_payload->>'list'='movers' and change='up' then 0 else 1 end,
   consumables_paise desc,lab_key collate "C" limit 100
 )
 select case when p_payload='{}'::jsonb then jsonb_build_object(
  'month',m,'stale',stale,
  'bands',(select jsonb_build_object('diamond',diamond_paise,'platinum',platinum_paise,'gold',gold_paise,'silver',silver_paise)
   from private.stockflow_lab_tier_policies where effective_from<=m order by effective_from desc,id desc limit 1),
  'tiers',(select jsonb_agg(jsonb_build_object('tier',r.tier,
   'labs',(select count(*) from labs l where l.tier=r.tier),
   'consumablesPaise',coalesce((select sum(consumables_paise) from labs l where l.tier=r.tier),0),
   'sharePct',coalesce(round(100*(select sum(consumables_paise) from labs l where l.tier=r.tier)
    /nullif((select sum(consumables_paise) from labs),0)),0),
   'withInstrument',(select count(*) from labs l where l.tier=r.tier and l.has_instrument)) order by r.rank desc) from ranks r),
  'movers',jsonb_build_object('up',(select count(*) from labs where change='up'),'down',(select count(*) from labs where change='down')),
  'placement',(select jsonb_build_object('labs',count(*),'consumablesPaise',coalesce(sum(consumables_paise),0))
   from labs where tier in ('gold','platinum') and not has_instrument))
 else jsonb_build_object('list',coalesce(p_payload->>'list',p_payload->>'tier'),
  'totalLabs',(select count(*) from filtered),
  'rows',coalesce((select jsonb_agg(jsonb_build_object('labKey',t.lab_key,'customerId',c.id,
   'name',coalesce(c.name,private.stockflow_growth_ledger_name(t.company_id,t.customer_source_id)),
   'town',c.city,'phone',c.phone,'tier',t.tier,'consumablesPaise',t.consumables_paise,
   'hasInstrument',t.has_instrument,'previousTier',t.previous_tier,'change',t.change)
   order by case when p_payload->>'list'='movers' and t.change='up' then 0 else 1 end,
    t.consumables_paise desc,t.lab_key collate "C") from selected t
   left join private.stockflow_economic_customer_identities i on i.company_id=t.company_id and i.source_id=t.customer_source_id
   left join private.stockflow_customers c on c.id=i.customer_id),'[]'::jsonb)) end into result;
 return private.stockflow_growth_integer_paise(result);
end$$;

do $cron$
begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
  perform cron.unschedule(jobid) from cron.job where jobname='stockflow-lab-tiers-refresh';
  perform cron.schedule('stockflow-lab-tiers-refresh','35 21 * * *',$job$select private.stockflow_refresh_lab_tiers((now() at time zone 'Asia/Kolkata')::date)$job$);
 end if;
end $cron$;

alter function public.stockflow_growth_gateway(text,text,text,jsonb) rename to stockflow_growth_gateway_before_lab_tiers;
create function public.stockflow_growth_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=pg_catalog,private,public,extensions
set statement_timeout to '20s' as $$
declare hash text; roles text[];
begin
 if p_action='get_growth_lab_tiers' then
  select secret_sha256 into hash from private.stockflow_gateway_config where name='orders';
  if hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>hash then
   raise exception 'Unauthorized gateway' using errcode='42501';end if;
  begin roles:=private.stockflow_active_member_roles(lower(btrim(p_actor_email)));
  exception when sqlstate '42501' then raise exception 'Growth access required' using errcode='PT403';end;
  if not coalesce(roles&&array['administrator','management'],false) then
   raise exception 'Growth access required' using errcode='PT403';end if;
  if not coalesce(p_payload='{}'::jsonb or p_payload in (
   '{"tier":"diamond"}'::jsonb,'{"tier":"platinum"}'::jsonb,'{"tier":"gold"}'::jsonb,
   '{"tier":"silver"}'::jsonb,'{"tier":"untiered"}'::jsonb,
   '{"list":"movers"}'::jsonb,'{"list":"placement"}'::jsonb),false) then
   raise exception 'Invalid lab tiers request' using errcode='22023';end if;
  return private.stockflow_growth_lab_tiers_read((now() at time zone 'Asia/Kolkata')::date,p_payload);
 end if;
 return public.stockflow_growth_gateway_before_lab_tiers(p_gateway_key,p_actor_email,p_action,p_payload);
end$$;
revoke all on function private.stockflow_compute_lab_tiers(date) from public,anon,authenticated,service_role;
revoke all on function private.stockflow_refresh_lab_tiers(date) from public,anon,authenticated,service_role;
revoke all on function private.stockflow_growth_lab_tiers_read(date,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.stockflow_growth_gateway_before_lab_tiers(text,text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.stockflow_growth_gateway(text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.stockflow_growth_gateway(text,text,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
