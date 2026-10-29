begin;

create table private.stockflow_commercial_actions (
 id uuid primary key default extensions.gen_random_uuid(),
 opportunity_id uuid not null references private.stockflow_commercial_opportunities(id),
 action_type text not null check(action_type in ('visit','demo','get_competitor_proof','add_product','fix_service','fix_supply','instrument_proposal','credit_terms','price_review','no_action')),
 detail text not null check(length(btrim(detail)) between 3 and 500),
 owner_email text not null,
 due_on date not null,
 expected_monthly_gain_paise bigint check(expected_monthly_gain_paise is null or expected_monthly_gain_paise between 1 and 90000000000000),
 created_by text not null,
 created_at timestamptz not null default clock_timestamp(),
 constraint stockflow_commercial_actions_owner_rule check(owner_email=lower(btrim(owner_email)))
);
create index stockflow_commercial_actions_opportunity on private.stockflow_commercial_actions(opportunity_id,created_at desc,id desc);
create table private.stockflow_commercial_action_results (
 action_id uuid primary key references private.stockflow_commercial_actions(id),
 result text not null check(result in ('done','dropped')),
 note text not null check(length(btrim(note)) between 3 and 500),
 closed_by text not null,
 closed_at timestamptz not null default clock_timestamp()
);

do $$ declare table_name text;
begin
 foreach table_name in array array['stockflow_commercial_actions','stockflow_commercial_action_results'] loop
  execute format('alter table private.%I enable row level security',table_name);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role',table_name);
  execute format('create trigger %I before delete on private.%I for each row execute function private.prevent_business_delete()',table_name||'_no_delete',table_name);
  execute format('create trigger %I before update on private.%I for each row execute function private.prevent_immutable_pricing_update()',table_name||'_immutable',table_name);
 end loop;
end$$;

create function private.stockflow_actions_closure_guard() returns trigger
language plpgsql set search_path=pg_catalog,private as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('opportunity-action:'||new.opportunity_id,0));
 if exists(select 1 from private.stockflow_commercial_actions a left join private.stockflow_commercial_action_results r on r.action_id=a.id where a.opportunity_id=new.opportunity_id and r.action_id is null) then
  raise exception 'Close the open action first' using errcode='22023';
 end if;
 return new;
end$$;
create trigger stockflow_commercial_actions_closure_guard before insert on private.stockflow_commercial_opportunity_closures
for each row execute function private.stockflow_actions_closure_guard();

create function private.stockflow_actions_due_read(p_today date,p_page int) returns jsonb
language plpgsql stable set search_path=pg_catalog,private as $$
declare result_data jsonb; total_count bigint; overdue_count bigint;
begin
 if p_today is null or p_page is null or p_page<1 or p_page>100000 then raise exception 'Invalid actions page' using errcode='22023';end if;
 select count(*),count(*) filter(where a.due_on<p_today) into total_count,overdue_count
 from private.stockflow_commercial_actions a left join private.stockflow_commercial_action_results r on r.action_id=a.id
 where r.action_id is null and a.due_on<=p_today+7;
 select coalesce(jsonb_agg(item order by due_on,customer_name,action_id),'[]'::jsonb) into result_data from (
  select jsonb_build_object('actionId',a.id,'customerId',c.id,'customerName',c.name,'city',c.city,'opportunityKind',o.kind,
   'constraintCategory',cc.category,'actionType',a.action_type,'detail',a.detail,'ownerEmail',a.owner_email,'dueOn',a.due_on,
   'overdue',a.due_on<p_today,'expectedMonthlyGainPaise',a.expected_monthly_gain_paise) item,
   a.due_on,c.name customer_name,a.id action_id
  from private.stockflow_commercial_actions a join private.stockflow_commercial_opportunities o on o.id=a.opportunity_id
  join private.stockflow_customers c on c.id=o.customer_id
  left join private.stockflow_commercial_action_results r on r.action_id=a.id
  left join lateral(select category from private.stockflow_commercial_constraints x where x.opportunity_id=o.id order by x.recorded_at desc,x.id desc limit 1) cc on true
  where r.action_id is null and a.due_on<=p_today+7 order by a.due_on,c.name,a.id offset (p_page-1)*50 limit 50
 ) selected_rows;
 return jsonb_build_object('page',p_page,'pageSize',50,'total',total_count,'overdueCount',overdue_count,'rows',result_data);
end$$;

create function public.stockflow_action_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,extensions as $$
declare actor text:=lower(btrim(p_actor_email)); roles text[]; secret_hash text; command_key text; replay jsonb; result jsonb;
 opportunity uuid; entity uuid; action_entity uuid; today date:=(now() at time zone 'Asia/Kolkata')::date; owner_value text; due_value date;
 customer_id uuid; action_row private.stockflow_commercial_actions%rowtype; result_row private.stockflow_commercial_action_results%rowtype;
begin
 select secret_sha256 into secret_hash from private.stockflow_gateway_config where name='orders';
 if secret_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>secret_hash then raise exception 'Unauthorized gateway' using errcode='42501';end if;
 roles:=private.stockflow_active_member_roles(actor);
 if not coalesce(roles&&array['administrator','management'],false) then raise exception 'Wallet management access required' using errcode='PT403';end if;
 if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid wallet action request' using errcode='22023';end if;
 if p_action='get_actions_due' then
  if coalesce(p_payload->>'page','') !~ '^\d+$' then raise exception 'Invalid wallet action request' using errcode='22023';end if;
  return private.stockflow_actions_due_read(today,(p_payload->>'page')::int);
 elsif p_action='get_action_owners' then
  return coalesce((select jsonb_agg(jsonb_build_object('email',m.email,'name',null) order by m.email) from public.stockflow_members m where m.status='active' and m.role in ('administrator','management','sales')),'[]'::jsonb);
 elsif p_action='get_opportunity_actions' then
  if coalesce(p_payload->>'opportunityId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Invalid opportunity id' using errcode='22023';end if;
  opportunity:=(p_payload->>'opportunityId')::uuid;
  if not exists(select 1 from private.stockflow_commercial_opportunities o where o.id=opportunity) then raise exception 'Opportunity not found' using errcode='22023';end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'opportunityId',a.opportunity_id,'actionType',a.action_type,'detail',a.detail,'ownerEmail',a.owner_email,'dueOn',a.due_on,'expectedMonthlyGainPaise',a.expected_monthly_gain_paise,'createdBy',a.created_by,'createdAt',a.created_at,
   'result',case when r.action_id is null then null else jsonb_build_object('result',r.result,'note',r.note,'closedBy',r.closed_by,'closedAt',r.closed_at) end)
   order by (r.action_id is null) desc,a.created_at desc,a.id desc)
   from private.stockflow_commercial_actions a left join private.stockflow_commercial_action_results r on r.action_id=a.id where a.opportunity_id=opportunity),'[]'::jsonb);
 end if;
 if p_action is null or p_action not in ('create_action','close_action') then raise exception 'Unsupported wallet action' using errcode='22023';end if;
 command_key:=p_payload->>'requestId';
 replay:=private.begin_stockflow_command(actor,p_action,command_key,p_payload);if replay is not null then return replay;end if;
 if p_action='create_action' then
  if coalesce(p_payload->>'opportunityId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Invalid opportunity id' using errcode='22023';end if;
  opportunity:=(p_payload->>'opportunityId')::uuid;
  perform pg_advisory_xact_lock(hashtextextended('opportunity-action:'||opportunity,0));
  if not exists(select 1 from private.stockflow_commercial_opportunities o left join private.stockflow_commercial_opportunity_closures cl on cl.opportunity_id=o.id where o.id=opportunity and cl.opportunity_id is null) then raise exception 'Open opportunity not found' using errcode='22023';end if;
  if exists(select 1 from private.stockflow_commercial_actions a left join private.stockflow_commercial_action_results r on r.action_id=a.id where a.opportunity_id=opportunity and r.action_id is null) then raise exception 'Open action already exists' using errcode='PT409';end if;
  owner_value:=lower(btrim(coalesce(p_payload->>'ownerEmail','')));
  if not exists(select 1 from public.stockflow_members m where m.email=owner_value and m.status='active') then raise exception 'Action owner must be active' using errcode='22023';end if;
  if jsonb_typeof(p_payload->'dueOn') is distinct from 'string' or coalesce(p_payload->>'dueOn','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid due date' using errcode='22023';end if;
  begin due_value:=(p_payload->>'dueOn')::date;exception when others then raise exception 'Invalid due date' using errcode='22023';end;
  if to_char(due_value,'YYYY-MM-DD')<>p_payload->>'dueOn' or due_value<today or due_value>today+180 then raise exception 'Invalid due date' using errcode='22023';end if;
  if coalesce(p_payload->>'actionType','') not in ('visit','demo','get_competitor_proof','add_product','fix_service','fix_supply','instrument_proposal','credit_terms','price_review','no_action') or length(btrim(coalesce(p_payload->>'detail',''))) not between 3 and 500 then raise exception 'Invalid action' using errcode='22023';end if;
  if p_payload->'expectedMonthlyGainPaise' is distinct from 'null'::jsonb and (jsonb_typeof(p_payload->'expectedMonthlyGainPaise') is distinct from 'number' or (p_payload->>'expectedMonthlyGainPaise') !~ '^\d+$' or (p_payload->>'expectedMonthlyGainPaise')::numeric not between 1 and 90000000000000) then raise exception 'Invalid expected gain' using errcode='22023';end if;
  if p_payload->>'actionType'='price_review' and not exists(select 1 from (select category,source from private.stockflow_commercial_constraints where opportunity_id=opportunity order by recorded_at desc,id desc limit 1) current_constraint where current_constraint.category='price' and current_constraint.source<>'our_view') then raise exception 'Price review needs a proven price reason' using errcode='22023';end if;
  insert into private.stockflow_commercial_actions(opportunity_id,action_type,detail,owner_email,due_on,expected_monthly_gain_paise,created_by)
  values(opportunity,p_payload->>'actionType',btrim(p_payload->>'detail'),owner_value,due_value,(p_payload->>'expectedMonthlyGainPaise')::bigint,actor) returning id into entity;
  result:=jsonb_build_object('id',entity,'opportunityId',opportunity,'actionType',p_payload->>'actionType','detail',btrim(p_payload->>'detail'),'ownerEmail',owner_value,'dueOn',due_value,'expectedMonthlyGainPaise',(p_payload->>'expectedMonthlyGainPaise')::bigint,'createdBy',actor,'createdAt',clock_timestamp(),'result',null);
 else
  if coalesce(p_payload->>'actionId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or coalesce(p_payload->>'result','') not in ('done','dropped') or length(btrim(coalesce(p_payload->>'note',''))) not between 3 and 500 then raise exception 'Invalid action result' using errcode='22023';end if;
  action_entity:=(p_payload->>'actionId')::uuid;
  select a.* into action_row from private.stockflow_commercial_actions a where a.id=action_entity;
  if not found then raise exception 'Action not found' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended('opportunity-action:'||action_row.opportunity_id,0));
  begin insert into private.stockflow_commercial_action_results(action_id,result,note,closed_by) values(action_entity,p_payload->>'result',btrim(p_payload->>'note'),actor);
  exception when unique_violation then raise exception 'Action already closed' using errcode='PT409';end;
  result:=jsonb_build_object('actionId',action_entity,'result',p_payload->>'result','note',btrim(p_payload->>'note'),'closedBy',actor,'closedAt',clock_timestamp()); entity:=action_entity;
 end if;
 insert into private.stockflow_economic_audit(action,entity_id,actor,payload) values(p_action,entity,actor,p_payload);
 perform private.finish_stockflow_command(actor,p_action,command_key,p_payload,entity,result);
 return result;
end$$;

revoke all on function private.stockflow_actions_closure_guard(),private.stockflow_actions_due_read(date,int) from public,anon,authenticated,service_role;
revoke all on function public.stockflow_action_gateway(text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.stockflow_action_gateway(text,text,text,jsonb) to service_role;
commit;
