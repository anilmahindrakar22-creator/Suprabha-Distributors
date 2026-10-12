begin;

create function public.stockflow_market_overview_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, private, extensions as $$
declare
  v_email text := lower(btrim(coalesce(p_actor_email,''))); v_role text; v_roles text[]; v_hash text;
  v_search text; v_page integer := 1; v_filter text := 'all'; v_result jsonb;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_hash then raise exception 'Unauthorized gateway' using errcode='42501'; end if;
  select role, roles into v_role, v_roles from public.stockflow_members where email=v_email and status='active';
  if not private.stockflow_valid_roles(v_roles) or not (v_roles && array['administrator','management']::text[]) then raise exception 'Market access requires administrator or management' using errcode='42501'; end if;
  if p_action is distinct from 'get_market_overview' then raise exception 'Unsupported market overview action' using errcode='22023'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid market payload' using errcode='22023'; end if;
  if (p_payload ? 'search' and jsonb_typeof(p_payload->'search') is distinct from 'string')
    or char_length(coalesce(p_payload->>'search',''))>120 then raise exception 'Invalid market search' using errcode='22023'; end if;
  v_search:=lower(coalesce(p_payload->>'search',''));
  if p_payload ? 'page' then
    if jsonb_typeof(p_payload->'page') is distinct from 'number' or (p_payload->>'page') !~ '^[0-9]+$' then raise exception 'Invalid market page' using errcode='22023'; end if;
    begin v_page:=(p_payload->>'page')::integer;
    exception when numeric_value_out_of_range then raise exception 'Invalid market page' using errcode='22023'; end;
    if v_page<1 then raise exception 'Invalid market page' using errcode='22023'; end if;
  end if;
  if p_payload ? 'filter' then
    if jsonb_typeof(p_payload->'filter') is distinct from 'string' or p_payload->>'filter' not in ('all','focus','no_pin','no_estimate','stale_estimate') then raise exception 'Invalid market filter' using errcode='22023'; end if;
    v_filter:=p_payload->>'filter';
  end if;

  with searched as (
    select c.id,c.name,c.city from private.stockflow_customers c where c.active
      and (strpos(lower(c.name),v_search)>0 or strpos(lower(coalesce(c.city,'')),v_search)>0)
  ), current_estimates as (
    select distinct on (e.customer_id,e.division_id) e.customer_id,e.division_id,e.monthly_wallet_paise,e.as_of
    from private.stockflow_wallet_estimates e join searched c on c.id=e.customer_id
    join private.stockflow_wallet_divisions d on d.id=e.division_id and d.active
    order by e.customer_id,e.division_id,e.as_of desc,e.created_at desc,e.id desc
  ), wallets as (
    select customer_id,sum(monthly_wallet_paise) as wallet,count(*) as divisions,
      max(as_of) as latest,min(as_of) as oldest from current_estimates group by customer_id
  ), customers as (
    select c.*,w.wallet,coalesce(w.divisions,0) as divisions,w.latest,w.oldest,
      coalesce(w.oldest < v_today - interval '6 months',false) as stale,
      l.id is not null as has_pin,l.latitude,l.longitude,l.version as location_version
    from searched c left join wallets w on w.customer_id=c.id
    left join private.stockflow_customer_locations l on l.customer_id=c.id
  ), ranked as (
    select id,wallet,
      sum(wallet) over (order by wallet desc,name,id rows unbounded preceding) as cumulative,
      sum(wallet) over () as total from customers where wallet>0
  ), focus as (
    -- Include the crossing row: the preceding prefix has not reached 80% yet.
    -- SUM(bigint) is numeric, so these integer comparisons cannot overflow bigint.
    select id,wallet from ranked where (cumulative-wallet)*100 < total*80
  ), marked as (
    select c.*,f.id is not null as in_focus from customers c left join focus f on f.id=c.id
  ), filtered as (
    select * from marked where v_filter='all' or (v_filter='focus' and in_focus)
      or (v_filter='no_pin' and not has_pin) or (v_filter='no_estimate' and wallet is null)
      or (v_filter='stale_estimate' and stale)
  ), paged as (
    select * from filtered order by wallet desc nulls last,name,id limit 50 offset (v_page::bigint-1)*50
  ) select jsonb_build_object(
    'customers',coalesce((select jsonb_agg(jsonb_build_object(
      'id',id,'name',name,'city',city,'hasPin',has_pin,'walletTotalPaise',wallet::text,
      'divisionsEstimated',divisions,'latestAsOf',latest,'oldestAsOf',oldest,'staleEstimate',stale,'inFocus',in_focus)
      || case when has_pin then jsonb_build_object('latitude',latitude::text,'longitude',longitude::text,'locationVersion',location_version) else '{}'::jsonb end
      order by wallet desc nulls last,name,id) from paged),'[]'::jsonb),
    'page',jsonb_build_object('page',v_page,'pageSize',50,'total',(select count(*) from filtered)),
    'counts',(select jsonb_build_object('all',count(*),'noPin',count(*) filter (where not has_pin),
      'noEstimate',count(*) filter (where wallet is null),'staleEstimate',count(*) filter (where stale)) from customers),
    'pareto',jsonb_build_object('basis','estimated_wallet','focusCustomers',(select count(*) from focus),
      'focusWalletPaise',(select coalesce(sum(wallet),0)::text from focus),
      'totalWalletPaise',(select coalesce(sum(wallet),0)::text from customers),
      'estimatedCustomers',(select count(wallet) from customers),
      'activeCustomers',(select case when count(wallet)=0 then 0 else count(*) end from customers)),
    'activeDivisions',(select count(*) from private.stockflow_wallet_divisions where active)) into v_result;
  return v_result;
end $$;
revoke all on function public.stockflow_market_overview_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_market_overview_gateway(text,text,text,jsonb) to service_role;

commit;
