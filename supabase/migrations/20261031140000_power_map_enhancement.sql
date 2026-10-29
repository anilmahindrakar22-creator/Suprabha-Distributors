begin;

do $roles$
declare check_name text;
begin
  select con.conname into check_name
  from pg_constraint con
  join pg_class rel on rel.oid=con.conrelid
  join pg_namespace ns on ns.oid=rel.relnamespace
  where ns.nspname='private' and rel.relname='stockflow_contact_assessments'
    and con.contype='c' and pg_get_constraintdef(con.oid) like '%decision_role%'
    and pg_get_constraintdef(con.oid) like '%decision_maker%';
  if check_name is null then raise exception 'decision_role check constraint not found'; end if;
  execute format('alter table private.stockflow_contact_assessments drop constraint %I',check_name);
  execute format('alter table private.stockflow_contact_assessments add constraint %I check (decision_role in (''decision_maker'',''influencer'',''user'',''gatekeeper'',''unknown'',''champion'',''technical_evaluator'',''coach''))',check_name);
end $roles$;

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
    case when not exists(select 1 from contacts where decision_role='decision_maker') then 'no_decision_maker' end,
    case when exists(select 1 from contacts where decision_role='decision_maker')
      and not exists(select 1 from contacts where decision_role='decision_maker'
        and last_met>=p_today-private.stockflow_power_map_not_met_days()) then 'decision_maker_not_met' end,
    case when exists(select 1 from contacts where stance in ('blocker','sceptical') and influence='high') then 'influential_blocker' end,
    case when exists(select 1 from contacts where stance='unknown' and influence='high') then 'influential_unknown' end,
    case when exists(select 1 from contacts where decision_role is not null)
      and not exists(select 1 from contacts where stance='supporter'
        and (influence='high' or decision_role in ('decision_maker','champion'))) then 'no_influential_supporter' end
  ]::text[],null))
$$;
revoke all on function private.stockflow_power_alerts(uuid,date) from public,anon,authenticated,service_role;

do $gateway$
declare definition text; old_text text; new_text text;
begin
  definition:=replace(pg_get_functiondef('public.stockflow_accounts_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'');
  old_text:=$old$or (p_payload->>'decisionRole') not in ('decision_maker','influencer','user','gatekeeper','unknown')$old$;
  new_text:=$new$or (p_payload->>'decisionRole') not in ('decision_maker','influencer','user','gatekeeper','unknown','champion','technical_evaluator','coach')$new$;
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected set_assessment role validator'; end if;
  definition:=replace(definition,old_text,new_text);
  old_text:=$old$v_alert not in ('no_decision_maker','decision_maker_not_met','influential_blocker')$old$;
  new_text:=$new$v_alert not in ('no_decision_maker','decision_maker_not_met','influential_blocker','influential_unknown','no_influential_supporter')$new$;
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected Power Map alert validator'; end if;
  definition:=replace(definition,old_text,new_text);
  execute definition;
end $gateway$;
revoke all on function public.stockflow_accounts_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_accounts_gateway(text,text,text,jsonb) to service_role;
commit;
