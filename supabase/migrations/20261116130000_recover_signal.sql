begin;

-- As with wallet policy, the greatest version is the single active policy.
-- Advancing policy appends a row; history can neither be updated nor deleted.
create table private.stockflow_recover_policies (
 version integer primary key check(version>0),
 baseline_months integer not null check(baseline_months between 1 and 24),
 recent_months integer not null check(recent_months between 1 and 24),
 min_baseline_paise bigint not null check(min_baseline_paise between 1 and 9000000000000000),
 min_drop_bps integer not null check(min_drop_bps between 1 and 10000),
 min_drop_paise bigint not null check(min_drop_paise between 1 and 9000000000000000),
 note text not null check(length(btrim(note)) between 3 and 500), entered_by text not null,
 entered_at timestamptz not null default clock_timestamp()
);
insert into private.stockflow_recover_policies values
 (1,6,3,2000000,3000,1000000,'Initial Recover policy','seed',clock_timestamp());
alter table private.stockflow_recover_policies enable row level security;
revoke all on private.stockflow_recover_policies from public,anon,authenticated,service_role;
create trigger stockflow_recover_policies_no_delete before delete on private.stockflow_recover_policies
 for each row execute function private.prevent_business_delete();
create trigger stockflow_recover_policies_immutable before update on private.stockflow_recover_policies
 for each row execute function private.prevent_immutable_pricing_update();

create function private.stockflow_recover_policy_read() returns jsonb
language sql stable set search_path=pg_catalog,private as $$
 select jsonb_build_object('version',version,'policyVersion','recover-v'||version,
  'baselineMonths',baseline_months,'recentMonths',recent_months,'minBaselinePaise',min_baseline_paise,
  'minDropBps',min_drop_bps,'minDropPaise',min_drop_paise,'note',note,'enteredBy',entered_by,'enteredAt',entered_at)
 from private.stockflow_recover_policies order by version desc limit 1;
$$;

create function private.stockflow_recover_read(p_today date) returns jsonb
language plpgsql stable set search_path=pg_catalog,private as $$
declare
 policy jsonb:=private.stockflow_recover_policy_read();
 baseline_months integer:=(policy->>'baselineMonths')::integer;
 recent_months integer:=(policy->>'recentMonths')::integer;
 window_end date:=date_trunc('month',p_today)::date;
 recent_start date:=(window_end-make_interval(months=>recent_months))::date;
 window_start date:=(recent_start-make_interval(months=>baseline_months))::date;
 result jsonb;
begin
 if p_today is null then raise exception 'Recover date required' using errcode='22023';end if;
 with months as materialized (
  select (window_start+n*interval '1 month')::date month_start
  from generate_series(0,baseline_months+recent_months-1) n
 ), companies as (
  select distinct company_id from private.stockflow_economic_customer_identities
 ), company_months as materialized (
  -- Evaluate both sources once per company/month, regardless of its lab count.
  select c.company_id,m.month_start,
   private.stockflow_sales_coverage_status(c.company_id,m.month_start,(m.month_start+interval '1 month')::date-1) coverage,
   private.stockflow_sales_reconciliation(c.company_id,m.month_start) reconciliation
  from companies c cross join months m
 ), certified_companies as materialized (
  select company_id,bool_and((coverage->>'complete')::boolean is true
   and reconciliation->>'state' is not distinct from 'matches') certified
  from company_months group by company_id
 ), labs as (
  select i.customer_id,bool_and(c.certified) certified
  from private.stockflow_economic_customer_identities i
  join certified_companies c on c.company_id=i.company_id group by i.customer_id
 ), latest as (
  -- Wallet definition: select revisions before applying dates/kind/cancellation.
  select distinct on(v.company_id,v.source_id) v.* from private.stockflow_economic_source_vouchers v
  order by v.company_id,v.source_id,v.source_revision desc
 ), monthly_sales as (
  select i.customer_id,date_trunc('month',v.business_date)::date month_start,sum(l.net_sales_paise::numeric) net
  from latest v join private.stockflow_economic_source_lines l on l.voucher_id=v.id
  join private.stockflow_economic_customer_identities i on i.company_id=v.company_id and i.source_id=v.customer_source_id
  where not v.cancelled and v.kind in ('sale','return','credit')
   and v.business_date>=window_start and v.business_date<window_end
  group by i.customer_id,date_trunc('month',v.business_date)::date
 ), monthly_labs as (
  -- The grid is essential: missing months, including ALL recent months, are zero.
  select c.customer_id,c.certified,m.month_start,coalesce(s.net,0) net
  from labs c cross join months m
  left join monthly_sales s on s.customer_id=c.customer_id and s.month_start=m.month_start
 ), samples as (
  select customer_id,array_agg(net order by net) filter(where month_start<recent_start) baseline,
   avg(net) filter(where month_start>=recent_start) recent
  from monthly_labs where certified group by customer_id
 ), figures as (
  -- Exact numeric median (including the even-sized pair), without float paise.
  select customer_id,(baseline[(baseline_months+1)/2]+baseline[(baseline_months+2)/2])/2 baseline,recent
  from samples
 ), signals as (
  select f.*,f.baseline-f.recent drop_paise,c.name from figures f
  join private.stockflow_customers c on c.id=f.customer_id
  where f.baseline>=(policy->>'minBaselinePaise')::numeric
   and f.baseline-f.recent>=(policy->>'minDropPaise')::numeric
   and (f.baseline-f.recent)*10000>=(policy->>'minDropBps')::numeric*f.baseline
   and not exists(select 1 from private.stockflow_commercial_opportunities o
    where o.customer_id=f.customer_id and o.kind in ('defend','recover')
     and not exists(select 1 from private.stockflow_commercial_opportunity_closures cl where cl.opportunity_id=o.id))
 ), certification as (
  select coalesce(bool_or(certified),false) certified from certified_companies
 )
 select jsonb_build_object('policyVersion',policy->>'policyVersion',
  'months',jsonb_build_object('from',window_start,'to',window_end-1),'certified',certified,
  'reason',case when not certified then 'Recover signals need 9 certified months' end,
  'rows',coalesce((select jsonb_agg(jsonb_build_object('customerId',customer_id,'name',name,
   'baselinePaise',round(baseline),'recentPaise',round(recent),'dropPaise',round(drop_paise))
   order by round(drop_paise) desc,customer_id) from signals),'[]'::jsonb)) into result from certification;
 return result;
end$$;
revoke all on function private.stockflow_recover_policy_read(),private.stockflow_recover_read(date)
 from public,anon,authenticated,service_role;

-- ADR-0008 amendment: a person may open a current Recover suggestion with
-- origin defend_signal. Its opening reason records the generating policy version.
alter table private.stockflow_commercial_opportunities drop constraint stockflow_commercial_opportunities_origin_rule;
alter table private.stockflow_commercial_opportunities add constraint stockflow_commercial_opportunities_origin_rule
 check(origin in ('manual','wallet_gap','defend_signal'));

-- Replayed live definition: the wallet split owns open_opportunity here.
do $patch$
declare definition text; anchor text;
begin
 definition:=replace(pg_get_functiondef('public.stockflow_opportunity_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'');
 anchor:=$a$not in ('manual','wallet_gap')$a$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'Expected one origin whitelist anchor';end if;
 definition:=replace(definition,anchor,$r$not in ('manual','wallet_gap','defend_signal')$r$);
 anchor:=$a$ v_now_account jsonb; v_outcome_rows jsonb;$a$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'Expected one opportunity declaration anchor';end if;
 definition:=replace(definition,anchor,anchor||E'\n v_recover jsonb; v_recover_reason text;');
 anchor:=$a$   then raise exception 'Not a current Focus account' using errcode='22023';end if;
  end if;$a$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'Expected one wallet_gap branch anchor';end if;
 definition:=replace(definition,anchor,anchor||$r$
  if v_origin='defend_signal' then
   v_recover:=private.stockflow_recover_read(today);
   if p_payload->>'kind' is distinct from 'recover' or v_recover->>'certified' is distinct from 'true'
    or not exists(select 1 from jsonb_array_elements(v_recover->'rows') r where r->>'customerId'=customer::text)
   then raise exception 'Not a current Recover signal' using errcode='22023';end if;
   -- Keep the full submitted reason in the existing audit; reserve suffix space.
   v_recover_reason:=left(btrim(p_payload->>'reason'),500-length(' [policyVersion='||(v_recover->>'policyVersion')||']'))
    ||' [policyVersion='||(v_recover->>'policyVersion')||']';
  end if;$r$);
 anchor:=$a$values(customer,v_division,v_origin,p_payload->>'kind',btrim(p_payload->>'reason'),actor)$a$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'Expected one opening reason insert anchor';end if;
 definition:=replace(definition,anchor,$r$values(customer,v_division,v_origin,p_payload->>'kind',coalesce(v_recover_reason,btrim(p_payload->>'reason')),actor)$r$);
 anchor:=$a$'openedReason',btrim(p_payload->>'reason'),'openedBy',actor$a$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'Expected one opening reason result anchor';end if;
 definition:=replace(definition,anchor,$r$'openedReason',coalesce(v_recover_reason,btrim(p_payload->>'reason')),'openedBy',actor$r$);
 if strpos(definition,$a$not in ('manual','wallet_gap')$a$)>0 or strpos(definition,$a$'defend_signal'$a$)=0
  then raise exception 'Recover origin whitelist patch incomplete';end if;
 execute definition;
end$patch$;

do $patch$
declare definition text; anchor text;
begin
 definition:=replace(pg_get_functiondef('public.stockflow_today_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'');
 anchor:=$a$ v_wallet jsonb;$a$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'Expected one Today declaration anchor';end if;
 definition:=replace(definition,anchor,anchor||E'\n v_recover jsonb;');
 anchor:=$a$ v_wallet:=private.stockflow_wallet_read(v_today);$a$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'Expected one Today Grow read anchor';end if;
 -- This path is after the existing administrator/management admission check.
 definition:=replace(definition,anchor,anchor||E'\n v_recover:=private.stockflow_recover_read(v_today);');
 anchor:=$a$ ), lanes as ($a$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'Expected one Grow end anchor';end if;
 definition:=replace(definition,anchor,$r$  union all
  select 'recover:'||(r->>'customerId'),(r->>'dropPaise')::numeric,null::timestamptz,
   jsonb_build_object('type','recover','title',r->>'name','subtitle',null,
    'baselinePaisePerMonth',(r->>'baselinePaise')::numeric,'recentPaisePerMonth',(r->>'recentPaise')::numeric,
    'valuePaisePerMonth',(r->>'dropPaise')::numeric,'valueKind','lost','due',null,
    'target',jsonb_build_object('kind','lab','customerId',r->>'customerId'))
  from jsonb_array_elements(v_recover->'rows') r where v_recover->>'certified'='true'
 ), lanes as ($r$);
 anchor:=$a$select jsonb_build_object('policyVersion','today-v1','generatedAt',now(),$a$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'Expected one Today envelope anchor';end if;
 definition:=replace(definition,anchor,anchor||E'\n  ''recover'',jsonb_build_object(''certified'',v_recover->''certified'',''reason'',v_recover->''reason''),');
 anchor:=$a$'recover:'$a$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'Expected exactly one Recover Grow branch';end if;
 execute definition;
end$patch$;
commit;
notify pgrst,'reload schema';
