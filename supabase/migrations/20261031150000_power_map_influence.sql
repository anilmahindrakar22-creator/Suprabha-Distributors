begin;

create table private.stockflow_contact_influences (
  id uuid primary key default extensions.gen_random_uuid(),
  customer_id uuid not null references private.stockflow_customers(id),
  from_contact_id uuid not null references private.stockflow_account_contacts(id),
  to_contact_id uuid not null references private.stockflow_account_contacts(id),
  strength text not null check (strength in ('strong','medium','low')),
  evidence text check (evidence is null or char_length(btrim(evidence)) between 3 and 300),
  recorded_by text not null,
  recorded_at timestamptz not null default clock_timestamp(),
  constraint stockflow_contact_influences_distinct_contacts_rule check (from_contact_id<>to_contact_id)
);
create index stockflow_contact_influences_customer_idx on private.stockflow_contact_influences(customer_id,recorded_at,id);
create table private.stockflow_contact_influence_ends (
  influence_id uuid primary key references private.stockflow_contact_influences(id),
  reason text not null check (char_length(btrim(reason)) between 3 and 300),
  ended_by text not null,
  ended_at timestamptz not null default clock_timestamp(),
  constraint stockflow_contact_influence_ends_reason_rule check (char_length(btrim(reason)) between 3 and 300)
);
alter table private.stockflow_contact_influences enable row level security;
alter table private.stockflow_contact_influence_ends enable row level security;
revoke all on private.stockflow_contact_influences,private.stockflow_contact_influence_ends from public,anon,authenticated;

create or replace function private.stockflow_contact_influence_guard() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
 if tg_op='UPDATE' and tg_table_name='stockflow_contact_influences' then
  if new.evidence is null and (to_jsonb(new)-'evidence')=(to_jsonb(old)-'evidence') then return new; end if;
 end if;
 raise exception 'Influence history is immutable except for personal value erasure' using errcode='42501';
end$$;
revoke all on function private.stockflow_contact_influence_guard() from public,anon,authenticated,service_role;
create trigger stockflow_contact_influences_immutable before update or delete on private.stockflow_contact_influences
 for each row execute function private.stockflow_contact_influence_guard();
create trigger stockflow_contact_influence_ends_immutable before update or delete on private.stockflow_contact_influence_ends
 for each row execute function private.stockflow_contact_influence_guard();

create or replace function private.stockflow_contact_influence_erasure() returns trigger
language plpgsql set search_path=pg_catalog,private as $$
begin
 if new.action='erased' then
  update private.stockflow_contact_influences set evidence=null
   where from_contact_id=new.contact_id or to_contact_id=new.contact_id;
 end if;
 return new;
end$$;
revoke all on function private.stockflow_contact_influence_erasure() from public,anon,authenticated,service_role;
create trigger stockflow_contact_influence_erasure after insert on private.stockflow_account_contact_events
 for each row execute function private.stockflow_contact_influence_erasure();

create or replace function private.stockflow_power_route(p_customer uuid) returns jsonb
language sql stable set search_path=pg_catalog,private as $$
 with recursive current_contacts as materialized (
  select c.id,c.name,coalesce(a.decision_role,'unknown') decision_role,
   coalesce(a.stance,'unknown') stance,coalesce(a.influence,'unknown') influence
  from private.stockflow_account_contacts c
  left join lateral(select decision_role,stance,influence from private.stockflow_contact_assessments
    where contact_id=c.id order by recorded_at desc,id desc limit 1) a on true
  where c.customer_id=p_customer and c.removed_at is null
 ), start_contact as (
  select id from current_contacts where stance='supporter'
  order by case decision_role when 'champion' then 0 when 'coach' then 1 else 2 end,
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
  select * from walk where hops>0 and path_roles[array_length(path_roles,1)]='decision_maker'
  order by hops,strong_count desc,path_key limit 1
 ), direct_start as (
  select w.* from walk w where w.hops=0 and w.path_roles[1]='decision_maker'
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

create or replace function public.stockflow_power_map_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,extensions as $$
declare actor text:=lower(btrim(p_actor_email)); roles text[]; secret_hash text; request_key text; replay jsonb;
 result jsonb; entity uuid; customer_entity uuid; from_entity uuid; to_entity uuid; influence_entity uuid;
 influence_row private.stockflow_contact_influences%rowtype; contact_data jsonb; link_data jsonb; supplied_data jsonb;
begin
 select secret_sha256 into secret_hash from private.stockflow_gateway_config where name='orders';
 if secret_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>secret_hash then raise exception 'Unauthorized gateway' using errcode='42501';end if;
 roles:=private.stockflow_active_member_roles(actor);
 if not coalesce(roles&&array['administrator','management'],false) then raise exception 'Power map access required' using errcode='PT403';end if;
 if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid power map request' using errcode='22023';end if;
 if p_action='get_power_map' then
  if coalesce(p_payload->>'customerId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Invalid customer' using errcode='22023';end if;
  customer_entity:=(p_payload->>'customerId')::uuid;
  if not exists(select 1 from private.stockflow_customers where id=customer_entity) then raise exception 'Customer not found' using errcode='22023';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'businessRole',c.business_role,'decisionRole',coalesce(a.decision_role,'unknown'),
   'stance',coalesce(a.stance,'unknown'),'influence',coalesce(a.influence,'unknown'),'lastMetOn',private.stockflow_contact_last_met(c.id)) order by c.name,c.id),'[]'::jsonb)
   into contact_data from private.stockflow_account_contacts c
   left join lateral(select decision_role,stance,influence from private.stockflow_contact_assessments where contact_id=c.id order by recorded_at desc,id desc limit 1) a on true
   where c.customer_id=customer_entity and c.removed_at is null;
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'fromContactId',i.from_contact_id,'toContactId',i.to_contact_id,
   'strength',i.strength,'evidence',i.evidence,'recordedBy',i.recorded_by,'recordedAt',i.recorded_at) order by i.recorded_at,i.id),'[]'::jsonb)
   into link_data from private.stockflow_contact_influences i left join private.stockflow_contact_influence_ends e on e.influence_id=i.id
   where i.customer_id=customer_entity and e.influence_id is null;
  return jsonb_build_object('contacts',contact_data,'links',link_data,'route',private.stockflow_power_route(customer_entity));
 end if;
 if p_action not in ('set_influence','end_influence') then raise exception 'Unsupported power map command' using errcode='22023';end if;
 request_key:=p_payload->>'requestId';
 replay:=private.begin_stockflow_command(actor,p_action,request_key,p_payload);if replay is not null then return replay;end if;
 if p_action='set_influence' then
  if coalesce(p_payload->>'customerId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or coalesce(p_payload->>'fromContactId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or coalesce(p_payload->>'toContactId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
   raise exception 'Invalid influence contacts' using errcode='22023';end if;
  customer_entity:=(p_payload->>'customerId')::uuid;from_entity:=(p_payload->>'fromContactId')::uuid;to_entity:=(p_payload->>'toContactId')::uuid;
  if from_entity=to_entity then raise exception 'Influence contacts must differ' using errcode='22023';end if;
  if not exists(select 1 from private.stockflow_account_contacts where id=from_entity and customer_id=customer_entity and removed_at is null)
   or not exists(select 1 from private.stockflow_account_contacts where id=to_entity and customer_id=customer_entity and removed_at is null) then
   raise exception 'Influence contacts must be current contacts of this customer' using errcode='22023';end if;
  perform 1 from private.stockflow_customers where id=customer_entity for update;
  if jsonb_typeof(p_payload->'strength') is distinct from 'string' or p_payload->>'strength' not in ('strong','medium','low')
   or jsonb_typeof(p_payload->'evidence') is distinct from 'string' or char_length(btrim(p_payload->>'evidence')) not between 3 and 300 then
   raise exception 'Invalid influence strength or evidence' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended('influence:'||from_entity::text||':'||to_entity::text,0));
  insert into private.stockflow_contact_influence_ends(influence_id,reason,ended_by)
   select i.id,'Replaced',actor from private.stockflow_contact_influences i where i.from_contact_id=from_entity and i.to_contact_id=to_entity
   and not exists(select 1 from private.stockflow_contact_influence_ends e where e.influence_id=i.id);
  insert into private.stockflow_contact_influences(customer_id,from_contact_id,to_contact_id,strength,evidence,recorded_by)
   values(customer_entity,from_entity,to_entity,p_payload->>'strength',btrim(p_payload->>'evidence'),actor) returning * into influence_row;
  entity:=influence_row.id;
  result:=jsonb_build_object('id',influence_row.id,'fromContactId',from_entity,'toContactId',to_entity,'strength',influence_row.strength,
   'evidence',influence_row.evidence,'recordedBy',actor,'recordedAt',influence_row.recorded_at);
 else
  if coalesce(p_payload->>'influenceId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or char_length(btrim(coalesce(p_payload->>'reason',''))) not between 3 and 300 then raise exception 'Invalid influence end' using errcode='22023';end if;
  influence_entity:=(p_payload->>'influenceId')::uuid;
  select * into influence_row from private.stockflow_contact_influences where id=influence_entity;
  if not found then raise exception 'Influence not found' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended('influence:'||influence_row.from_contact_id::text||':'||influence_row.to_contact_id::text,0));
  insert into private.stockflow_contact_influence_ends(influence_id,reason,ended_by)
   values(influence_entity,btrim(p_payload->>'reason'),actor) on conflict do nothing;
  if not found then raise exception 'Influence already ended' using errcode='PT409';end if;
  entity:=influence_entity;result:=jsonb_build_object('influenceId',influence_entity,'ended',true);
 end if;
 insert into private.stockflow_economic_audit(action,entity_id,actor,payload) values(p_action,entity,actor,p_payload);
 perform private.finish_stockflow_command(actor,p_action,request_key,p_payload,entity,result);
 return result;
end$$;
revoke all on function public.stockflow_power_map_gateway(text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.stockflow_power_map_gateway(text,text,text,jsonb) to service_role;
commit;
