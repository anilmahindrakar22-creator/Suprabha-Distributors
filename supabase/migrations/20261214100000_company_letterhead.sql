begin;

create table private.stockflow_company_letterhead (
  id smallint primary key default 1 check (id=1),
  company_name text not null check (char_length(btrim(company_name)) between 1 and 120),
  address text not null default '' check (char_length(address)<=400),
  gstin text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  phone text not null default '' check (char_length(phone)<=40),
  delivery_address text not null default '' check (char_length(delivery_address)<=400),
  version integer not null default 1 check (version>0),
  updated_by_email text,
  updated_at timestamptz not null default now()
);
insert into private.stockflow_company_letterhead(id,company_name) values(1,'Suprabha Distributors');
create table private.stockflow_letterhead_events (
  id bigint generated always as identity primary key,
  version integer not null,
  actor_email text not null,
  before jsonb not null,
  after jsonb not null,
  created_at timestamptz not null default now()
);
create trigger no_delete before delete on private.stockflow_letterhead_events
  for each row execute function private.prevent_business_delete();
create trigger immutable before update on private.stockflow_letterhead_events
  for each row execute function private.prevent_immutable_pricing_update();
alter table private.stockflow_company_letterhead enable row level security;
alter table private.stockflow_letterhead_events enable row level security;
revoke all on private.stockflow_company_letterhead,private.stockflow_letterhead_events from public,anon,authenticated,service_role;

create function public.stockflow_letterhead_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=pg_catalog,private,extensions as $$
declare
  v_actor text:=lower(btrim(coalesce(p_actor_email,''))); v_hash text; v_roles text[];
  v_key text; v_expected numeric; v_gstin text; v_before jsonb; v_result jsonb;
  v_row private.stockflow_company_letterhead%rowtype;
begin
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_hash then
    raise exception 'Unauthorized gateway' using errcode='42501'; end if;
  select roles into v_roles from public.stockflow_members where email=v_actor and status='active';
  if not private.stockflow_valid_roles(v_roles) or not coalesce(v_roles && array['administrator','management','operations'],false) then
    raise exception 'Role cannot manage purchase orders' using errcode='42501'; end if;
  if p_action is null or p_action not in ('get_letterhead','set_letterhead') then
    raise exception 'Invalid letterhead action' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('stockflow_purchase_actor:'||v_actor,0));
  if (select count(*) from private.stockflow_request_log where actor_email=v_actor and created_at>=now()-interval '1 minute')>=30 then
    raise exception 'Too many order requests' using errcode='54000'; end if;
  insert into private.stockflow_request_log(actor_email,action) values(v_actor,p_action);

  if p_action='get_letterhead' then
    if p_payload is distinct from '{}'::jsonb then
      raise exception 'Invalid letterhead' using errcode='22023'; end if;
  else
    if not ('administrator'=any(v_roles)) then
      raise exception 'Only an administrator can change the letterhead' using errcode='42501'; end if;
    if jsonb_typeof(p_payload) is distinct from 'object' then
      raise exception 'Invalid letterhead' using errcode='22023'; end if;
    if not (p_payload ?& array['idempotencyKey','expectedVersion','companyName','address','gstin','phone','deliveryAddress']) or
      p_payload-array['idempotencyKey','expectedVersion','companyName','address','gstin','phone','deliveryAddress']<>'{}'::jsonb or
      jsonb_typeof(p_payload->'idempotencyKey') is distinct from 'string' or
      jsonb_typeof(p_payload->'expectedVersion') is distinct from 'number' or
      jsonb_typeof(p_payload->'companyName') is distinct from 'string' or
      jsonb_typeof(p_payload->'address') is distinct from 'string' or
      jsonb_typeof(p_payload->'phone') is distinct from 'string' or
      jsonb_typeof(p_payload->'deliveryAddress') is distinct from 'string' or
      jsonb_typeof(p_payload->'gstin') not in ('string','null') then
      raise exception 'Invalid letterhead' using errcode='22023'; end if;
    v_key:=p_payload->>'idempotencyKey';
    v_expected:=(p_payload->>'expectedVersion')::numeric;
    v_gstin:=nullif(upper(btrim(p_payload->>'gstin')),'');
    if v_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or
      v_expected<>trunc(v_expected) or v_expected not between 1 and 2147483647 or
      char_length(btrim(p_payload->>'companyName')) not between 1 and 120 or
      char_length(p_payload->>'address')>400 or char_length(p_payload->>'phone')>40 or
      char_length(p_payload->>'deliveryAddress')>400 or
      (v_gstin is not null and v_gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$') then
      raise exception 'Invalid letterhead' using errcode='22023'; end if;
    v_result:=private.begin_stockflow_command(v_actor,p_action,v_key,p_payload);
    if v_result is not null then return v_result; end if;
  end if;
  select * into v_row from private.stockflow_company_letterhead where id=1 for update;
  if p_action='set_letterhead' and v_row.version<>v_expected then
    raise exception 'Letterhead changed; reload' using errcode='PT409'; end if;
  v_result:=jsonb_build_object('companyName',v_row.company_name,'address',v_row.address,'gstin',v_row.gstin,
    'phone',v_row.phone,'deliveryAddress',v_row.delivery_address,'version',v_row.version,'updatedAt',to_jsonb(v_row.updated_at)#>>'{}');
  if p_action='get_letterhead' then return v_result; end if;
  v_before:=v_result;
  update private.stockflow_company_letterhead set company_name=btrim(p_payload->>'companyName'),
    address=btrim(p_payload->>'address'),gstin=v_gstin,phone=btrim(p_payload->>'phone'),
    delivery_address=btrim(p_payload->>'deliveryAddress'),version=version+1,updated_by_email=v_actor,updated_at=now()
    where id=1 returning * into v_row;
  v_result:=jsonb_build_object('companyName',v_row.company_name,'address',v_row.address,'gstin',v_row.gstin,
    'phone',v_row.phone,'deliveryAddress',v_row.delivery_address,'version',v_row.version,'updatedAt',to_jsonb(v_row.updated_at)#>>'{}');
  insert into private.stockflow_letterhead_events(version,actor_email,before,after) values(v_row.version,v_actor,v_before,v_result);
  perform private.finish_stockflow_command(v_actor,p_action,v_key,p_payload,null,v_result);
  return v_result;
exception when check_violation or invalid_text_representation or numeric_value_out_of_range then
  raise exception 'Invalid letterhead' using errcode='22023';
end $$;
revoke all on function public.stockflow_letterhead_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_letterhead_gateway(text,text,text,jsonb) to service_role;
commit;
notify pgrst,'reload schema';
