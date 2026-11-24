begin;

-- Anchors captured from pg_get_functiondef in the local replay database.
-- Copy the installed pipelines, including all later costing/pricing patches.
do $copies$
declare f text; anchor text; replacement text; spec record; patch record;
 bounds_anchor text:=$a$select date_trunc('month',p_today)::date window_end,
  (date_trunc('month',p_today)-interval '12 months')::date window_start,
  (date_trunc('month',p_today)-interval '6 months')::date h2_start$a$;
begin
 for spec in select * from (values
  ('stockflow_growth_costed_lines','date','p_today date','p_from date, p_end date',false),
  ('stockflow_growth_margin_model','date','p_today date','p_from date, p_end date',false),
  ('stockflow_growth_margin_read','date,jsonb','p_today date, p_payload jsonb','p_from date, p_end date, p_payload jsonb',false),
  ('stockflow_growth_margin_detail','date,jsonb','p_today date, p_payload jsonb','p_from date, p_end date, p_today date, p_payload jsonb',true),
  ('stockflow_growth_billed_below','date,jsonb','p_today date, p_payload jsonb','p_from date, p_end date, p_today date, p_payload jsonb',true),
  ('stockflow_growth_brands_read','date','p_today date','p_cmp_from date, p_cmp_end date, p_from date, p_end date',false),
  ('stockflow_growth_gp','date','p_today date','p_from date, p_end date',false)
 ) s(name,args,old_args,new_args,keeps_today) loop
  f:=replace(pg_get_functiondef(('private.'||spec.name||'('||spec.args||')')::regprocedure),chr(13),'');
  anchor:='CREATE OR REPLACE FUNCTION private.'||spec.name||'('||spec.old_args||')';
  replacement:='CREATE OR REPLACE FUNCTION private.'||case when spec.name='stockflow_growth_brands_read'
   then 'stockflow_growth_brands' else spec.name end||'_window('||spec.new_args||')';
  if strpos(f,anchor)=0 then raise exception 'P4a anchor missing: %',anchor;end if;
  f:=replace(f,anchor,replacement);
  if spec.name in ('stockflow_growth_costed_lines','stockflow_growth_gp','stockflow_growth_brands_read') then
   anchor:=bounds_anchor;
   replacement:=case when spec.name='stockflow_growth_brands_read'
    then 'select p_end window_end, p_cmp_from window_start, p_from h2_start'
    else 'select p_end window_end, p_from window_start, p_from h2_start' end;
   if strpos(f,anchor)=0 then raise exception 'P4a anchor missing: %',anchor;end if;
   f:=replace(f,anchor,replacement);
  end if;
  if spec.name in ('stockflow_growth_margin_model','stockflow_growth_gp') then
   anchor:='private.stockflow_growth_costed_lines(p_today)';
   replacement:='private.stockflow_growth_costed_lines_window(p_from,p_end)';
   if strpos(f,anchor)=0 then raise exception 'P4a anchor missing: %',anchor;end if;
   f:=replace(f,anchor,replacement);
  end if;
  if spec.name in ('stockflow_growth_margin_read','stockflow_growth_margin_detail') then
   anchor:='private.stockflow_growth_margin_model(p_today)';
   replacement:='private.stockflow_growth_margin_model_window(p_from,p_end)';
   if strpos(f,anchor)=0 then raise exception 'P4a anchor missing: %',anchor;end if;
   f:=replace(f,anchor,replacement);
   if strpos(f,anchor)>0 then raise exception 'P4a old margin model remains';end if;
  end if;
  if spec.name='stockflow_growth_margin_read' then
   anchor:='p_today is null'; replacement:='p_from is null or p_end is null';
   if strpos(f,anchor)=0 then raise exception 'P4a anchor missing: %',anchor;end if;
   f:=replace(f,anchor,replacement);
  end if;
  if spec.name='stockflow_growth_billed_below' then
   -- p_today remains only for the original null check. Price validity uses
   -- the sale's business_date, not today, in the installed definition.
   anchor:=$a$select date_trunc('month',p_today)::date window_end,
   (date_trunc('month',p_today)-interval '12 months')::date window_start$a$;
   replacement:='select p_end window_end, p_from window_start';
   if strpos(f,anchor)=0 then raise exception 'P4a anchor missing: %',anchor;end if;
   f:=replace(f,anchor,replacement);
  end if;
  if spec.name='stockflow_growth_brands_read' then
   for patch in select * from (values
    ('costed as materialized (select * from private.stockflow_growth_costed_lines(p_today))',
     'costed as materialized (select * from private.stockflow_growth_costed_lines_window(p_cmp_from,p_end) where business_date<p_cmp_end or business_date>=p_from)'),
    ('  round(coalesce(sum(c.net),0)) sales,',
     '  round(coalesce(sum(c.net) filter(where c.business_date>=b.h2_start),0)) sales,'),
    ('  round(coalesce(sum(c.net) filter(where c.instrument),0)) instrument_sales,',
     '  round(coalesce(sum(c.net) filter(where c.instrument and c.business_date>=b.h2_start),0)) instrument_sales,'),
    ('  round(coalesce(sum(c.net) filter(where not c.instrument and c.cost is not null),0)) known,',
     '  round(coalesce(sum(c.net) filter(where not c.instrument and c.cost is not null and c.business_date>=b.h2_start),0)) known,'),
    ('  round(coalesce(sum(c.cost) filter(where not c.instrument),0)) cost',
     '  round(coalesce(sum(c.cost) filter(where not c.instrument and c.business_date>=b.h2_start),0)) cost'),
    ('t.sales-t.h1 h2','t.sales h2'),
    ($a$'window',(select jsonb_build_object('from',window_start,'to',window_end,'h2From',h2_start) from bounds)$a$,
     $a$'window',jsonb_build_object('from',p_from,'to',p_end,'h2From',p_from),'comparisonWindow',jsonb_build_object('from',p_cmp_from,'to',p_cmp_end)$a$),
    (' LANGUAGE sql',' LANGUAGE plpgsql'),
    ($a$AS $function$
with bounds as ($a$,$a$AS $function$
begin
 if p_cmp_end>p_from then raise exception 'Invalid growth brands windows' using errcode='22023';end if;
 return (with bounds as ($a$),
    ($a$  where r.level='row'))
$function$$a$,$a$  where r.level='row')));
end
$function$$a$)
   ) x(old_text,new_text) loop
    anchor:=patch.old_text; replacement:=patch.new_text;
    if strpos(f,anchor)=0 then raise exception 'P4a anchor missing: %',anchor;end if;
    f:=replace(f,anchor,replacement);
   end loop;
  end if;
  if spec.name='stockflow_growth_gp' then
   anchor:=$a$generate_series(window_start,window_end-interval '1 month',interval '1 month')$a$;
   replacement:=$a$generate_series(window_start,date_trunc('month',window_end-1),interval '1 month')$a$;
   if strpos(f,anchor)=0 then raise exception 'P4a anchor missing: %',anchor;end if;
   f:=replace(f,anchor,replacement);
  end if;
  if not spec.keeps_today and strpos(f,'p_today')>0 then raise exception 'P4a p_today remains: %',spec.name;end if;
  execute f;
 end loop;
end$copies$;

revoke all on function private.stockflow_growth_costed_lines_window(date,date) from public,anon,authenticated,service_role;
revoke all on function private.stockflow_growth_margin_model_window(date,date) from public,anon,authenticated,service_role;
revoke all on function private.stockflow_growth_margin_read_window(date,date,jsonb) from public,anon,authenticated,service_role;
revoke all on function private.stockflow_growth_margin_detail_window(date,date,date,jsonb) from public,anon,authenticated,service_role;
revoke all on function private.stockflow_growth_billed_below_window(date,date,date,jsonb) from public,anon,authenticated,service_role;
revoke all on function private.stockflow_growth_brands_window(date,date,date,date) from public,anon,authenticated,service_role;
revoke all on function private.stockflow_growth_gp_window(date,date) from public,anon,authenticated,service_role;

alter function public.stockflow_growth_gateway(text,text,text,jsonb) rename to stockflow_growth_gateway_before_period_profit;
create function public.stockflow_growth_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=pg_catalog,private,public,extensions
set statement_timeout to '20s' as $$
declare hash text; roles text[]; p jsonb; fy numeric; quarter numeric;
 today date:=(now() at time zone 'Asia/Kolkata')::date;
 window_from date; window_end date; c jsonb; companies text[]; result jsonb; rest jsonb; read_name text;
begin
 if p_action in ('get_growth_margin_period','get_growth_brands_period') then
  select secret_sha256 into hash from private.stockflow_gateway_config where name='orders';
  if hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>hash then
   raise exception 'Unauthorized gateway' using errcode='42501';end if;
  begin roles:=private.stockflow_active_member_roles(lower(btrim(p_actor_email)));
  exception when sqlstate '42501' then raise exception 'Growth access required' using errcode='PT403';end;
  if not coalesce(roles&&array['administrator','management'],false) then
   raise exception 'Growth access required' using errcode='PT403';end if;
  if jsonb_typeof(p_payload) is distinct from 'object'
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
  p:=private.stockflow_growth_period(today,p->>'kind',fy::int,quarter::int);
  window_from:=(p->>'from')::date; window_end:=(p->>'to')::date+1;
  if p_action='get_growth_margin_period' then
   read_name:=p_payload->>'read'; rest:=p_payload-'period'-'read';
   if jsonb_typeof(p_payload->'read') is distinct from 'string'
    or coalesce(read_name,'') not in ('margin','detail','billed_below','gp')
    or (read_name='gp' and rest is distinct from '{}'::jsonb) then
    raise exception 'Invalid growth margin request' using errcode='22023';end if;
   case read_name
   when 'margin' then result:=private.stockflow_growth_margin_read_window(window_from,window_end,rest);
   when 'detail' then result:=private.stockflow_growth_margin_detail_window(window_from,window_end,today,rest);
   when 'billed_below' then result:=private.stockflow_growth_billed_below_window(window_from,window_end,today,rest);
   when 'gp' then result:=private.stockflow_growth_gp_window(window_from,window_end);
   end case;
  else
   if p_payload-array['period','comparison'] is distinct from '{}'::jsonb
    or jsonb_typeof(p_payload->'comparison') is distinct from 'string'
    or coalesce(p_payload->>'comparison','') not in ('last_year','previous')
    or (p_payload->>'comparison'='previous' and p->>'kind'<>'quarter') then
    raise exception 'Invalid growth brands request' using errcode='22023';end if;
   select value into c from jsonb_array_elements(p->'comparisons') where value->>'key'=p_payload->>'comparison';
   result:=private.stockflow_growth_brands_window((c->>'from')::date,(c->>'to')::date+1,window_from,window_end);
   -- Match period_read's company scope: latest, uncancelled economic vouchers
   -- carrying sales/returns/credits in any current or comparison window.
   with windows as (
    select window_from s,window_end-1 e
    union all select (value->>'from')::date,(value->>'to')::date from jsonb_array_elements(p->'comparisons')
   )
   select coalesce(array_agg(distinct v.company_id order by v.company_id),'{}'::text[]) into companies
   from private.stockflow_economic_source_vouchers v
   where not v.cancelled and v.kind in ('sale','return','credit')
    and exists(select 1 from windows w where v.business_date between w.s and w.e)
    and exists(select 1 from private.stockflow_economic_source_lines l where l.voucher_id=v.id)
    and not exists(select 1 from private.stockflow_economic_source_vouchers n
     where n.company_id=v.company_id and n.source_id=v.source_id and n.source_revision>v.source_revision);
   result:=result||jsonb_build_object('comparison',jsonb_build_object('key',c->>'key','label',c->>'label',
    'state',private.stockflow_growth_window_check(companies,(c->>'from')::date,(c->>'to')::date)->>'state'));
  end if;
  return private.stockflow_growth_integer_paise(result||jsonb_build_object('period',p-'comparisons'));
 end if;
 return public.stockflow_growth_gateway_before_period_profit(p_gateway_key,p_actor_email,p_action,p_payload);
end$$;

revoke all on function public.stockflow_growth_gateway_before_period_profit(text,text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.stockflow_growth_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_growth_gateway(text,text,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
