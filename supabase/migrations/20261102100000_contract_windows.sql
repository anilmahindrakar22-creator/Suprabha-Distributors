begin;

create function public.stockflow_contract_window_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,extensions as $$
declare
 v_actor text:=lower(btrim(p_actor_email));
 v_roles text[];
 v_secret_hash text;
 v_today date:=(now() at time zone 'Asia/Kolkata')::date;
 v_page_number numeric;
 v_page int;
 v_result jsonb;
begin
 select secret_sha256 into v_secret_hash from private.stockflow_gateway_config where name='orders';
 if v_secret_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_secret_hash then raise exception 'Unauthorized gateway' using errcode='42501';end if;
 v_roles:=private.stockflow_active_member_roles(v_actor);
 if not coalesce(v_roles&&array['administrator','management'],false) then raise exception 'Wallet management access required' using errcode='PT403';end if;
 if p_action is distinct from 'get_contract_windows' then raise exception 'Unsupported contract window action' using errcode='22023';end if;
 if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid contract window request' using errcode='22023';end if;
 if jsonb_typeof(p_payload->'page') is distinct from 'number' or p_payload-'page'<>'{}'::jsonb then
  raise exception 'Invalid contract window page' using errcode='22023';
 end if;
 v_page_number:=(p_payload->>'page')::numeric;
 if v_page_number<>trunc(v_page_number) or v_page_number not between 1 and 4000 then raise exception 'Invalid contract window page' using errcode='22023';end if;
 v_page:=v_page_number::int;

 with windows as materialized (
  select o.id opportunity_id,o.customer_id,c.name customer_name,c.city town,o.kind,d.name division_name,
   cc.category,case cc.category when 'competitor_lock_in' then cc.facts->>'competitor' else cc.facts->>'holder' end party,
   (cc.facts->>'endsOn')::date ends_on,cc.confidence,cc.source,
   exists(
    select 1 from private.stockflow_commercial_actions a
    left join private.stockflow_commercial_action_results r on r.action_id=a.id
    where a.opportunity_id=o.id and r.action_id is null and a.due_on<=(cc.facts->>'endsOn')::date
   ) planned
  from private.stockflow_commercial_opportunities o
  join private.stockflow_customers c on c.id=o.customer_id
  left join private.stockflow_wallet_divisions d on d.id=o.division_id
  left join private.stockflow_commercial_opportunity_closures cl on cl.opportunity_id=o.id
  join lateral (
   select x.category,x.facts,x.confidence,x.source from private.stockflow_commercial_constraints x
   where x.opportunity_id=o.id order by x.recorded_at desc,x.id desc limit 1
  ) cc on true
  where cl.opportunity_id is null and cc.category in ('competitor_lock_in','contract_tender')
   and (cc.facts->>'endsOn')::date between v_today-30 and v_today+120
 ), selected_rows as (
  select * from windows where not planned
  order by ends_on,customer_name,opportunity_id offset (v_page-1)*20 limit 20
 )
 select jsonb_build_object(
  'rows',(select coalesce(jsonb_agg(jsonb_build_object(
   'customerId',customer_id,'customerName',customer_name,'town',town,'opportunityId',opportunity_id,
   'kind',kind,'divisionName',division_name,'category',category,'party',party,'endsOn',ends_on,
   'daysLeft',ends_on-v_today,'confidence',confidence,'source',source
  ) order by ends_on,customer_name,opportunity_id),'[]'::jsonb) from selected_rows),
  'total',count(*) filter(where not planned),'plannedCount',count(*) filter(where planned),
  'page',v_page,'pageSize',20
 ) into v_result from windows;
 return v_result;
end$$;

revoke all on function public.stockflow_contract_window_gateway(text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.stockflow_contract_window_gateway(text,text,text,jsonb) to service_role;
commit;
notify pgrst,'reload schema';
