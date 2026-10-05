begin;
-- Keep the pending-union membership constraint: this prepares governance, not activation.
create or replace function private.populate_stockflow_member_event_roles()
returns trigger language plpgsql set search_path=pg_catalog,private as $$
begin
  if new.previous_roles is null and new.previous_role is not null then new.previous_roles:=array[new.previous_role]; end if;
  if new.new_roles is null then new.new_roles:=array[new.new_role]; end if;
  if not private.stockflow_valid_roles(new.new_roles) or not (new.new_role=any(new.new_roles)) or
    (new.previous_role is not null and (not private.stockflow_valid_roles(new.previous_roles) or not (new.previous_role=any(new.previous_roles)))) then
    raise exception 'Invalid role audit' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function private.populate_stockflow_member_event_roles() from public,anon,authenticated;
do $migration$
declare f text; pair text[];
begin
 select pg_get_functiondef('public.stockflow_user_gateway(text,text,text,jsonb)'::regprocedure) into f;
 -- Production's historical gateway omitted the existing request-id audit column.
 -- Normalize that exact legacy seam before adding role-set audit provenance.
 if position('previous_status, new_status, actor_email)' in f)>0 then
  if position('v_previous.status, v_status, v_actor_email);' in f)=0 then
   raise exception 'Legacy member audit value seam missing';
  end if;
  f:=replace(f,'previous_status, new_status, actor_email)',
    'previous_status, new_status, actor_email, request_id)');
  f:=replace(f,'v_previous.status, v_status, v_actor_email);',
    'v_previous.status, v_status, v_actor_email, v_idempotency_key);');
 end if;
 foreach pair slice 1 in array array[
  array['v_previous public.stockflow_members%rowtype;','v_previous public.stockflow_members%rowtype; v_new_roles text[];'],
  array['if v_actor_role <> ''administrator'' then','if not (''administrator''=any(v_actor_roles)) then'],
  array['if v_actor_role not in (''administrator'',''operations'',''management'') then',
    'if not (v_actor_roles && array[''administrator'',''operations'',''management'']::text[]) then'],
  array['''id'', id, ''email'', email, ''role'', role, ''status'', status, ''updatedAt'', updated_at',
    '''id'', id, ''email'', email, ''role'', role, ''roles'', roles, ''status'', status, ''updatedAt'', updated_at'],
  array['and role <> ''viewer''','and private.stockflow_valid_roles(roles) and roles <> array[''viewer'']::text[]'],
  array['v_status := p_payload->>''status'';',
    'v_status := p_payload->>''status'';
  if p_payload ? ''roles'' then
    if jsonb_typeof(p_payload->''roles'') is distinct from ''array'' then raise exception ''Invalid user roles'' using errcode=''22023''; end if;
    select array_agg(value) into v_new_roles from jsonb_array_elements_text(p_payload->''roles'');
  else v_new_roles:=array[v_role]; end if;
  if not private.stockflow_valid_roles(v_new_roles) or v_role is null or not (v_role=any(v_new_roles)) then
    raise exception ''Invalid user roles'' using errcode=''22023''; end if;'],
  array['(v_role <> ''administrator'' or v_status <> ''active'')','(not (''administrator''=any(v_new_roles)) or v_status <> ''active'')'],
  array['select * into v_previous from public.stockflow_members where email = v_email for update;',
    'perform pg_advisory_xact_lock(hashtextextended(''stockflow-member:''||v_email,0));
  select * into v_previous from public.stockflow_members where email = v_email for update;
  if v_previous.id is not null then
    if p_payload ? ''roles'' then
      if (p_payload->>''expectedUpdatedAt'')::timestamptz is distinct from v_previous.updated_at then
        raise exception ''User changed; reload before saving'' using errcode=''PT409''; end if;
    elsif v_previous.roles <> array[v_previous.role] then
      raise exception ''Combined roles require a current role-set request'' using errcode=''PT409'';
    end if;
  elsif p_payload->>''expectedUpdatedAt'' is not null then
    raise exception ''User changed; reload before saving'' using errcode=''PT409'';
  end if;'],
  array['insert into public.stockflow_members(email, role, status, updated_at)',
    'insert into public.stockflow_members(email, role, roles, status, updated_at)'],
  array['values (v_email, v_role, v_status, now())','values (v_email, v_role, v_new_roles, v_status, clock_timestamp())'],
  array['set role = excluded.role, status = excluded.status, updated_at = now();',
    'set role = excluded.role, roles = excluded.roles, status = excluded.status, updated_at = clock_timestamp();'],
  array['previous_status, new_status, actor_email, request_id','previous_status, new_status, actor_email, request_id, previous_roles, new_roles'],
  array['v_previous.status, v_status, v_actor_email, v_idempotency_key',
    'v_previous.status, v_status, v_actor_email, v_idempotency_key, v_previous.roles, v_new_roles'],
  array['''email'', v_email, ''role'', v_role, ''status'', v_status',
    '''email'', v_email, ''role'', v_role, ''roles'', v_new_roles, ''status'', v_status']
 ] loop
  if position(pair[1] in f)=0 then raise exception 'Governed member seam missing: %',pair[1]; end if;
  f:=replace(f,pair[1],pair[2]);
 end loop;
 execute f;
end $migration$;
revoke all on function public.stockflow_user_gateway(text,text,text,jsonb) from public,anon,authenticated;
commit;
