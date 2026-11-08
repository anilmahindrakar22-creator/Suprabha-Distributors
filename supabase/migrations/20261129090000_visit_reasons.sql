begin;

create table private.stockflow_visit_reasons (
  visit_id uuid primary key references private.stockflow_customer_visits(id),
  customer_id uuid not null references private.stockflow_customers(id),
  category text not null check (category in ('price','portfolio','instrument','service','relationship','credit','availability','competitor_lock_in','contract_tender','unknown','none')),
  source text check (source in ('lab_said','our_view')),
  recorded_by text not null,
  recorded_at timestamptz not null default now(),
  constraint stockflow_visit_reasons_source_rule check ((category='none' and source is null) or (category<>'none' and source is not null))
);
create index stockflow_visit_reasons_customer_idx on private.stockflow_visit_reasons(customer_id,recorded_at desc,visit_id);
alter table private.stockflow_visit_reasons enable row level security;
revoke all on private.stockflow_visit_reasons from public,anon,authenticated,service_role;

-- Refuse definition drift; preserve all existing gateway checks and transaction receipts.
do $patch$
declare definition text; old_text text; new_text text;
begin
  definition:=replace(pg_get_functiondef('public.stockflow_accounts_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'');
  old_text:=$old$      insert into private.stockflow_customer_visits(customer_id,visited_on,visited_by,outcome,note,next_visit_on,request_id)$old$;
  new_text:=$new$      if p_payload ? 'reason' and p_payload->'reason'<>'null'::jsonb then
        if jsonb_typeof(p_payload->'reason') is distinct from 'object' then
          raise exception 'Invalid visit reason' using errcode='22023';
        end if;
        if not ((p_payload->'reason') ?& array['category','source'])
          or (p_payload->'reason')-array['category','source']<>'{}'::jsonb
          or jsonb_typeof(p_payload#>'{reason,category}') is distinct from 'string'
          or p_payload#>>'{reason,category}' not in ('price','portfolio','instrument','service','relationship','credit','availability','competitor_lock_in','contract_tender','unknown','none') then
          raise exception 'Invalid visit reason' using errcode='22023';
        end if;
        if p_payload#>>'{reason,category}'='none' then
          if p_payload#>'{reason,source}' is distinct from 'null'::jsonb then
            raise exception 'Invalid visit reason' using errcode='22023';
          end if;
        elsif jsonb_typeof(p_payload#>'{reason,source}') is distinct from 'string'
          or p_payload#>>'{reason,source}' not in ('lab_said','our_view') then
          raise exception 'Invalid visit reason' using errcode='22023';
        end if;
      end if;
      insert into private.stockflow_customer_visits(customer_id,visited_on,visited_by,outcome,note,next_visit_on,request_id)$new$;
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected log_visit validation anchor';end if;
  definition:=replace(definition,old_text,new_text);
  old_text:=$old$      update private.stockflow_visit_checkins set visit_id=v_id where id=(
        select id from private.stockflow_visit_checkins
        where customer_id=v_customer and checked_in_by=v_email and visit_id is null
          and (checked_in_at at time zone 'Asia/Kolkata')::date=v_visited
        order by checked_in_at desc,id desc limit 1 for update);$old$;
  new_text:=old_text||$new$
      if p_payload ? 'reason' and p_payload->'reason'<>'null'::jsonb then
        insert into private.stockflow_visit_reasons(visit_id,customer_id,category,source,recorded_by)
          values(v_id,v_customer,p_payload#>>'{reason,category}',p_payload#>>'{reason,source}',v_email);
      end if;$new$;
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected log_visit check-in link anchor';end if;
  definition:=replace(definition,old_text,new_text);
  execute definition;

  definition:=replace(pg_get_functiondef('public.stockflow_my_actions_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'');
  old_text:=$old$  if jsonb_typeof(visit_data) is distinct from 'object' or (select count(*) from jsonb_object_keys(visit_data))<>2$old$;
  new_text:=$new$  if jsonb_typeof(visit_data) is distinct from 'object' or (select count(*) from jsonb_object_keys(visit_data))<>(case when visit_data ? 'reason' then 3 else 2 end)$new$;
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected my actions visit keys anchor';end if;
  definition:=replace(definition,old_text,new_text);
  old_text:=$old$   'outcome',visit_outcome,'note',left(p_payload->>'note',500),'nextVisitOn',visit_data->'nextVisitOn'));$old$;
  new_text:=$new$   'outcome',visit_outcome,'note',left(p_payload->>'note',500),'nextVisitOn',visit_data->'nextVisitOn')
   ||case when visit_data ? 'reason' then jsonb_build_object('reason',visit_data->'reason') else '{}'::jsonb end);$new$;
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected my actions log_visit payload anchor';end if;
  definition:=replace(definition,old_text,new_text);
  execute definition;

  definition:=replace(pg_get_functiondef('public.stockflow_opportunity_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'');
  old_text:=$old$'lastVisitOn',(select max(visited_on) from private.stockflow_customer_visits where customer_id=customer),$old$;
  new_text:=old_text||$new$
   'visitReasons',(select coalesce(jsonb_agg(recent_reasons.item order by recent_reasons.visited_on desc,recent_reasons.recorded_at desc,recent_reasons.visit_id desc),'[]'::jsonb) from (
    select jsonb_build_object('visitedOn',v.visited_on,'visitedBy',v.visited_by,'category',r.category,'source',r.source) item,
      v.visited_on,r.recorded_at,r.visit_id
    from private.stockflow_visit_reasons r join private.stockflow_customer_visits v on v.id=r.visit_id
    where r.customer_id=customer and r.recorded_at>=now()-interval '180 days'
    order by v.visited_on desc,r.recorded_at desc,r.visit_id desc limit 5
   ) recent_reasons),$new$;
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected account signals lastVisitOn anchor';end if;
  definition:=replace(definition,old_text,new_text);
  execute definition;
end $patch$;
revoke all on function public.stockflow_accounts_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_accounts_gateway(text,text,text,jsonb) to service_role;
revoke all on function public.stockflow_my_actions_gateway(text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.stockflow_my_actions_gateway(text,text,text,jsonb) to service_role;
revoke all on function public.stockflow_opportunity_gateway(text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.stockflow_opportunity_gateway(text,text,text,jsonb) to service_role;
commit;
notify pgrst,'reload schema';
