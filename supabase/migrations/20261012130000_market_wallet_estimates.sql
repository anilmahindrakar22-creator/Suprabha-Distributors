begin;

create table private.stockflow_wallet_divisions (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 60),
  active boolean not null default true,
  sort_order integer not null default 100 check (sort_order between 0 and 10000),
  version integer not null default 1 check (version>0),
  created_by_email text not null, created_at timestamptz not null default clock_timestamp(),
  updated_by_email text not null, updated_at timestamptz not null default clock_timestamp()
);
create unique index stockflow_wallet_divisions_name_idx on private.stockflow_wallet_divisions(lower(btrim(name)));
create table private.stockflow_wallet_division_events (
  id uuid primary key default extensions.gen_random_uuid(),
  division_id uuid not null references private.stockflow_wallet_divisions(id) on delete restrict,
  event_type text not null check (event_type in ('created','updated')),
  old_name text, new_name text not null, old_active boolean, new_active boolean not null,
  actor_email text not null, request_id text not null, created_at timestamptz not null default clock_timestamp()
);
create table private.stockflow_wallet_estimates (
  id uuid primary key default extensions.gen_random_uuid(),
  customer_id uuid not null references private.stockflow_customers(id) on delete restrict,
  division_id uuid not null references private.stockflow_wallet_divisions(id) on delete restrict,
  monthly_wallet_paise bigint not null check (monthly_wallet_paise between 0 and 1000000000000),
  method text not null check (method in ('customer_stated','test_volume','manager_estimate')),
  confidence text not null check (confidence in ('high','medium','low')),
  note text not null check (char_length(btrim(note)) between 3 and 500),
  as_of date not null, created_by_email text not null, request_id text not null,
  created_at timestamptz not null default clock_timestamp()
);
create index stockflow_wallet_estimates_current_idx on private.stockflow_wallet_estimates(customer_id,division_id,as_of desc,created_at desc,id desc);
alter table private.stockflow_wallet_divisions enable row level security;
alter table private.stockflow_wallet_division_events enable row level security;
alter table private.stockflow_wallet_estimates enable row level security;
revoke all on private.stockflow_wallet_divisions,private.stockflow_wallet_division_events,private.stockflow_wallet_estimates from public,anon,authenticated;
create trigger stockflow_wallet_divisions_no_delete before delete on private.stockflow_wallet_divisions for each row execute function private.prevent_business_delete();
create trigger stockflow_wallet_division_events_immutable before update or delete on private.stockflow_wallet_division_events for each row execute function private.prevent_order_event_mutation();
create trigger stockflow_wallet_estimates_immutable before update or delete on private.stockflow_wallet_estimates for each row execute function private.prevent_order_event_mutation();
insert into private.stockflow_wallet_divisions(name,sort_order,created_by_email,updated_by_email) values
  ('Biochemistry',10,'system:migration','system:migration'), ('Haematology',20,'system:migration','system:migration'),
  ('Immunoassay',30,'system:migration','system:migration'), ('Electrolytes',40,'system:migration','system:migration'),
  ('Coagulation',50,'system:migration','system:migration'), ('Urine',60,'system:migration','system:migration'), ('Other',70,'system:migration','system:migration');

create function public.stockflow_wallet_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, private, extensions as $$
declare
  v_email text := lower(btrim(coalesce(p_actor_email,''))); v_role text; v_roles text[]; v_hash text;
  v_division private.stockflow_wallet_divisions%rowtype; v_estimate private.stockflow_wallet_estimates%rowtype;
  v_customer uuid; v_division_id uuid; v_name text; v_active boolean; v_sort integer; v_expected integer;
  v_old_name text; v_old_active boolean; v_event text; v_paise bigint; v_date date;
  v_method text; v_confidence text; v_note text; v_key text; v_replay jsonb; v_result jsonb; v_aggregate uuid;
begin
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_hash then raise exception 'Unauthorized gateway' using errcode='42501'; end if;
  select role, roles into v_role, v_roles from public.stockflow_members where email=v_email and status='active';
  if not private.stockflow_valid_roles(v_roles) or not (v_roles && array['administrator','management']::text[]) then raise exception 'Market access requires administrator or management' using errcode='42501'; end if;
  if p_action is null or p_action not in ('get_wallet_divisions','set_wallet_division','record_wallet_estimate','get_customer_wallet') then raise exception 'Unsupported wallet action' using errcode='22023'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid wallet payload' using errcode='22023'; end if;
  if p_action='get_wallet_divisions' then
    return jsonb_build_object('divisions',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'active',active,'sortOrder',sort_order,'version',version) order by sort_order,name) from private.stockflow_wallet_divisions),'[]'::jsonb));
  end if;
  if p_action in ('get_customer_wallet','record_wallet_estimate') then
    if jsonb_typeof(p_payload->'customerId') is distinct from 'string' or (p_payload->>'customerId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Customer required' using errcode='22023'; end if;
    v_customer:=(p_payload->>'customerId')::uuid;
    if not exists(select 1 from private.stockflow_customers where id=v_customer) then raise exception 'Customer required' using errcode='22023'; end if;
  end if;
  if p_action='get_customer_wallet' then
    with current_estimates as (
      select distinct on (division_id) * from private.stockflow_wallet_estimates where customer_id=v_customer
      order by division_id,as_of desc,created_at desc,id desc
    ), history_estimates as (
      select * from private.stockflow_wallet_estimates where customer_id=v_customer order by created_at desc,id desc limit 50
    ), rows as (
      select e.*,d.sort_order,d.name,jsonb_build_object('division',jsonb_build_object('id',d.id,'name',d.name,'active',d.active),
        'monthlyWalletPaise',e.monthly_wallet_paise::text,'method',e.method,'confidence',e.confidence,'note',e.note,
        'asOf',e.as_of,'createdAt',e.created_at,'createdBy',e.created_by_email) as value
      from private.stockflow_wallet_estimates e join private.stockflow_wallet_divisions d on d.id=e.division_id
      where e.id in (select id from current_estimates union all select id from history_estimates)
    ) select jsonb_build_object(
      'current',coalesce((select jsonb_agg(r.value order by r.sort_order,r.name,r.division_id) from rows r join current_estimates c on c.id=r.id),'[]'::jsonb),
      'totalMonthlyWalletPaise',(select coalesce(sum(monthly_wallet_paise),0)::text from current_estimates),
      'history',coalesce((select jsonb_agg(r.value order by r.created_at desc,r.id desc) from rows r join history_estimates h on h.id=r.id),'[]'::jsonb)) into v_result;
    return v_result;
  end if;
  v_key:=p_payload->>'idempotencyKey';
  if jsonb_typeof(p_payload->'idempotencyKey') is distinct from 'string' or char_length(v_key)>200 then raise exception 'Invalid idempotency key' using errcode='22023'; end if;
  v_replay:=private.begin_stockflow_command(v_email,p_action,v_key,p_payload);
  if v_replay is not null then return v_replay; end if;
  if p_action='set_wallet_division' then
    v_name:=btrim(p_payload->>'name');
    if jsonb_typeof(p_payload->'name') is distinct from 'string' or char_length(v_name) not between 2 and 60
      or jsonb_typeof(p_payload->'active') is distinct from 'boolean' then raise exception 'Invalid division' using errcode='22023'; end if;
    v_active:=(p_payload->>'active')::boolean;
    if p_payload ? 'sortOrder' then
      if jsonb_typeof(p_payload->'sortOrder') is distinct from 'number' or (p_payload->>'sortOrder') !~ '^[0-9]{1,5}$' then raise exception 'Invalid sort order' using errcode='22023'; end if;
      v_sort:=(p_payload->>'sortOrder')::integer;
      if v_sort>10000 then raise exception 'Invalid sort order' using errcode='22023'; end if;
    end if;
    if p_payload ? 'expectedVersion' then
      if jsonb_typeof(p_payload->'expectedVersion') is distinct from 'number' or (p_payload->>'expectedVersion') !~ '^[0-9]+$' then raise exception 'Invalid expected version' using errcode='22023'; end if;
      begin v_expected:=(p_payload->>'expectedVersion')::integer;
      exception when numeric_value_out_of_range then raise exception 'Invalid expected version' using errcode='22023'; end;
      if v_expected<1 then raise exception 'Invalid expected version' using errcode='22023'; end if;
    end if;
    begin
      if not (p_payload ? 'divisionId') then
        insert into private.stockflow_wallet_divisions(name,active,sort_order,created_by_email,updated_by_email)
          values(v_name,v_active,coalesce(v_sort,100),v_email,v_email) returning * into v_division;
        v_event:='created';
      else
        if jsonb_typeof(p_payload->'divisionId') is distinct from 'string' or (p_payload->>'divisionId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Invalid division' using errcode='22023'; end if;
        select * into v_division from private.stockflow_wallet_divisions where id=(p_payload->>'divisionId')::uuid for update;
        if not found or v_expected is distinct from v_division.version then raise exception 'Division changed; refresh and try again' using errcode='PT409'; end if;
        v_old_name:=v_division.name; v_old_active:=v_division.active;
        update private.stockflow_wallet_divisions set name=v_name,active=v_active,sort_order=coalesce(v_sort,sort_order),
          version=version+1,updated_by_email=v_email,updated_at=clock_timestamp() where id=v_division.id returning * into v_division;
        v_event:='updated';
      end if;
    exception when unique_violation then raise exception 'Division name already used' using errcode='22023'; end;
    insert into private.stockflow_wallet_division_events(division_id,event_type,old_name,new_name,old_active,new_active,actor_email,request_id)
      values(v_division.id,v_event,v_old_name,v_division.name,v_old_active,v_division.active,v_email,v_key);
    v_aggregate:=v_division.id;
    v_result:=jsonb_build_object('ok',true,'division',jsonb_build_object('id',v_division.id,'name',v_division.name,'active',v_division.active,'sortOrder',v_division.sort_order,'version',v_division.version));
  else
    if jsonb_typeof(p_payload->'divisionId') is distinct from 'string' or (p_payload->>'divisionId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Active division required' using errcode='22023'; end if;
    v_division_id:=(p_payload->>'divisionId')::uuid;
    -- Share locks serialize recording with concurrent deactivation until commit.
    perform 1 from private.stockflow_customers where id=v_customer and active for share;
    if not found then raise exception 'Active customer required' using errcode='22023'; end if;
    perform 1 from private.stockflow_wallet_divisions where id=v_division_id and active for share;
    if not found then raise exception 'Active division required' using errcode='22023'; end if;
    if jsonb_typeof(p_payload->'monthlyWalletPaise') is distinct from 'string' or (p_payload->>'monthlyWalletPaise') !~ '^[0-9]{1,13}$' then raise exception 'Invalid monthly wallet' using errcode='22023'; end if;
    v_paise:=(p_payload->>'monthlyWalletPaise')::bigint;
    if v_paise>1000000000000 then raise exception 'Invalid monthly wallet' using errcode='22023'; end if;
    if jsonb_typeof(p_payload->'asOf') is distinct from 'string' or (p_payload->>'asOf') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Invalid estimate date' using errcode='22023'; end if;
    begin v_date:=(p_payload->>'asOf')::date;
    exception when invalid_datetime_format or datetime_field_overflow then raise exception 'Invalid estimate date' using errcode='22023'; end;
    if v_date<'2000-01-01'::date or v_date>(now() at time zone 'Asia/Kolkata')::date then raise exception 'Invalid estimate date' using errcode='22023'; end if;
    v_method:=p_payload->>'method'; v_confidence:=p_payload->>'confidence'; v_note:=btrim(p_payload->>'note');
    if v_method is null or v_method not in ('customer_stated','test_volume','manager_estimate')
      or v_confidence is null or v_confidence not in ('high','medium','low')
      or jsonb_typeof(p_payload->'note') is distinct from 'string' or char_length(v_note) not between 3 and 500 then raise exception 'Invalid estimate details' using errcode='22023'; end if;
    insert into private.stockflow_wallet_estimates(customer_id,division_id,monthly_wallet_paise,method,confidence,note,as_of,created_by_email,request_id)
      values(v_customer,v_division_id,v_paise,v_method,v_confidence,v_note,v_date,v_email,v_key) returning * into v_estimate;
    v_aggregate:=v_estimate.id;
    v_result:=jsonb_build_object('ok',true,'estimate',jsonb_build_object('id',v_estimate.id,'customerId',v_customer,'divisionId',v_division_id,
      'monthlyWalletPaise',v_estimate.monthly_wallet_paise::text,'method',v_method,'confidence',v_confidence,'note',v_note,
      'asOf',v_date,'createdAt',v_estimate.created_at,'createdBy',v_email));
  end if;
  perform private.finish_stockflow_command(v_email,p_action,v_key,p_payload,v_aggregate,v_result);
  return v_result;
end $$;
revoke all on function public.stockflow_wallet_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_wallet_gateway(text,text,text,jsonb) to service_role;

commit;
