begin;

create table private.stockflow_contact_assessments (
  id uuid primary key default extensions.gen_random_uuid(),
  contact_id uuid not null references private.stockflow_account_contacts(id),
  decision_role text not null check (decision_role in ('decision_maker','influencer','user','gatekeeper','unknown')),
  stance text not null check (stance in ('supporter','neutral','sceptical','blocker','unknown')),
  influence text not null check (influence in ('high','medium','low','unknown')),
  reason text check (char_length(reason)<=300), actor text not null,
  recorded_at timestamptz not null default clock_timestamp()
);
create index stockflow_contact_assessments_latest_idx on private.stockflow_contact_assessments(contact_id,recorded_at desc,id desc);
create table private.stockflow_visit_contacts (
  visit_id uuid not null references private.stockflow_customer_visits(id),
  contact_id uuid not null references private.stockflow_account_contacts(id),
  primary key(visit_id,contact_id)
);
create index stockflow_visit_contacts_contact_idx on private.stockflow_visit_contacts(contact_id,visit_id);
alter table private.stockflow_contact_assessments enable row level security;
alter table private.stockflow_visit_contacts enable row level security;
revoke all on private.stockflow_contact_assessments,private.stockflow_visit_contacts from public,anon,authenticated;

-- Erasure-only exceptions: clear reason or both event value blobs, preserving
-- every other column. No session flag, arbitrary history edits or deletes.
create function private.stockflow_power_map_history_guard() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if tg_op='UPDATE' then
    if tg_table_name='stockflow_contact_assessments' then
      if new.reason is null and (to_jsonb(new)-'reason')=(to_jsonb(old)-'reason') then return new; end if;
    elsif tg_table_name='stockflow_account_contact_events' then
      if new.old_values is null and new.new_values='{}'::jsonb
        and (to_jsonb(new)-'old_values'-'new_values')=(to_jsonb(old)-'old_values'-'new_values') then return new; end if;
    end if;
  end if;
  raise exception 'History is immutable except for personal value erasure' using errcode='42501';
end $$;
revoke all on function private.stockflow_power_map_history_guard() from public,anon,authenticated,service_role;
create trigger stockflow_contact_assessments_immutable before update or delete on private.stockflow_contact_assessments
  for each row execute function private.stockflow_power_map_history_guard();
drop trigger stockflow_account_contact_events_immutable on private.stockflow_account_contact_events;
create trigger stockflow_account_contact_events_immutable before update or delete on private.stockflow_account_contact_events
  for each row execute function private.stockflow_power_map_history_guard();
create trigger stockflow_visit_contacts_immutable before update or delete on private.stockflow_visit_contacts
  for each row execute function private.prevent_order_event_mutation();
alter table private.stockflow_account_contact_events drop constraint stockflow_account_contact_events_action_check;
alter table private.stockflow_account_contact_events add constraint stockflow_account_contact_events_action_check
  check (action in ('added','updated','removed','erased'));

create function private.stockflow_power_map_not_met_days() returns integer
language sql immutable set search_path=pg_catalog as $$ select 60 $$;
create function private.stockflow_contact_last_met(p_contact uuid) returns date
language sql stable set search_path=pg_catalog as $$
  select max(v.visited_on) from private.stockflow_visit_contacts j
  join private.stockflow_customer_visits v on v.id=j.visit_id where j.contact_id=p_contact
$$;
create function private.stockflow_power_alerts(p_customer uuid,p_today date) returns jsonb
language sql stable set search_path=pg_catalog as $$
  with contacts as materialized (
    select a.decision_role,a.stance,a.influence,private.stockflow_contact_last_met(k.id) as last_met
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
    case when exists(select 1 from contacts where stance in ('blocker','sceptical') and influence='high') then 'influential_blocker' end
  ]::text[],null))
$$;
revoke all on function private.stockflow_power_map_not_met_days(),private.stockflow_contact_last_met(uuid),
  private.stockflow_power_alerts(uuid,date) from public,anon,authenticated,service_role;

-- Patch the effective definition AFTER account classes and app contacts.
do $upgrade$
declare
  v_definition text; v_anchor text; v_index integer;
  v_anchors text[]:=array[
    $old$  v_contact_event text;$old$,
    $old$('get_accounts','create_territory','assign_account','set_location','log_visit','set_class_policy','add_contact','update_contact','remove_contact')$old$,
    $old$  if jsonb_typeof(p_payload) is distinct from 'object' then$old$,
    $old$    v_class:=p_payload->>'class';$old$,
    $old$from candidates c
    ), filtered as materialized (
      select * from classified where v_class is null or account_class->>'state'=v_class$old$,
    $old$'canEdit',k.added_by=v_email or v_roles && array['administrator','management']::text[]) order by k.added_at,k.id)$old$,
    $old$'outcome',visit.outcome,'visitedBy',visit.visited_by,'note',visit.note) end,$old$,
    $old$'nextVisitOn',s.next_visit_on,'lastOrderOn',ord.last_order_on)$old$,
    $old$'today',v_today,'classPolicy',$old$,
    $old$  if p_action in ('add_contact','update_contact','remove_contact') then$old$,
    $old$      v_note:=p_payload->>'note';$old$,
    $old$      v_result:=jsonb_build_object('ok',true,'customerId',v_customer,'visitId',v_id);$old$
  ];
  v_replacements text[]:=array[
    $new$  v_contact_event text;
  v_can_power boolean; v_alert text; v_met_id uuid; v_met_value jsonb; v_assessment_id uuid;$new$,
    $new$('get_accounts','create_territory','assign_account','set_location','log_visit','set_class_policy','add_contact','update_contact','remove_contact','set_assessment','erase_contact')$new$,
    $new$  v_can_power:=v_roles && array['administrator','management']::text[];
  if p_action='set_assessment' and not v_can_power then
    raise exception 'Management required for assessments' using errcode='42501'; end if;
  if p_action='erase_contact' and not (v_roles && array['administrator']::text[]) then
    raise exception 'Administrator required for erasure' using errcode='42501'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then$new$,
    $new$    if p_payload ? 'alert' then
      if not v_can_power then raise exception 'Management required for alert filter' using errcode='42501'; end if;
      v_alert:=p_payload->>'alert';
      if jsonb_typeof(p_payload->'alert') is distinct from 'string'
        or v_alert not in ('no_decision_maker','decision_maker_not_met','influential_blocker') then
        raise exception 'Invalid power alert' using errcode='22023'; end if;
    end if;
    v_class:=p_payload->>'class';$new$,
    $new$from candidates c
    ), powered as materialized (
      select c.*,case when v_can_power and v_alert is not null then private.stockflow_power_alerts(c.id,v_today) end as power_alerts
      from classified c
    ), filtered as materialized (
      select * from powered where (v_class is null or account_class->>'state'=v_class)
        and (v_alert is null or power_alerts ? v_alert)$new$,
    $new$'canEdit',k.added_by=v_email or v_roles && array['administrator','management']::text[])
          || case when v_can_power then jsonb_build_object(
            'assessment',(select jsonb_build_object('decisionRole',a.decision_role,'stance',a.stance,'influence',a.influence,
              'reason',a.reason,'recordedAt',a.recorded_at,'actor',a.actor) from private.stockflow_contact_assessments a
              where a.contact_id=k.id order by a.recorded_at desc,a.id desc limit 1),
            'lastMetOn',private.stockflow_contact_last_met(k.id)) else '{}'::jsonb end order by k.added_at,k.id)$new$,
    $new$'outcome',visit.outcome,'visitedBy',visit.visited_by,'note',visit.note,
          'metContacts',coalesce((select jsonb_agg(jsonb_build_object('id',k.id,'name',k.name) order by k.name,k.id)
            from private.stockflow_visit_contacts j join private.stockflow_account_contacts k on k.id=j.contact_id
            where j.visit_id=visit.id and k.removed_at is null),'[]'::jsonb)) end,$new$,
    $new$'nextVisitOn',s.next_visit_on,'lastOrderOn',ord.last_order_on)
        || case when v_can_power then jsonb_build_object('powerAlerts',coalesce(s.power_alerts,private.stockflow_power_alerts(s.id,v_today)))
          else '{}'::jsonb end$new$,
    $new$'today',v_today,'canSeePowerMap',v_can_power,'classPolicy',$new$,
    $new$  if p_action in ('set_assessment','erase_contact') then
    if jsonb_typeof(p_payload->'contactId') is distinct from 'string' or (p_payload->>'contactId') !~* v_uuid_pattern then
      raise exception 'Invalid contact' using errcode='22023'; end if;
    v_id:=(p_payload->>'contactId')::uuid;
    select customer_id into v_customer from private.stockflow_account_contacts where id=v_id;
    if not found then raise exception 'Contact was removed' using errcode='PT409'; end if;
    -- Match contacts and visits: customer lock first, then contact lock.
    perform 1 from private.stockflow_customers where id=v_customer for update;
    select * into strict v_contact from private.stockflow_account_contacts where id=v_id for update;
    if p_action='set_assessment' then
      if v_contact.removed_at is not null then raise exception 'Contact was removed' using errcode='PT409'; end if;
      if jsonb_typeof(p_payload->'decisionRole') is distinct from 'string'
        or (p_payload->>'decisionRole') not in ('decision_maker','influencer','user','gatekeeper','unknown')
        or jsonb_typeof(p_payload->'stance') is distinct from 'string'
        or (p_payload->>'stance') not in ('supporter','neutral','sceptical','blocker','unknown')
        or jsonb_typeof(p_payload->'influence') is distinct from 'string'
        or (p_payload->>'influence') not in ('high','medium','low','unknown')
        or (p_payload ? 'reason' and p_payload->'reason'<>'null'::jsonb
          and (jsonb_typeof(p_payload->'reason') is distinct from 'string' or char_length(p_payload->>'reason')>300)) then
        raise exception 'Invalid assessment' using errcode='22023'; end if;
      insert into private.stockflow_contact_assessments(contact_id,decision_role,stance,influence,reason,actor)
        values(v_id,p_payload->>'decisionRole',p_payload->>'stance',p_payload->>'influence',p_payload->>'reason',v_email)
        returning id into v_assessment_id;
      v_result:=jsonb_build_object('ok',true,'contactId',v_id,'assessmentId',v_assessment_id);
    else
      if jsonb_typeof(p_payload->'reason') is distinct from 'string' or char_length(btrim(p_payload->>'reason')) not between 3 and 300 then
        raise exception 'Erasure reason must have 3 to 300 characters' using errcode='22023'; end if;
      -- The submitted reason may itself contain personal data: validate but do
      -- not persist it. Keep actor/request metadata and no old personal values.
      update private.stockflow_account_contacts set name='Erased contact',business_role=null,phone=null,email=null,
        removed_at=coalesce(removed_at,now()),removed_by=coalesce(removed_by,v_email),
        updated_at=now(),updated_by=v_email,version=version+1 where id=v_id returning * into v_contact;
      update private.stockflow_contact_assessments set reason=null where contact_id=v_id;
      update private.stockflow_account_contact_events set old_values=null,new_values='{}'::jsonb where contact_id=v_id;
      insert into private.stockflow_account_contact_events(contact_id,action,old_values,new_values,actor,request_id)
        values(v_id,'erased',null,'{}'::jsonb,v_email,v_key);
      v_result:=jsonb_build_object('ok',true,'contactId',v_id,'version',v_contact.version);
    end if;
  elsif p_action in ('add_contact','update_contact','remove_contact') then$new$,
    $new$      if p_payload ? 'metContactIds' then
        if jsonb_typeof(p_payload->'metContactIds') is distinct from 'array' then
          raise exception 'Invalid met contacts' using errcode='22023'; end if;
        if jsonb_array_length(p_payload->'metContactIds')>10 then raise exception 'At most 10 met contacts' using errcode='22023'; end if;
        for v_met_value in select value from jsonb_array_elements(p_payload->'metContactIds') loop
          if jsonb_typeof(v_met_value) is distinct from 'string' or (v_met_value #>> '{}') !~* v_uuid_pattern then
            raise exception 'Met contact must be an active contact of this account' using errcode='22023'; end if;
          v_met_id:=(v_met_value #>> '{}')::uuid;
          if not exists(select 1 from private.stockflow_account_contacts where id=v_met_id and customer_id=v_customer and removed_at is null) then
            raise exception 'Met contact must be an active contact of this account' using errcode='22023'; end if;
        end loop;
      end if;
      v_note:=p_payload->>'note';$new$,
    $new$      insert into private.stockflow_visit_contacts(visit_id,contact_id)
        select v_id,(value #>> '{}')::uuid from jsonb_array_elements(coalesce(p_payload->'metContactIds','[]'::jsonb))
        on conflict do nothing;
      v_result:=jsonb_build_object('ok',true,'customerId',v_customer,'visitId',v_id);$new$
  ];
begin
  v_definition:=replace(pg_get_functiondef('public.stockflow_accounts_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'');
  for v_index in 1..array_length(v_anchors,1) loop
    v_anchor:=v_anchors[v_index];
    if (length(v_definition)-length(replace(v_definition,v_anchor,'')))/length(v_anchor)<>1 then
      raise exception 'Unexpected Power Map gateway anchor %',v_index;
    end if;
    v_definition:=replace(v_definition,v_anchor,v_replacements[v_index]);
  end loop;
  execute v_definition;
end $upgrade$;
revoke all on function public.stockflow_accounts_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_accounts_gateway(text,text,text,jsonb) to service_role;

commit;
