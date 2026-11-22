begin;

alter table private.stockflow_company_letterhead
  add column logo_data bytea check (logo_data is null or octet_length(logo_data) between 100 and 40960),
  add column logo_type text check (logo_type is null or logo_type in ('image/png','image/jpeg')),
  add check ((logo_data is null) = (logo_type is null)),
  add column terms text[] not null default '{}' check (cardinality(terms) <= 5),
  add column extras_version integer not null default 1 check (extras_version > 0);

create table private.stockflow_letterhead_extras_events (
  id bigint generated always as identity primary key,
  version integer not null,
  actor_email text not null,
  before jsonb not null,
  after jsonb not null,
  created_at timestamptz not null default now()
);
create trigger no_delete before delete on private.stockflow_letterhead_extras_events
  for each row execute function private.prevent_business_delete();
create trigger immutable before update on private.stockflow_letterhead_extras_events
  for each row execute function private.prevent_immutable_pricing_update();
alter table private.stockflow_letterhead_extras_events enable row level security;
revoke all on private.stockflow_letterhead_extras_events from public,anon,authenticated,service_role;

create function public.stockflow_letterhead_extras_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=pg_catalog,private,extensions as $$
declare
  v_actor text:=lower(btrim(coalesce(p_actor_email,''))); v_hash text; v_roles text[];
  v_key text; v_expected numeric; v_logo bytea; v_type text; v_terms text[]:='{}'; v_term jsonb;
  v_before jsonb; v_after jsonb; v_result jsonb;
  v_row private.stockflow_company_letterhead%rowtype;
begin
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_hash then
    raise exception 'Unauthorized gateway' using errcode='42501'; end if;
  select roles into v_roles from public.stockflow_members where email=v_actor and status='active';
  if not private.stockflow_valid_roles(v_roles) or not coalesce(v_roles && array['administrator','management','operations'],false) then
    raise exception 'Role cannot manage purchase orders' using errcode='42501'; end if;
  if p_action is null or p_action not in ('get_letterhead_extras','set_letterhead_extras') then
    raise exception 'Invalid letterhead extras action' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('stockflow_purchase_actor:'||v_actor,0));
  if (select count(*) from private.stockflow_request_log where actor_email=v_actor and created_at>=now()-interval '1 minute')>=30 then
    raise exception 'Too many order requests' using errcode='54000'; end if;
  insert into private.stockflow_request_log(actor_email,action) values(v_actor,p_action);

  if p_action='get_letterhead_extras' then
    if p_payload is distinct from '{}'::jsonb then
      raise exception 'Invalid letterhead extras' using errcode='22023'; end if;
  else
    if not ('administrator'=any(v_roles)) then
      raise exception 'Only an administrator can change the letterhead' using errcode='42501'; end if;
    if jsonb_typeof(p_payload) is distinct from 'object' then
      raise exception 'Invalid letterhead extras' using errcode='22023'; end if;
    if not (p_payload ?& array['idempotencyKey','expectedVersion','logo','terms']) or
      p_payload-array['idempotencyKey','expectedVersion','logo','terms']<>'{}'::jsonb or
      jsonb_typeof(p_payload->'idempotencyKey') is distinct from 'string' or
      jsonb_typeof(p_payload->'expectedVersion') is distinct from 'number' or
      jsonb_typeof(p_payload->'logo') not in ('object','null') or
      jsonb_typeof(p_payload->'terms') is distinct from 'array' then
      raise exception 'Invalid letterhead extras' using errcode='22023'; end if;
    v_key:=p_payload->>'idempotencyKey';
    v_expected:=(p_payload->>'expectedVersion')::numeric;
    if v_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or
      v_expected<>trunc(v_expected) or v_expected not between 1 and 2147483647 or
      jsonb_array_length(p_payload->'terms')>5 then
      raise exception 'Invalid letterhead extras' using errcode='22023'; end if;
    for v_term in select value from jsonb_array_elements(p_payload->'terms') loop
      if jsonb_typeof(v_term) is distinct from 'string' or
        char_length(btrim(v_term#>>'{}')) not between 1 and 200 or (v_term#>>'{}') ~ E'[\r\n]' then
        raise exception 'Invalid letterhead extras' using errcode='22023'; end if;
      v_terms:=array_append(v_terms,btrim(v_term#>>'{}'));
    end loop;
    if p_payload->'logo'<>'null'::jsonb then
      if not ((p_payload->'logo') ?& array['type','base64']) or
        (p_payload->'logo')-array['type','base64']<>'{}'::jsonb or
        jsonb_typeof(p_payload->'logo'->'type') is distinct from 'string' or
        jsonb_typeof(p_payload->'logo'->'base64') is distinct from 'string' then
        raise exception 'Invalid letterhead extras' using errcode='22023'; end if;
      v_type:=p_payload->'logo'->>'type';
      if v_type not in ('image/png','image/jpeg') or char_length(p_payload->'logo'->>'base64')>54616 or
        (p_payload->'logo'->>'base64') !~ '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$' then
        raise exception 'Invalid letterhead extras' using errcode='22023'; end if;
      v_logo:=decode(p_payload->'logo'->>'base64','base64');
      if octet_length(v_logo) not between 100 and 40960 then
        raise exception 'Invalid letterhead extras' using errcode='22023'; end if;
      if (v_type='image/png' and substring(v_logo from 1 for 8)<>decode('89504e470d0a1a0a','hex')) or
        (v_type='image/jpeg' and substring(v_logo from 1 for 3)<>decode('ffd8ff','hex')) then
        raise exception 'Invalid logo' using errcode='22023'; end if;
    end if;
    v_result:=private.begin_stockflow_command(v_actor,p_action,v_key,p_payload);
    if v_result is not null then return v_result; end if;
  end if;
  select * into v_row from private.stockflow_company_letterhead where id=1 for update;
  if p_action='set_letterhead_extras' then
    if v_row.extras_version<>v_expected then
      raise exception 'Letterhead changed; reload' using errcode='PT409'; end if;
    v_before:=jsonb_build_object('logoType',v_row.logo_type,'logoSha256',encode(extensions.digest(v_row.logo_data,'sha256'),'hex'),
      'logoBytes',octet_length(v_row.logo_data),'terms',v_row.terms);
    update private.stockflow_company_letterhead set logo_data=v_logo,logo_type=v_type,terms=v_terms,
      extras_version=extras_version+1 where id=1 returning * into v_row;
    v_after:=jsonb_build_object('logoType',v_row.logo_type,'logoSha256',encode(extensions.digest(v_row.logo_data,'sha256'),'hex'),
      'logoBytes',octet_length(v_row.logo_data),'terms',v_row.terms);
    insert into private.stockflow_letterhead_extras_events(version,actor_email,before,after)
      values(v_row.extras_version,v_actor,v_before,v_after);
  end if;
  v_result:=jsonb_build_object('logo',case when v_row.logo_data is null then null else
    jsonb_build_object('type',v_row.logo_type,'base64',replace(encode(v_row.logo_data,'base64'),E'\n','')) end,
    'terms',v_row.terms,'version',v_row.extras_version);
  if p_action='set_letterhead_extras' then
    perform private.finish_stockflow_command(v_actor,p_action,v_key,p_payload,null,v_result);
  end if;
  return v_result;
exception when check_violation or invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value then
  -- Preserve the intentional magic/type mismatch diagnostic (also SQLSTATE 22023).
  if sqlerrm='Invalid logo' then raise; end if;
  raise exception 'Invalid letterhead extras' using errcode='22023';
end $$;
revoke all on function public.stockflow_letterhead_extras_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_letterhead_extras_gateway(text,text,text,jsonb) to service_role;
commit;
notify pgrst,'reload schema';
