begin;

create table private.stockflow_style_observations (
  id uuid primary key default extensions.gen_random_uuid(),
  contact_id uuid not null references private.stockflow_account_contacts(id),
  visit_id uuid not null references private.stockflow_customer_visits(id),
  observer text not null,
  a1 smallint not null check(a1 between 1 and 4), a2 smallint not null check(a2 between 1 and 4),
  a3 smallint not null check(a3 between 1 and 4), a4 smallint not null check(a4 between 1 and 4),
  r1 smallint not null check(r1 between 1 and 4), r2 smallint not null check(r2 between 1 and 4),
  r3 smallint not null check(r3 between 1 and 4), r4 smallint not null check(r4 between 1 and 4),
  cues text[] not null default '{}' check(cues <@ array['cost_per_test','validation_data','uptime_tat','price_fast_decision',
    'new_tech_demo','reference_labs','service_training','stay_current_supplier']::text[] and array_position(cues,null) is null),
  recorded_at timestamptz not null default clock_timestamp(),
  unique(contact_id,visit_id,observer)
);
create index stockflow_style_observations_latest_idx on private.stockflow_style_observations(contact_id,recorded_at desc,id desc);
create table private.stockflow_style_overrides (
  id uuid primary key default extensions.gen_random_uuid(),
  contact_id uuid not null references private.stockflow_account_contacts(id),
  style text check(style in ('analytical','driving','expressive','amiable')),
  reason text not null check(char_length(btrim(reason)) between 3 and 300), actor text not null,
  recorded_at timestamptz not null default clock_timestamp()
);
create index stockflow_style_overrides_latest_idx on private.stockflow_style_overrides(contact_id,recorded_at desc,id desc);
alter table private.stockflow_style_observations enable row level security;
alter table private.stockflow_style_overrides enable row level security;
revoke all on private.stockflow_style_observations,private.stockflow_style_overrides from public,anon,authenticated;
create trigger stockflow_style_observations_immutable before update or delete on private.stockflow_style_observations
  for each row execute function private.prevent_order_event_mutation();
create trigger stockflow_style_overrides_immutable before update or delete on private.stockflow_style_overrides
  for each row execute function private.prevent_order_event_mutation();

create function private.stockflow_contact_style(p_contact uuid) returns jsonb
language sql stable set search_path=pg_catalog as $$
  with observations as materialized (
    select o.*,(o.a1+o.a2+o.a3+o.a4)/4.0 as a,(o.r1+o.r2+o.r3+o.r4)/4.0 as r,v.visited_on
    from private.stockflow_style_observations o join private.stockflow_customer_visits v on v.id=o.visit_id
    where o.contact_id=p_contact
  ), summary as (
    select count(*) as n,count(distinct visited_on) as dates,avg(a) as a,avg(r) as r from observations
  ), classified as (
    select *,case when n<3 or dates<3 then 'not_enough'
      when a=2.5 or r=2.5 then 'not_clear'
      when a>2.5 and r<=2.5 then 'driving' when a>2.5 and r>2.5 then 'expressive'
      when a<=2.5 and r<=2.5 then 'analytical' else 'amiable' end as state from summary
  ), matched as (
    select c.*,(select count(*)::numeric/nullif(c.n,0) from observations o where
      case when o.a=2.5 or o.r=2.5 then 'not_clear'
        when o.a>2.5 and o.r<=2.5 then 'driving' when o.a>2.5 and o.r>2.5 then 'expressive'
        when o.a<=2.5 and o.r<=2.5 then 'analytical' else 'amiable' end=c.state) as share from classified c
  )
  select jsonb_build_object('state',state,'computedStyle',case when state in ('not_enough','not_clear') then null else state end,
    'confidence',case when state in ('not_enough','not_clear') then null
      when share>=0.75 and n>=5 then 'high' when share>=0.6 then 'medium' else 'low' end,
    'observations',n,'distinctDates',dates,'assertiveness',round(a,2),'responsiveness',round(r,2),
    'override',(select case when style is null then null else jsonb_build_object('style',style,'reason',reason,
      'actor',actor,'recordedAt',recorded_at) end from private.stockflow_style_overrides
      where contact_id=p_contact order by recorded_at desc,id desc limit 1),
    'cues',coalesce((select jsonb_object_agg(cue,total) from (
      select cue,count(*) as total from observations o
      cross join lateral (select distinct unnest(o.cues) as cue) q group by cue
    ) counts),'{}'::jsonb)) from matched
$$;
revoke all on function private.stockflow_contact_style(uuid) from public,anon,authenticated,service_role;

-- Anchors are from the effective gateway after 20261014180000_power_map.sql.
do $upgrade$
declare
  v_definition text; v_anchor text; v_index integer;
  v_anchors text[]:=array[
    $old$  v_can_power boolean; v_alert text; v_met_id uuid; v_met_value jsonb; v_assessment_id uuid;$old$,
    $old$('get_accounts','create_territory','assign_account','set_location','log_visit','set_class_policy','add_contact','update_contact','remove_contact','set_assessment','erase_contact')$old$,
    $old$  if p_action='set_assessment' and not v_can_power then$old$,
    $old$'lastMetOn',private.stockflow_contact_last_met(k.id)) else '{}'::jsonb end order by k.added_at,k.id)$old$,
    $old$'lastVisit',case when visit.id is null then null else jsonb_build_object('visitedOn',visit.visited_on,$old$,
    $old$'nextVisitOn',s.next_visit_on,'lastOrderOn',ord.last_order_on)$old$,
    $old$  if p_action in ('set_assessment','erase_contact') then$old$
  ];
  v_replacements text[]:=array[
    $new$  v_can_power boolean; v_alert text; v_met_id uuid; v_met_value jsonb; v_assessment_id uuid;
  v_style_visit uuid; v_style_contact uuid; v_style_a smallint[]; v_style_r smallint[]; v_style_cues text[];
  v_style_axis text; v_style_value jsonb;$new$,
    $new$('get_accounts','create_territory','assign_account','set_location','log_visit','set_class_policy','add_contact','update_contact','remove_contact','set_assessment','erase_contact','record_style_observation','set_style_override')$new$,
    $new$  if p_action='set_style_override' and not v_can_power then
    raise exception 'Management required for style overrides' using errcode='42501'; end if;
  if p_action='set_assessment' and not v_can_power then$new$,
    $new$'lastMetOn',private.stockflow_contact_last_met(k.id)) else '{}'::jsonb end
          || case when v_can_power or coalesce(s.owner_email=v_email,false) then
            jsonb_build_object('style',private.stockflow_contact_style(k.id)) else '{}'::jsonb end
          || case when v_can_power then jsonb_build_object('styleObservations',coalesce((
            select jsonb_agg(jsonb_build_object('observer',o.observer,'recordedAt',o.recorded_at,
              'a',array[o.a1,o.a2,o.a3,o.a4],'r',array[o.r1,o.r2,o.r3,o.r4],'cues',o.cues)
              order by o.recorded_at desc,o.id desc)
            from (select * from private.stockflow_style_observations where contact_id=k.id
              order by recorded_at desc,id desc limit 10) o),'[]'::jsonb)) else '{}'::jsonb end order by k.added_at,k.id)$new$,
    $new$'lastVisit',case when visit.id is null then null else jsonb_build_object('id',visit.id,'visitedOn',visit.visited_on,$new$,
    $new$'nextVisitOn',s.next_visit_on,'lastOrderOn',ord.last_order_on,
          'canSeeStyle',v_can_power or coalesce(s.owner_email=v_email,false))$new$,
    $new$  if p_action in ('record_style_observation','set_style_override') then
    if jsonb_typeof(p_payload->'contactId') is distinct from 'string' or (p_payload->>'contactId') !~* v_uuid_pattern then
      raise exception 'Invalid contact' using errcode='22023'; end if;
    v_style_contact:=(p_payload->>'contactId')::uuid;
    select customer_id into v_customer from private.stockflow_account_contacts where id=v_style_contact;
    if not found then raise exception 'Contact was removed' using errcode='PT409'; end if;
    -- Same lock order as contact removal, erasure and visits.
    perform 1 from private.stockflow_customers where id=v_customer for update;
    select * into strict v_contact from private.stockflow_account_contacts where id=v_style_contact for update;
    if v_contact.removed_at is not null then raise exception 'Contact was removed' using errcode='PT409'; end if;
    if p_action='set_style_override' then
      if not (p_payload ? 'style') or (p_payload->'style'<>'null'::jsonb and
        (jsonb_typeof(p_payload->'style') is distinct from 'string'
          or p_payload->>'style' not in ('analytical','driving','expressive','amiable')))
        or jsonb_typeof(p_payload->'reason') is distinct from 'string'
        or char_length(btrim(p_payload->>'reason')) not between 3 and 300 then
        raise exception 'Invalid style override' using errcode='22023'; end if;
      insert into private.stockflow_style_overrides(contact_id,style,reason,actor)
        values(v_style_contact,p_payload->>'style',btrim(p_payload->>'reason'),v_email) returning id into v_id;
      v_result:=jsonb_build_object('ok',true,'contactId',v_style_contact,'overrideId',v_id);
    else
      if jsonb_typeof(p_payload->'visitId') is distinct from 'string' or (p_payload->>'visitId') !~* v_uuid_pattern then
        raise exception 'Rate only people you met on a visit in the last 30 days' using errcode='22023'; end if;
      v_style_visit:=(p_payload->>'visitId')::uuid;
      if not exists(select 1 from private.stockflow_visit_contacts j join private.stockflow_customer_visits v on v.id=j.visit_id
        where j.contact_id=v_style_contact and j.visit_id=v_style_visit and v.customer_id=v_customer and v.visited_on>=v_today-30) then
        raise exception 'Rate only people you met on a visit in the last 30 days' using errcode='22023'; end if;
      foreach v_style_axis in array array['a','r'] loop
        if jsonb_typeof(p_payload->v_style_axis) is distinct from 'array' then
          raise exception 'Ratings must have four integers from 1 to 4' using errcode='22023'; end if;
        if jsonb_array_length(p_payload->v_style_axis)<>4 then
          raise exception 'Ratings must have four integers from 1 to 4' using errcode='22023'; end if;
        for v_style_value in select value from jsonb_array_elements(p_payload->v_style_axis) loop
          if jsonb_typeof(v_style_value) is distinct from 'number' or (v_style_value #>> '{}') !~ '^[1-4]$' then
            raise exception 'Ratings must have four integers from 1 to 4' using errcode='22023'; end if;
        end loop;
      end loop;
      v_style_cues:='{}';
      if p_payload ? 'cues' then
        if jsonb_typeof(p_payload->'cues') is distinct from 'array' then raise exception 'Invalid style cues' using errcode='22023'; end if;
        for v_style_value in select value from jsonb_array_elements(p_payload->'cues') loop
          if jsonb_typeof(v_style_value) is distinct from 'string' or (v_style_value #>> '{}') not in
            ('cost_per_test','validation_data','uptime_tat','price_fast_decision','new_tech_demo','reference_labs','service_training','stay_current_supplier') then
            raise exception 'Invalid style cues' using errcode='22023'; end if;
          v_style_cues:=array_append(v_style_cues,v_style_value #>> '{}');
        end loop;
      end if;
      select array_agg((value #>> '{}')::smallint order by ordinality) into v_style_a from jsonb_array_elements(p_payload->'a') with ordinality;
      select array_agg((value #>> '{}')::smallint order by ordinality) into v_style_r from jsonb_array_elements(p_payload->'r') with ordinality;
      begin
        insert into private.stockflow_style_observations(contact_id,visit_id,observer,a1,a2,a3,a4,r1,r2,r3,r4,cues)
          values(v_style_contact,v_style_visit,v_email,v_style_a[1],v_style_a[2],v_style_a[3],v_style_a[4],
            v_style_r[1],v_style_r[2],v_style_r[3],v_style_r[4],v_style_cues) returning id into v_id;
      exception when unique_violation then raise exception 'Already rated for this visit' using errcode='PT409'; end;
      v_result:=jsonb_build_object('ok',true,'contactId',v_style_contact,'observationId',v_id);
    end if;
  elsif p_action in ('set_assessment','erase_contact') then$new$
  ];
begin
  v_definition:=replace(pg_get_functiondef('public.stockflow_accounts_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'');
  for v_index in 1..array_length(v_anchors,1) loop
    v_anchor:=v_anchors[v_index];
    if (length(v_definition)-length(replace(v_definition,v_anchor,'')))/length(v_anchor)<>1 then
      raise exception 'Unexpected Social Styles gateway anchor %',v_index;
    end if;
    v_definition:=replace(v_definition,v_anchor,v_replacements[v_index]);
  end loop;
  execute v_definition;
end $upgrade$;
revoke all on function public.stockflow_accounts_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_accounts_gateway(text,text,text,jsonb) to service_role;

commit;
