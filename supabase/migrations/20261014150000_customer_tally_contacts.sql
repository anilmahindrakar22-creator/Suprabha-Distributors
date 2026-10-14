begin;

create table private.stockflow_customer_contacts (
  id uuid primary key default extensions.gen_random_uuid(),
  customer_id uuid not null references private.stockflow_customers(id),
  ordinal smallint not null check (ordinal between 1 and 20),
  name text not null check (name=btrim(name) and char_length(name) between 1 and 120),
  phone text check (phone is null or char_length(phone)<=40),
  email text check (email is null or char_length(email)<=160),
  source text not null check (source in ('ledger_contact','contact_details')),
  source_seen_at timestamptz not null,
  unique(customer_id,ordinal)
);
alter table private.stockflow_customer_contacts enable row level security;
revoke all on private.stockflow_customer_contacts from public,anon,authenticated;

create function private.stockflow_sync_tally_customer_contacts()
returns trigger language plpgsql security definer set search_path=pg_catalog,private as $$
declare
  v_customer jsonb; v_customer_id uuid; v_contact jsonb; v_ordinal bigint;
  v_name text; v_phone text; v_email text; v_source text;
begin
  if jsonb_typeof(new.payload->'customers') is distinct from 'array' then return new; end if;
  if jsonb_array_length(new.payload->'customers')=0 then return new; end if;
  for v_customer in select value from jsonb_array_elements(new.payload->'customers') loop
    if not (v_customer ? 'contacts') or jsonb_typeof(v_customer->'contacts') is distinct from 'array' then continue; end if;
    select id into v_customer_id from private.stockflow_customers where tally_key=btrim(v_customer->>'tallyKey');
    if v_customer_id is null then continue; end if;
    delete from private.stockflow_customer_contacts where customer_id=v_customer_id;
    for v_contact,v_ordinal in
      select value,ordinality from jsonb_array_elements(v_customer->'contacts') with ordinality where ordinality<=20
    loop
      if jsonb_typeof(v_contact) is distinct from 'object'
        or jsonb_typeof(v_contact->'name') is distinct from 'string'
        or jsonb_typeof(v_contact->'source') is distinct from 'string' then continue; end if;
      if (v_contact->'phone' is not null and v_contact->'phone'<>'null'::jsonb and jsonb_typeof(v_contact->'phone')<>'string')
        or (v_contact->'email' is not null and v_contact->'email'<>'null'::jsonb and jsonb_typeof(v_contact->'email')<>'string') then continue; end if;
      v_name:=btrim(v_contact->>'name');
      v_phone:=nullif(btrim(v_contact->>'phone'),'');
      v_email:=btrim(v_contact->>'email');
      v_source:=v_contact->>'source';
      if char_length(v_name) not between 1 and 120 or char_length(v_phone)>40
        or char_length(v_email)>160 or (v_email is not null and position('@' in v_email)=0)
        or v_source not in ('ledger_contact','contact_details') then continue; end if;
      insert into private.stockflow_customer_contacts(customer_id,ordinal,name,phone,email,source,source_seen_at)
        values(v_customer_id,v_ordinal::smallint,v_name,v_phone,v_email,v_source,now());
    end loop;
  end loop;
  return new;
end $$;
revoke all on function private.stockflow_sync_tally_customer_contacts() from public,anon,authenticated;

-- Same timing/event as stockflow_sync_tally_customers; this name sorts after it.
create trigger stockflow_sync_tally_customers_contacts
after insert or update of payload on public.stockflow_snapshots
for each row when (new.id='suprabha')
execute function private.stockflow_sync_tally_customer_contacts();

do $upgrade$
declare
  v_definition text;
  v_anchor text:=$old$'id',s.id,'name',s.name,'city',s.city,
        'class',coalesce(s.account_class,private.stockflow_account_class(s.id,v_today)),$old$;
begin
  v_definition:=replace(pg_get_functiondef('public.stockflow_accounts_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'');
  if (length(v_definition)-length(replace(v_definition,v_anchor,'')))/length(v_anchor)<>1 then
    raise exception 'Unexpected accounts contacts anchor';
  end if;
  v_definition:=replace(v_definition,v_anchor,v_anchor||$new$
        'contacts',coalesce((select jsonb_agg(jsonb_build_object('name',k.name,'phone',k.phone,'email',k.email) order by k.ordinal)
          from private.stockflow_customer_contacts k where k.customer_id=s.id and k.ordinal<=5),'[]'::jsonb),$new$);
  execute v_definition;
end $upgrade$;
revoke all on function public.stockflow_accounts_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_accounts_gateway(text,text,text,jsonb) to service_role;

commit;
