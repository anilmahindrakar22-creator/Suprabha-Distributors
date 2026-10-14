begin;

create table private.stockflow_account_contacts (
  id uuid primary key default extensions.gen_random_uuid(),
  customer_id uuid not null references private.stockflow_customers(id),
  name text not null check (name=btrim(name) and char_length(name) between 2 and 120),
  business_role text check (char_length(business_role)<=80),
  phone text check (char_length(phone)<=40),
  email text check (char_length(email)<=160 and position('@' in email)>0),
  added_by text not null, added_at timestamptz not null default now(),
  updated_by text, updated_at timestamptz,
  removed_at timestamptz, removed_by text,
  version integer not null default 1 check (version>0)
);
create index stockflow_account_contacts_active_idx on private.stockflow_account_contacts(customer_id,added_at,id) where removed_at is null;
create table private.stockflow_account_contact_events (
  id uuid primary key default extensions.gen_random_uuid(),
  contact_id uuid not null references private.stockflow_account_contacts(id),
  action text not null check (action in ('added','updated','removed')),
  old_values jsonb, new_values jsonb not null,
  actor text not null, request_id text not null,
  created_at timestamptz not null default now()
);
alter table private.stockflow_account_contacts enable row level security;
alter table private.stockflow_account_contact_events enable row level security;
revoke all on private.stockflow_account_contacts,private.stockflow_account_contact_events from public,anon,authenticated;
create trigger stockflow_account_contacts_no_delete before delete on private.stockflow_account_contacts
  for each row execute function private.prevent_business_delete();
create trigger stockflow_account_contact_events_immutable before update or delete on private.stockflow_account_contact_events
  for each row execute function private.prevent_order_event_mutation();

-- Patch the effective gateway after account classes and Tally contacts, failing closed on drift.
do $upgrade$
declare
  v_definition text; v_anchor text; v_index integer;
  v_anchors text[]:=array[
    $old$  v_class text; v_a_min bigint; v_b_min bigint; v_reason text;$old$,
    $old$('get_accounts','create_territory','assign_account','set_location','log_visit','set_class_policy')$old$,
    $old$'id',s.id,'name',s.name,'city',s.city,
        'class',coalesce(s.account_class,private.stockflow_account_class(s.id,v_today)),
        'contacts',coalesce((select jsonb_agg(jsonb_build_object('name',k.name,'phone',k.phone,'email',k.email) order by k.ordinal)
          from private.stockflow_customer_contacts k where k.customer_id=s.id and k.ordinal<=5),'[]'::jsonb),$old$,
    $old$  if p_action='set_class_policy' then
    if jsonb_typeof(p_payload->'aMinPaise')$old$
  ];
  v_replacements text[]:=array[
    $new$  v_class text; v_a_min bigint; v_b_min bigint; v_reason text;
  v_contact private.stockflow_account_contacts%rowtype;
  v_contact_role text; v_contact_phone text; v_contact_email text; v_phone_digits text; v_duplicate boolean;
  v_contact_event text;$new$,
    $new$('get_accounts','create_territory','assign_account','set_location','log_visit','set_class_policy','add_contact','update_contact','remove_contact')$new$,
    $new$'id',s.id,'name',s.name,'city',s.city,
        'class',coalesce(s.account_class,private.stockflow_account_class(s.id,v_today)),
        'contacts',coalesce((select jsonb_agg(jsonb_build_object('name',k.name,'phone',k.phone,'email',k.email) order by k.ordinal)
          from private.stockflow_customer_contacts k where k.customer_id=s.id and k.ordinal<=5),'[]'::jsonb),
        'appContacts',coalesce((select jsonb_agg(jsonb_build_object('id',k.id,'name',k.name,'businessRole',k.business_role,
          'phone',k.phone,'email',k.email,'addedBy',k.added_by,'version',k.version,
          'canEdit',k.added_by=v_email or v_roles && array['administrator','management']::text[]) order by k.added_at,k.id)
          from (select * from private.stockflow_account_contacts where customer_id=s.id and removed_at is null order by added_at,id limit 10) k),'[]'::jsonb),$new$,
    $new$  if p_action in ('add_contact','update_contact','remove_contact') then
    if p_action='add_contact' then
      if jsonb_typeof(p_payload->'customerId') is distinct from 'string' or (p_payload->>'customerId') !~* v_uuid_pattern then
        raise exception 'Active customer required' using errcode='22023'; end if;
      v_customer:=(p_payload->>'customerId')::uuid;
    else
      if jsonb_typeof(p_payload->'contactId') is distinct from 'string' or (p_payload->>'contactId') !~* v_uuid_pattern then
        raise exception 'Invalid contact' using errcode='22023'; end if;
      v_id:=(p_payload->>'contactId')::uuid;
      select customer_id into v_customer from private.stockflow_account_contacts where id=v_id;
      if not found then raise exception 'Contact changed; refresh and try again' using errcode='PT409'; end if;
    end if;
    -- One lock order for adds, edits and removals, including first writes.
    perform 1 from private.stockflow_customers where id=v_customer for update;
    if p_action='add_contact' and not exists(select 1 from private.stockflow_customers where id=v_customer and active) then
      raise exception 'Active customer required' using errcode='22023'; end if;
    if p_action<>'add_contact' then
      select * into strict v_contact from private.stockflow_account_contacts where id=v_id for update;
      if v_contact.added_by<>v_email and not (v_roles && array['administrator','management']::text[]) then
        raise exception 'Only the adder or management can change this contact' using errcode='42501'; end if;
      if jsonb_typeof(p_payload->'expectedVersion') is distinct from 'number' or (p_payload->>'expectedVersion') !~ '^[0-9]+$' then
        raise exception 'Invalid expected version' using errcode='22023'; end if;
      begin v_expected:=(p_payload->>'expectedVersion')::integer;
      exception when numeric_value_out_of_range then raise exception 'Invalid expected version' using errcode='22023'; end;
      if v_expected<1 then raise exception 'Invalid expected version' using errcode='22023'; end if;
      if v_contact.removed_at is not null or v_contact.version<>v_expected then
        raise exception 'Contact changed; refresh and try again' using errcode='PT409'; end if;
      v_old_values:=to_jsonb(v_contact);
    end if;
    if p_action<>'remove_contact' then
      if jsonb_typeof(p_payload->'name') is distinct from 'string' or char_length(btrim(p_payload->>'name')) not between 2 and 120 then
        raise exception 'Contact name must have 2 to 120 characters' using errcode='22023'; end if;
      if (p_payload->'businessRole' is not null and p_payload->'businessRole'<>'null'::jsonb and jsonb_typeof(p_payload->'businessRole')<>'string')
        or (p_payload->'phone' is not null and p_payload->'phone'<>'null'::jsonb and jsonb_typeof(p_payload->'phone')<>'string')
        or (p_payload->'email' is not null and p_payload->'email'<>'null'::jsonb and jsonb_typeof(p_payload->'email')<>'string') then
        raise exception 'Invalid contact fields' using errcode='22023'; end if;
      v_name:=btrim(p_payload->>'name'); v_contact_role:=nullif(btrim(p_payload->>'businessRole'),'');
      v_contact_phone:=nullif(btrim(p_payload->>'phone'),''); v_contact_email:=nullif(btrim(p_payload->>'email'),'');
      if char_length(v_contact_role)>80 or char_length(v_contact_phone)>40 or char_length(v_contact_email)>160
        or (v_contact_email is not null and position('@' in v_contact_email)=0) then
        raise exception 'Invalid contact fields' using errcode='22023'; end if;
      v_phone_digits:=right(regexp_replace(v_contact_phone,'[^0-9]','','g'),10);
      v_duplicate:=coalesce(v_phone_digits<>'',false) and (
        exists(select 1 from private.stockflow_account_contacts k where k.customer_id=v_customer and k.removed_at is null
          and (v_id is null or k.id<>v_id) and right(regexp_replace(k.phone,'[^0-9]','','g'),10)=v_phone_digits)
        or exists(select 1 from private.stockflow_customer_contacts k where k.customer_id=v_customer
          and right(regexp_replace(k.phone,'[^0-9]','','g'),10)=v_phone_digits));
    end if;
    if p_action='add_contact' then
      insert into private.stockflow_account_contacts(customer_id,name,business_role,phone,email,added_by)
        values(v_customer,v_name,v_contact_role,v_contact_phone,v_contact_email,v_email) returning * into v_contact;
      v_contact_event:='added';
    elsif p_action='update_contact' then
      update private.stockflow_account_contacts set name=v_name,business_role=v_contact_role,phone=v_contact_phone,email=v_contact_email,
        updated_by=v_email,updated_at=now(),version=version+1 where id=v_id returning * into v_contact;
      v_contact_event:='updated';
    else
      update private.stockflow_account_contacts set removed_at=now(),removed_by=v_email,version=version+1 where id=v_id returning * into v_contact;
      v_contact_event:='removed';
    end if;
    insert into private.stockflow_account_contact_events(contact_id,action,old_values,new_values,actor,request_id)
      values(v_contact.id,v_contact_event,v_old_values,to_jsonb(v_contact),v_email,v_key);
    v_id:=v_contact.id;
    v_result:=jsonb_build_object('ok',true,'contactId',v_contact.id,'version',v_contact.version,'duplicatePhone',coalesce(v_duplicate,false));
  elsif p_action='set_class_policy' then
    if jsonb_typeof(p_payload->'aMinPaise')$new$
  ];
begin
  v_definition:=replace(pg_get_functiondef('public.stockflow_accounts_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'');
  for v_index in 1..array_length(v_anchors,1) loop
    v_anchor:=v_anchors[v_index];
    if (length(v_definition)-length(replace(v_definition,v_anchor,'')))/length(v_anchor)<>1 then
      raise exception 'Unexpected accounts app contacts anchor %',v_index;
    end if;
    v_definition:=replace(v_definition,v_anchor,v_replacements[v_index]);
  end loop;
  execute v_definition;
end $upgrade$;
revoke all on function public.stockflow_accounts_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_accounts_gateway(text,text,text,jsonb) to service_role;

commit;
