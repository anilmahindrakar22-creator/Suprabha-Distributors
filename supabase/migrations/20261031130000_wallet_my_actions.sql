begin;

create function private.stockflow_my_actions_read(p_actor text,p_today date,p_page int) returns jsonb
language plpgsql stable set search_path=pg_catalog,private as $$
declare result_data jsonb; total_count bigint; overdue_count bigint; actor_value text:=lower(btrim(p_actor));
begin
 if actor_value is null or actor_value='' or p_today is null or p_page is null or p_page<1 or p_page>100000 then raise exception 'Invalid my actions page' using errcode='22023';end if;
 select count(*),count(*) filter(where a.due_on<p_today) into total_count,overdue_count
 from private.stockflow_commercial_actions a left join private.stockflow_commercial_action_results r on r.action_id=a.id
 where r.action_id is null and a.owner_email=actor_value;
 select coalesce(jsonb_agg(item order by due_on,customer_name,action_id),'[]'::jsonb) into result_data from (
  select jsonb_build_object('actionId',a.id,'customerId',c.id,'customerName',c.name,'city',c.city,
   'actionType',a.action_type,'detail',a.detail,'dueOn',a.due_on,'overdue',a.due_on<p_today,'constraintCategory',cc.category,
   'routeToDecider',case when route_data.route is null then null else
    (select jsonb_agg(step->>'name' order by ordinality) from jsonb_array_elements(route_data.route->'steps') with ordinality as s(step,ordinality)) end) item,
   a.due_on,c.name customer_name,a.id action_id
  from private.stockflow_commercial_actions a
  join private.stockflow_commercial_opportunities o on o.id=a.opportunity_id
  join private.stockflow_customers c on c.id=o.customer_id
  left join private.stockflow_commercial_action_results r on r.action_id=a.id
  left join lateral(select category from private.stockflow_commercial_constraints x where x.opportunity_id=o.id order by x.recorded_at desc,x.id desc limit 1) cc on true
  left join lateral(select private.stockflow_power_route(o.customer_id) as route) route_data on true
  where r.action_id is null and a.owner_email=actor_value
  order by a.due_on,c.name,a.id offset (p_page-1)*50 limit 50
 ) selected_rows;
 return jsonb_build_object('page',p_page,'pageSize',50,'total',total_count,'overdueCount',overdue_count,'rows',result_data);
end$$;

create function public.stockflow_my_actions_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,extensions as $$
declare actor text:=lower(btrim(p_actor_email)); roles text[]; secret_hash text; command_key text; replay jsonb; result jsonb;
 today date:=(now() at time zone 'Asia/Kolkata')::date; action_entity uuid; action_row private.stockflow_commercial_actions%rowtype; entity uuid;
 visit_data jsonb; visit_outcome text; customer_entity uuid; visit_result jsonb; visit_entity uuid;
begin
 select secret_sha256 into secret_hash from private.stockflow_gateway_config where name='orders';
 if secret_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>secret_hash then raise exception 'Unauthorized gateway' using errcode='42501';end if;
 roles:=private.stockflow_active_member_roles(actor);
 if not coalesce(roles&&array['administrator','management','sales','operations'],false) then raise exception 'My actions access required' using errcode='PT403';end if;
 if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid my actions request' using errcode='22023';end if;
 if p_action='get_my_actions' then
  if coalesce(p_payload->>'page','') !~ '^\d+$' then raise exception 'Invalid my actions request' using errcode='22023';end if;
  return private.stockflow_my_actions_read(actor,today,(p_payload->>'page')::int);
 end if;
 if p_action is null or p_action<>'close_my_action' then raise exception 'Unsupported my actions command' using errcode='22023';end if;
 command_key:=p_payload->>'requestId';
 replay:=private.begin_stockflow_command(actor,p_action,command_key,p_payload);if replay is not null then return replay;end if;
 if coalesce(p_payload->>'actionId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or coalesce(p_payload->>'result','') not in ('done','dropped') or length(btrim(coalesce(p_payload->>'note',''))) not between 3 and 500 then
  raise exception 'Invalid my action result' using errcode='22023';
 end if;
 action_entity:=(p_payload->>'actionId')::uuid;
 select a.* into action_row from private.stockflow_commercial_actions a where a.id=action_entity and a.owner_email=actor;
 if not found then raise exception 'Action not found' using errcode='22023';end if;
 visit_data:=p_payload->'visit';
 if p_payload ? 'visit' and visit_data<>'null'::jsonb then
  if jsonb_typeof(visit_data) is distinct from 'object' or (select count(*) from jsonb_object_keys(visit_data))<>2
   or not (visit_data ? 'outcome') or not (visit_data ? 'nextVisitOn')
   or jsonb_typeof(visit_data->'outcome') is distinct from 'string'
   or coalesce(visit_data->>'outcome','') not in ('met','not_available','order_taken','issue_raised','other')
   or jsonb_typeof(visit_data->'nextVisitOn') not in ('string','null') then
   raise exception 'Invalid visit details' using errcode='22023';
  end if;
  if action_row.action_type<>'visit' or p_payload->>'result'<>'done' then
   raise exception 'Visit details require a completed visit action' using errcode='22023';
  end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('opportunity-action:'||action_row.opportunity_id,0));
 if p_payload ? 'visit' and visit_data<>'null'::jsonb then
  select o.customer_id into customer_entity from private.stockflow_commercial_opportunities o where o.id=action_row.opportunity_id;
  visit_outcome:=visit_data->>'outcome';
  visit_result:=public.stockflow_accounts_gateway(p_gateway_key,p_actor_email,'log_visit',jsonb_build_object(
   'idempotencyKey',command_key||':visit','customerId',customer_entity,'visitedOn',today,
   'outcome',visit_outcome,'note',left(p_payload->>'note',500),'nextVisitOn',visit_data->'nextVisitOn'));
  visit_entity:=(visit_result->>'visitId')::uuid;
 end if;
 begin
  insert into private.stockflow_commercial_action_results(action_id,result,note,closed_by)
  values(action_entity,p_payload->>'result',btrim(p_payload->>'note'),actor);
 exception when unique_violation then raise exception 'Action already closed' using errcode='PT409';end;
 if visit_entity is not null then
  result:=jsonb_build_object('actionId',action_entity,'result',p_payload->>'result','note',btrim(p_payload->>'note'),'closedBy',actor,'closedAt',clock_timestamp(),'visitId',visit_entity);
 else
  result:=jsonb_build_object('actionId',action_entity,'result',p_payload->>'result','note',btrim(p_payload->>'note'),'closedBy',actor,'closedAt',clock_timestamp());
 end if;
 entity:=action_entity;
 insert into private.stockflow_economic_audit(action,entity_id,actor,payload) values(p_action,entity,actor,p_payload);
 perform private.finish_stockflow_command(actor,p_action,command_key,p_payload,entity,result);
 return result;
end$$;

revoke all on function private.stockflow_my_actions_read(text,date,int) from public,anon,authenticated,service_role;
revoke all on function public.stockflow_my_actions_gateway(text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.stockflow_my_actions_gateway(text,text,text,jsonb) to service_role;
commit;
