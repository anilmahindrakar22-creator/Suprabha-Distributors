begin;

-- Keep quarter-start snapshots, including the existing October production snapshot.
delete from private.stockflow_lab_tier_snapshots where month <> date_trunc('quarter', month)::date;

create or replace function private.stockflow_refresh_lab_tiers(p_today date) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog,private,public,extensions as $$
declare
 q date:=date_trunc('quarter',p_today)::date;
 prev date:=(q-interval '3 months')::date;
 labs bigint; recomputed boolean:=false; seeded boolean:=false;
begin
 perform pg_advisory_xact_lock(hashtext('stockflow-lab-tiers-refresh'));
 if not exists(select 1 from private.stockflow_lab_tier_snapshots where month=q)
  or p_today<q+7 then
  delete from private.stockflow_lab_tier_snapshots where month=q;
  insert into private.stockflow_lab_tier_snapshots
  select q,t.*,now() from private.stockflow_compute_lab_tiers(q) t;
  recomputed:=true;
 end if;
 if not exists(select 1 from private.stockflow_lab_tier_snapshots where month=prev) then
  insert into private.stockflow_lab_tier_snapshots
  select prev,t.*,now() from private.stockflow_compute_lab_tiers(prev) t;
  seeded:=true;
 end if;
 delete from private.stockflow_lab_tier_snapshots where month<q-interval '24 months';
 select count(*) into labs from private.stockflow_lab_tier_snapshots where month=q;
 return jsonb_build_object('quarter',q,'labs',labs,'recomputed',recomputed,'previousQuarterSeeded',seeded);
end$$;

create or replace function private.stockflow_growth_lab_tiers_read(p_today date,p_payload jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,private,public,extensions as $$
declare m date:=date_trunc('quarter',p_today)::date; stale boolean; result jsonb;
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
  left join private.stockflow_lab_tier_snapshots p on p.month=(m-interval '3 months')::date
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

revoke all on function private.stockflow_refresh_lab_tiers(date) from public,anon,authenticated,service_role;
revoke all on function private.stockflow_growth_lab_tiers_read(date,jsonb) from public,anon,authenticated,service_role;
commit;
