begin;

create function private.stockflow_growth_period(p_today date,p_kind text,p_fy integer,p_quarter integer) returns jsonb
language plpgsql immutable security definer
set search_path=pg_catalog,private,public,extensions as $$
declare cur_fy integer; s date; e date; t date; cs date; ce date; cf integer; cq integer;
 label text; cmp_label text; comparisons jsonb:='[]'; k text; running boolean;
begin
 cur_fy:=extract(year from p_today)::int-case when extract(month from p_today)<4 then 1 else 0 end;
 if p_today is null or p_kind is null or p_kind not in ('fy','quarter') or p_fy is null
  or p_fy not between 2017 and cur_fy
  or (p_kind='fy' and p_quarter is not null)
  or (p_kind='quarter' and (p_quarter is null or p_quarter not between 1 and 4)) then
  raise exception 'Invalid growth period' using errcode='22023';end if;
 s:=(make_date(p_fy,4,1)+make_interval(months=>case when p_kind='quarter' then (p_quarter-1)*3 else 0 end))::date;
 e:=(s+case when p_kind='fy' then interval '1 year' else interval '3 months' end)::date-1;
 if s>p_today then raise exception 'Invalid growth period' using errcode='22023';end if;
 t:=least(e,p_today); running:=t<e;
 label:=case when p_kind='quarter' then 'Q'||p_quarter||' ' else '' end||'FY '||p_fy||'-'||lpad(((p_fy+1)%100)::text,2,'0');
 if running then label:=label||' to '||extract(day from t)::int||' '||
  (array['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])[extract(month from t)::int];end if;
 foreach k in array case when p_kind='quarter' then array['last_year','previous'] else array['last_year'] end loop
  cf:=case when k='last_year' or p_quarter=1 then p_fy-1 else p_fy end;
  cq:=case when k='last_year' then p_quarter when p_quarter=1 then 4 else p_quarter-1 end;
  cs:=(make_date(cf,4,1)+make_interval(months=>case when p_kind='quarter' then (cq-1)*3 else 0 end))::date;
  ce:=(cs+case when p_kind='fy' then interval '1 year' else interval '3 months' end)::date-1;
  cmp_label:=case when p_kind='quarter' then 'Q'||cq||' ' else '' end||'FY '||cf||'-'||lpad(((cf+1)%100)::text,2,'0');
  comparisons:=comparisons||jsonb_build_array(jsonb_build_object('key',k,'label',cmp_label||case when running then ' (same days)' else '' end,
   'from',cs,'to',least(cs+(t-s),ce)));
 end loop;
 return jsonb_build_object('kind',p_kind,'fy',p_fy,'quarter',p_quarter,'label',label,'from',s,'to',t,'running',running,'comparisons',comparisons);
end$$;

create function private.stockflow_growth_window_check(p_companies text[],p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,private,public,extensions as $$
declare months jsonb; coverage boolean; first_sale date; days integer:=p_to-p_from+1; history_days integer; share numeric; state text;
begin
 select coalesce(jsonb_agg(jsonb_build_object('month',to_char(m,'YYYY-MM'),'state',s) order by m),'[]') into months
 from (select m,case
  when bool_or(coalesce(r->>'state','') not in ('matches','no_control')) then 'differs'
  when bool_or(r->>'state'='no_control') then 'no_control' else 'matches' end s
  from generate_series(date_trunc('month',p_from)::timestamp,date_trunc('month',p_to)::timestamp,interval '1 month') m
  left join lateral (select private.stockflow_sales_reconciliation(c,m::date) r from unnest(p_companies) c) x on true
  group by m) t;
 select coalesce(bool_and(coalesce((private.stockflow_sales_coverage_status(c,p_from,p_to)->>'complete')::boolean,false)),false)
 into coverage from unnest(p_companies) c;
 select min(v.business_date) into first_sale from private.stockflow_economic_source_vouchers v
 where v.company_id=any(p_companies) and v.kind='sale' and not v.cancelled and v.business_date<=p_to
  and exists(select 1 from private.stockflow_economic_source_lines l where l.voucher_id=v.id)
  and not exists(select 1 from private.stockflow_economic_source_vouchers n
   where n.company_id=v.company_id and n.source_id=v.source_id and n.source_revision>v.source_revision);
 history_days:=case when first_sale is null then 0 else greatest(0,p_to-greatest(p_from,first_sale)+1) end;
 share:=round(100.0*history_days/days,1);
 state:=case when share<95 then 'no_history'
  when exists(select 1 from jsonb_array_elements(months) m where m->>'state'='differs') then 'differs'
  when not coverage or exists(select 1 from jsonb_array_elements(months) m where m->>'state'='no_control') then 'unconfirmed'
  else 'confirmed' end;
 return jsonb_build_object('days',days,'historyDays',history_days,'historySharePct',share,'coverageComplete',coverage,'months',months,'state',state);
end$$;

create function private.stockflow_growth_period_read(p_today date,p_roles text[],p_period jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,private,public,extensions as $$
declare p jsonb; model jsonb; companies text[]; w jsonb; b jsonb; chk jsonb; current_window jsonb; comparisons jsonb:='[]';
begin
 if not coalesce(p_roles&&array['administrator','management'],false) then
  raise exception 'Growth access required' using errcode='PT403';end if;
 p:=private.stockflow_growth_period(p_today,p_period->>'kind',(p_period->>'fy')::int,(p_period->>'quarter')::int);
 with windows as materialized (
  select 'current'::text key,p->>'label' label,(p->>'from')::date s,(p->>'to')::date e,0::bigint ordinal
  union all select v->>'key',v->>'label',(v->>'from')::date,(v->>'to')::date,ordinal
  from jsonb_array_elements(p->'comparisons') with ordinality x(v,ordinal)
 ), bounds as (select min(s) lo,max(e) hi from windows), latest as materialized (
  select distinct on(v.company_id,v.source_id) v.id,v.company_id,v.source_id,v.source_revision,
   v.customer_source_id,v.business_date,v.kind,v.cancelled
  from private.stockflow_economic_source_vouchers v cross join bounds
  where v.business_date between lo and hi
   and not exists(select 1 from private.stockflow_economic_source_vouchers n
    where n.company_id=v.company_id and n.source_id=v.source_id and n.source_revision>v.source_revision)
  order by v.company_id,v.source_id,v.source_revision desc
 ), vouchers as materialized (
  select v.id,v.company_id,v.customer_source_id,v.business_date,v.kind,sum(l.net_sales_paise::numeric) net
  from latest v join private.stockflow_economic_source_lines l on l.voucher_id=v.id
  where not v.cancelled and v.kind in ('sale','return','credit') group by v.id,v.company_id,v.customer_source_id,v.business_date,v.kind
 ), tagged as materialized (
  select v.*,w.key,(v.kind='sale' and v.net>=20000000) bulk from vouchers v join windows w on v.business_date between w.s and w.e
 ), buying as (
  select key,company_id,customer_source_id,date_trunc('month',business_date) m from tagged where not bulk
  group by 1,2,3,4 having sum(net)>0
 ), buying_counts as (
  select key,count(*) months,count(distinct (company_id,customer_source_id)) labs from buying group by key
 ), trees as (
  select w.key,jsonb_build_object('revenuePaise',coalesce(sum(t.net),0),'repeatPaise',coalesce(sum(t.net) filter(where not t.bulk),0),
   'bulkPaise',coalesce(sum(t.net) filter(where t.bulk),0),'bulkInvoices',count(t.id) filter(where t.bulk),
   'labsBuying',coalesce(b.labs,0),'buyingMonths',coalesce(b.months,0),
   'perBuyingMonthPaise',round(coalesce(sum(t.net) filter(where not t.bulk),0)/nullif(b.months,0))) tree
  from windows w left join tagged t on t.key=w.key left join buying_counts b on b.key=w.key group by w.key,b.labs,b.months
 ), lab_months as materialized (
  select key,company_id,customer_source_id,date_trunc('month',business_date) m,sum(net) net from tagged group by 1,2,3,4
 ), labs as (
  select w.key,l.company_id,l.customer_source_id,coalesce(sum(l.net) filter(where l.key=w.key),0) h1,
   coalesce(sum(l.net) filter(where l.key='current'),0) h2,count(*) filter(where l.key=w.key and l.net>0) h1_months
  from windows w join lab_months l on l.key in (w.key,'current') where w.key<>'current' group by 1,2,3
 ), classified as materialized (
  select *,case when h1<=0 and h2>0 then 'new' when h1>0 and h2<=0 then 'stopped'
   when h1>0 and h2>h1 then 'grew' when h1>0 and h2>0 and h2<h1 then 'fell'
   when h1>0 and h2=h1 then 'same' else 'other' end class from labs
 ), classes as (
  select w.key,c.class,jsonb_build_object('labs',count(l.class),'paise',coalesce(sum(case when l.class in ('stopped','fell') then h1-h2 else h2-h1 end),0)) contribution
  from windows w cross join unnest(array['new','stopped','grew','fell','same','other']) c(class)
  left join classified l on l.key=w.key and l.class=c.class where w.key<>'current' group by w.key,c.class
 ), bridges as (
  select w.key,jsonb_build_object('h1Paise',coalesce(sum(h1),0),'h2Paise',coalesce(sum(h2),0),
   'stoppedRegular',jsonb_build_object('labs',count(*) filter(where class='stopped' and h1_months>=3),
    'paise',coalesce(sum(h1-h2) filter(where class='stopped' and h1_months>=3),0)))||
   (select jsonb_object_agg(class,contribution) from classes c where c.key=w.key) bridge
  from windows w left join classified l on l.key=w.key where w.key<>'current' group by w.key
 )
 select jsonb_agg(jsonb_build_object('key',w.key,'label',w.label,'from',w.s,'to',w.e,'tree',t.tree)||
  case when w.key='current' then '{}'::jsonb else jsonb_build_object('bridge',b.bridge) end order by w.ordinal),
  coalesce((select array_agg(distinct company_id order by company_id) from tagged),'{}'::text[])
 into model,companies from windows w join trees t on t.key=w.key left join bridges b on b.key=w.key;
 for w in select value from jsonb_array_elements(model) loop
  if w->>'key'<>'current' then
   b:=w->'bridge';
   if (b->>'h1Paise')::numeric+(b#>>'{new,paise}')::numeric-(b#>>'{stopped,paise}')::numeric
    +(b#>>'{grew,paise}')::numeric-(b#>>'{fell,paise}')::numeric+(b#>>'{other,paise}')::numeric
    <> (b->>'h2Paise')::numeric then raise exception 'Growth bridge identity failed';end if;
  end if;
  chk:=private.stockflow_growth_window_check(companies,(w->>'from')::date,(w->>'to')::date);
  w:=w||jsonb_build_object('check',chk);
  if w->>'key'='current' then current_window:=w;
  else
   if chk->>'state'='no_history' then w:=w||jsonb_build_object('tree',null,'bridge',null);end if;
   comparisons:=comparisons||jsonb_build_array(w);
  end if;
 end loop;
 return jsonb_build_object('view','period','period',p-'comparisons','current',current_window,'comparisons',comparisons);
end$$;

alter function public.stockflow_growth_gateway(text,text,text,jsonb) rename to stockflow_growth_gateway_before_period;
create function public.stockflow_growth_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=pg_catalog,private,public,extensions
set statement_timeout='20s' as $$
declare hash text; roles text[]; p jsonb; fy numeric; quarter numeric;
begin
 if p_action='get_growth_period' then
  select secret_sha256 into hash from private.stockflow_gateway_config where name='orders';
  if hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>hash then
   raise exception 'Unauthorized gateway' using errcode='42501';end if;
  begin roles:=private.stockflow_active_member_roles(lower(btrim(p_actor_email)));
  exception when sqlstate '42501' then raise exception 'Growth access required' using errcode='PT403';end;
  if not coalesce(roles&&array['administrator','management'],false) then
   raise exception 'Growth access required' using errcode='PT403';end if;
  if jsonb_typeof(p_payload) is distinct from 'object' or p_payload-'period' is distinct from '{}'::jsonb
   or jsonb_typeof(p_payload->'period') is distinct from 'object' then
   raise exception 'Invalid growth period' using errcode='22023';end if;
  p:=p_payload->'period';
  if jsonb_typeof(p->'kind') is distinct from 'string' or coalesce(p->>'kind','') not in ('fy','quarter')
   or jsonb_typeof(p->'fy') is distinct from 'number'
   or (p->>'kind'='fy' and p-array['kind','fy'] is distinct from '{}'::jsonb)
   or (p->>'kind'='quarter' and (p-array['kind','fy','quarter'] is distinct from '{}'::jsonb
    or jsonb_typeof(p->'quarter') is distinct from 'number')) then
   raise exception 'Invalid growth period' using errcode='22023';end if;
  fy:=(p->>'fy')::numeric; quarter:=(p->>'quarter')::numeric;
  if fy<>trunc(fy) or fy not between 2017 and 2147483646
   or (p->>'kind'='quarter' and (quarter<>trunc(quarter) or quarter not between 1 and 4)) then
   raise exception 'Invalid growth period' using errcode='22023';end if;
  p:=jsonb_set(p,'{fy}',to_jsonb(fy::int));
  if p->>'kind'='quarter' then p:=jsonb_set(p,'{quarter}',to_jsonb(quarter::int));end if;
  return private.stockflow_growth_integer_paise(private.stockflow_growth_period_read((now() at time zone 'Asia/Kolkata')::date,roles,p));
 end if;
 return public.stockflow_growth_gateway_before_period(p_gateway_key,p_actor_email,p_action,p_payload);
end$$;

revoke all on function private.stockflow_growth_period(date,text,integer,integer) from public,anon,authenticated,service_role;
revoke all on function private.stockflow_growth_window_check(text[],date,date) from public,anon,authenticated,service_role;
revoke all on function private.stockflow_growth_period_read(date,text[],jsonb) from public,anon,authenticated,service_role;
revoke all on function public.stockflow_growth_gateway_before_period(text,text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.stockflow_growth_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_growth_gateway(text,text,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
