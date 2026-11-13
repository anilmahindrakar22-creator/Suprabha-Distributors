begin;

-- Contact roles separate a person's part in buying (decision_role) from which
-- side they are on (stance, now including champion). Coach becomes the
-- shares_inside_info flag. Table history keeps its legacy codes; only the
-- gateway validator is narrowed to the new list.

-- Exact-text seam helper: every seam must match exactly once or the migration stops.
create function pg_temp.stockflow_roles_seam(definition text,old_text text,new_text text,seam_label text) returns text
language plpgsql as $$
declare occurrences integer;
begin
  occurrences:=(length(definition)-length(replace(definition,old_text,'')))/length(old_text);
  if occurrences<>1 then raise exception 'Unexpected % seam (% matches)',seam_label,occurrences; end if;
  return replace(definition,old_text,new_text);
end$$;

alter table private.stockflow_contact_assessments add column shares_inside_info boolean not null default false;

do $roles$
declare check_name text;
begin
  select con.conname into check_name
  from pg_constraint con
  join pg_class rel on rel.oid=con.conrelid
  join pg_namespace ns on ns.oid=rel.relnamespace
  where ns.nspname='private' and rel.relname='stockflow_contact_assessments'
    and con.contype='c' and pg_get_constraintdef(con.oid) like '%decision_role%'
    and pg_get_constraintdef(con.oid) like '%technical_evaluator%';
  if check_name is null then raise exception 'decision_role check constraint not found'; end if;
  execute format('alter table private.stockflow_contact_assessments drop constraint %I',check_name);
  execute format('alter table private.stockflow_contact_assessments add constraint %I check (decision_role in (''final_approver'',''technical_decider'',''daily_orderer'',''purchase_payments'',''user'',''gatekeeper'',''unknown'',''decision_maker'',''influencer'',''champion'',''technical_evaluator'',''coach''))',check_name);

  select con.conname into check_name
  from pg_constraint con
  join pg_class rel on rel.oid=con.conrelid
  join pg_namespace ns on ns.oid=rel.relnamespace
  where ns.nspname='private' and rel.relname='stockflow_contact_assessments'
    and con.contype='c' and pg_get_constraintdef(con.oid) like '%stance%'
    and pg_get_constraintdef(con.oid) like '%sceptical%';
  if check_name is null then raise exception 'stance check constraint not found'; end if;
  execute format('alter table private.stockflow_contact_assessments drop constraint %I',check_name);
  execute format('alter table private.stockflow_contact_assessments add constraint %I check (stance in (''supporter'',''neutral'',''sceptical'',''blocker'',''unknown'',''champion''))',check_name);
end $roles$;

-- Erased contacts are skipped so erasure is never re-copied.
-- Append-only move: a new latest row per contact still on a legacy code. The
-- original actor is kept because this is a system move, not a new judgement.
insert into private.stockflow_contact_assessments(contact_id,decision_role,stance,influence,reason,actor,shares_inside_info)
select latest.contact_id,
  case latest.decision_role when 'decision_maker' then 'final_approver' when 'technical_evaluator' then 'technical_decider' else 'unknown' end,
  case when latest.decision_role='champion' then 'champion' else latest.stance end,
  latest.influence,
  'Role list changed 14 Nov 2026',
  latest.actor,
  case when latest.decision_role='coach' then true else latest.shares_inside_info end
from (
  select distinct on (contact_id) contact_id,decision_role,stance,influence,reason,actor,shares_inside_info
  from private.stockflow_contact_assessments a
  where not exists(select 1 from private.stockflow_account_contact_events e where e.contact_id=a.contact_id and e.action='erased')
  order by contact_id,recorded_at desc,id desc
) latest
where latest.decision_role in ('decision_maker','influencer','champion','technical_evaluator','coach');

do $verify$
begin
  if exists(
    select 1 from (
      select distinct on (contact_id) decision_role
      from private.stockflow_contact_assessments a
      where not exists(select 1 from private.stockflow_account_contact_events e where e.contact_id=a.contact_id and e.action='erased')
      order by contact_id,recorded_at desc,id desc
    ) latest where latest.decision_role in ('decision_maker','influencer','champion','technical_evaluator','coach')
  ) then raise exception 'A latest contact assessment still has a legacy role'; end if;
end $verify$;

create or replace function private.stockflow_power_alerts(p_customer uuid,p_today date) returns jsonb
language sql stable set search_path=pg_catalog as $$
  with contacts as materialized (
    select k.id,a.decision_role,a.stance,a.influence,private.stockflow_contact_last_met(k.id) as last_met
    from private.stockflow_account_contacts k
    left join lateral (select decision_role,stance,influence from private.stockflow_contact_assessments
      where contact_id=k.id order by recorded_at desc,id desc limit 1) a on true
    where k.customer_id=p_customer and k.removed_at is null
  )
  select to_jsonb(array_remove(array[
    case when not exists(select 1 from contacts where decision_role='final_approver') then 'no_decision_maker' end,
    case when exists(select 1 from contacts where decision_role in ('final_approver','daily_orderer'))
      and not exists(select 1 from contacts where decision_role in ('final_approver','daily_orderer')
        and last_met>=p_today-private.stockflow_power_map_not_met_days()) then 'decision_maker_not_met' end,
    case when exists(select 1 from contacts where stance in ('blocker','sceptical') and influence='high') then 'influential_blocker' end,
    case when exists(select 1 from contacts where stance='unknown' and influence='high') then 'influential_unknown' end,
    case when exists(select 1 from contacts where decision_role is not null)
      and not exists(select 1 from contacts where stance in ('champion','supporter')
        and (influence='high' or decision_role in ('final_approver','technical_decider'))) then 'no_influential_supporter' end
  ]::text[],null))
$$;
revoke all on function private.stockflow_power_alerts(uuid,date) from public,anon,authenticated,service_role;

-- Customer Map "No decider" tone follows the final approver.
create or replace function private.stockflow_customer_map_deciders(p_customers uuid[])
returns table(customer_id uuid)
language sql stable security definer set search_path=pg_catalog,public,private,extensions as $$
 select distinct c.customer_id from private.stockflow_account_contacts c
 join lateral(select a.decision_role from private.stockflow_contact_assessments a
  where a.contact_id=c.id order by a.recorded_at desc,a.id desc limit 1) a on a.decision_role='final_approver'
 where c.customer_id=any(p_customers) and c.removed_at is null
$$;
revoke all on function private.stockflow_customer_map_deciders(uuid[]) from public,anon,authenticated,service_role;

-- The route starts from the strongest friendly contact (champion stance first,
-- then someone sharing inside information) and ends at a final approver.
create or replace function private.stockflow_power_route(p_customer uuid) returns jsonb
language sql stable set search_path=pg_catalog,private as $$
 with recursive current_contacts as materialized (
  select c.id,c.name,coalesce(a.decision_role,'unknown') decision_role,
   coalesce(a.stance,'unknown') stance,coalesce(a.influence,'unknown') influence,
   coalesce(a.shares_inside_info,false) shares_inside_info
  from private.stockflow_account_contacts c
  left join lateral(select decision_role,stance,influence,shares_inside_info from private.stockflow_contact_assessments
    where contact_id=c.id order by recorded_at desc,id desc limit 1) a on true
  where c.customer_id=p_customer and c.removed_at is null
 ), start_contact as (
  select id from current_contacts where stance in ('champion','supporter')
  order by case stance when 'champion' then 0 else 1 end,case when shares_inside_info then 0 else 1 end,
   case influence when 'high' then 0 when 'medium' then 1 when 'low' then 2 else 3 end,name,id limit 1
 ), walk(contact_id,path_ids,path_names,path_roles,path_stances,path_strengths,hops,strong_count,path_key) as (
  select c.id,array[c.id],array[c.name],array[c.decision_role],array[c.stance],array[]::text[],0,0,c.name||':'||c.id::text
  from current_contacts c join start_contact s on s.id=c.id
  union all
  select to_contact.id,w.path_ids||to_contact.id,w.path_names||to_contact.name,w.path_roles||to_contact.decision_role,
   w.path_stances||to_contact.stance,w.path_strengths||link.strength,w.hops+1,
   w.strong_count+case when link.strength='strong' then 1 else 0 end,w.path_key||'>'||to_contact.name||':'||to_contact.id::text
  from walk w
  join private.stockflow_contact_influences link on link.customer_id=p_customer and link.from_contact_id=w.contact_id
  left join private.stockflow_contact_influence_ends ended on ended.influence_id=link.id
  join current_contacts to_contact on to_contact.id=link.to_contact_id
  where ended.influence_id is null and w.hops<4 and not to_contact.id=any(w.path_ids)
 ), chosen as (
  select * from walk where hops>0 and path_roles[array_length(path_roles,1)]='final_approver'
  order by hops,strong_count desc,path_key limit 1
 ), direct_start as (
  select w.* from walk w where w.hops=0 and w.path_roles[1]='final_approver'
 )
 select case when exists(select 1 from direct_start) then
   (select jsonb_build_object('steps',jsonb_build_array(jsonb_build_object('contactId',contact_id,'name',path_names[1],
      'decisionRole',path_roles[1],'stance',path_stances[1])),'strengths','[]'::jsonb) from direct_start)
  when exists(select 1 from chosen) then
   (select jsonb_build_object('steps',(select jsonb_agg(jsonb_build_object('contactId',path_ids[n],'name',path_names[n],
      'decisionRole',path_roles[n],'stance',path_stances[n]) order by n) from generate_subscripts(path_ids,1) n),
      'strengths',to_jsonb(path_strengths)) from chosen)
  else null end
$$;
revoke all on function private.stockflow_power_route(uuid) from public,anon,authenticated,service_role;

do $accounts$
declare definition text;
begin
  definition:=replace(pg_get_functiondef('public.stockflow_accounts_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'');
  definition:=pg_temp.stockflow_roles_seam(definition,
    $old$or (p_payload->>'decisionRole') not in ('decision_maker','influencer','user','gatekeeper','unknown','champion','technical_evaluator','coach')$old$,
    $new$or (p_payload->>'decisionRole') not in ('final_approver','technical_decider','daily_orderer','purchase_payments','user','gatekeeper','unknown')$new$,
    'set_assessment role validator');
  definition:=pg_temp.stockflow_roles_seam(definition,
    $old$or (p_payload->>'stance') not in ('supporter','neutral','sceptical','blocker','unknown')$old$,
    $new$or (p_payload->>'stance') not in ('supporter','neutral','sceptical','blocker','unknown','champion')$new$,
    'set_assessment stance validator');
  definition:=pg_temp.stockflow_roles_seam(definition,
    $old$or (p_payload ? 'reason' and p_payload->'reason'<>'null'::jsonb$old$,
    $new$or (p_payload ? 'sharesInsideInfo' and jsonb_typeof(p_payload->'sharesInsideInfo') is distinct from 'boolean')
        or (p_payload ? 'reason' and p_payload->'reason'<>'null'::jsonb$new$,
    'set_assessment flag validator');
  definition:=pg_temp.stockflow_roles_seam(definition,
    $old$insert into private.stockflow_contact_assessments(contact_id,decision_role,stance,influence,reason,actor)$old$,
    $new$insert into private.stockflow_contact_assessments(contact_id,decision_role,stance,influence,reason,actor,shares_inside_info)$new$,
    'set_assessment insert columns');
  definition:=pg_temp.stockflow_roles_seam(definition,
    $old$p_payload->>'influence',p_payload->>'reason',v_email)$old$,
    $new$p_payload->>'influence',p_payload->>'reason',v_email,coalesce((p_payload->>'sharesInsideInfo')::boolean,false))$new$,
    'set_assessment insert values');
  definition:=pg_temp.stockflow_roles_seam(definition,
    $old$jsonb_build_object('decisionRole',a.decision_role,'stance',a.stance,'influence',a.influence,$old$,
    $new$jsonb_build_object('decisionRole',a.decision_role,'stance',a.stance,'influence',a.influence,'sharesInsideInfo',a.shares_inside_info,$new$,
    'accounts assessment read');
  execute definition;
end $accounts$;
revoke all on function public.stockflow_accounts_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_accounts_gateway(text,text,text,jsonb) to service_role;

do $power$
declare definition text;
begin
  definition:=replace(pg_get_functiondef('public.stockflow_power_map_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'');
  definition:=pg_temp.stockflow_roles_seam(definition,
    $old$'decisionRole',coalesce(a.decision_role,'unknown'),$old$,
    $new$'decisionRole',coalesce(a.decision_role,'unknown'),'sharesInsideInfo',coalesce(a.shares_inside_info,false),$new$,
    'power map contact read');
  definition:=pg_temp.stockflow_roles_seam(definition,
    $old$left join lateral(select decision_role,stance,influence from private.stockflow_contact_assessments where contact_id=c.id$old$,
    $new$left join lateral(select decision_role,stance,influence,shares_inside_info from private.stockflow_contact_assessments where contact_id=c.id$new$,
    'power map contact lateral');
  execute definition;
end $power$;
revoke all on function public.stockflow_power_map_gateway(text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.stockflow_power_map_gateway(text,text,text,jsonb) to service_role;

do $map$
declare definition text;
begin
  definition:=replace(pg_get_functiondef('public.stockflow_customer_map_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'');
  definition:=pg_temp.stockflow_roles_seam(definition,
    $old$from jsonb_array_elements(v_contacts) where value->>'decisionRole'='decision_maker'$old$,
    $new$from jsonb_array_elements(v_contacts) where value->>'decisionRole'='final_approver'$new$,
    'customer map decider');
  definition:=pg_temp.stockflow_roles_seam(definition,
    $old$'champions',(select count(*) from jsonb_array_elements(v_contacts) where value->>'decisionRole'='champion')$old$,
    $new$'champions',(select count(*) from jsonb_array_elements(v_contacts) where value->>'stance'='champion')$new$,
    'customer map champions');
  execute definition;
end $map$;
revoke all on function public.stockflow_customer_map_gateway(text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.stockflow_customer_map_gateway(text,text,text,jsonb) to service_role;

do $opportunity$
declare definition text;
begin
  definition:=replace(pg_get_functiondef('public.stockflow_opportunity_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'');
  definition:=pg_temp.stockflow_roles_seam(definition,
    $old$latest_role.decision_role='decision_maker'$old$,
    $new$latest_role.decision_role='final_approver'$new$,
    'wallet diagnosis decision maker');
  execute definition;
end $opportunity$;
revoke all on function public.stockflow_opportunity_gateway(text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.stockflow_opportunity_gateway(text,text,text,jsonb) to service_role;

drop function pg_temp.stockflow_roles_seam(text,text,text,text);
commit;
