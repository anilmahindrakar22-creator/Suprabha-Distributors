begin;

-- Acquire before any customer row update, including customer-only snapshots.
-- Confirmation and creation take this same first lock.
create function private.stockflow_customer_directory_lock() returns trigger
language plpgsql security definer set search_path=pg_catalog,private as $$
begin
 if new.id='suprabha' then perform pg_advisory_xact_lock(hashtextextended('instrument-economics-v1',0));end if;
 return new;
end $$;
revoke all on function private.stockflow_customer_directory_lock() from public,anon,authenticated,service_role;
create trigger stockflow_customer_directory_lock before insert or update of payload on public.stockflow_snapshots
 for each row execute function private.stockflow_customer_directory_lock();

-- Reuse the customer master and command receipts. This event holds provenance,
-- not a second customer/contact record.
create table private.stockflow_customer_creation_events (
 customer_id uuid primary key references private.stockflow_customers(id),
 actor text not null, request_id text not null,
 recorded_at timestamptz not null default clock_timestamp()
);
alter table private.stockflow_customer_creation_events enable row level security;
revoke all on private.stockflow_customer_creation_events from public,anon,authenticated,service_role;
create trigger immutable before update or delete on private.stockflow_customer_creation_events
 for each row execute function private.prevent_order_event_mutation();

do $upgrade$
declare v_definition text; v_anchor text; v_index integer;
 v_anchors text[]:=array[
  $old$('get_accounts','create_territory','assign_account','set_location','log_visit','set_class_policy','add_contact','update_contact','remove_contact','set_assessment','erase_contact','record_style_observation','set_style_override')$old$,
  $old$  v_replay:=private.begin_stockflow_command(v_email,p_action,v_key,p_payload);$old$,
  $old$  if p_action in ('record_style_observation','set_style_override') then$old$,
  $old$'id',s.id,'name',s.name,'city',s.city,$old$
 ];
 v_replacements text[]:=array[
  $new$('create_customer','get_accounts','create_territory','assign_account','set_location','log_visit','set_class_policy','add_contact','update_contact','remove_contact','set_assessment','erase_contact','record_style_observation','set_style_override')$new$,
  $new$  if p_action='create_customer' then
    -- Same first lock as snapshot import; creation and sync cannot race a duplicate.
    perform pg_advisory_xact_lock(hashtextextended('instrument-economics-v1',0));
  end if;
  v_replay:=private.begin_stockflow_command(v_email,p_action,v_key,p_payload);$new$,
  $new$  if p_action='create_customer' then
    if jsonb_typeof(p_payload->'name') is distinct from 'string'
      or char_length(btrim(p_payload->>'name')) not between 2 and 160
      or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('name','city','phone','idempotencyKey'))
      or (p_payload ? 'city' and p_payload->'city'<>'null'::jsonb and (jsonb_typeof(p_payload->'city')<>'string' or char_length(btrim(p_payload->>'city'))>160))
      or (p_payload ? 'phone' and p_payload->'phone'<>'null'::jsonb and (jsonb_typeof(p_payload->'phone')<>'string' or char_length(btrim(p_payload->>'phone'))>80)) then
      raise exception 'Enter a customer name, optional town and phone' using errcode='22023';
    end if;
    v_name:=btrim(p_payload->>'name');
    if exists(select 1 from private.stockflow_customers where active and lower(btrim(name))=lower(v_name)) then
      raise exception 'A customer with this name already exists. Search accounts first; include the location in a new branch name.' using errcode='PT409';
    end if;
    insert into private.stockflow_customers(name,city,phone,created_by_email)
      values(v_name,nullif(btrim(p_payload->>'city'),''),nullif(btrim(p_payload->>'phone'),''),v_email) returning id into v_id;
    insert into private.stockflow_customer_creation_events(customer_id,actor,request_id) values(v_id,v_email,v_key);
    v_result:=jsonb_build_object('ok',true,'customerId',v_id,'name',v_name,'tallyLedgerState','no_ledger');
  elsif p_action in ('record_style_observation','set_style_override') then$new$,
  $new$'id',s.id,'name',s.name,'city',s.city,
        'tallyLedgerState',(select case when exists(select 1 from private.stockflow_economic_customer_identities i where i.customer_id=c.id) then 'linked'
          when c.tally_key is null then 'no_ledger' else 'unlinked' end from private.stockflow_customers c where c.id=s.id),$new$
 ];
begin
 v_definition:=replace(pg_get_functiondef('public.stockflow_accounts_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'');
 for v_index in 1..array_length(v_anchors,1) loop
  v_anchor:=v_anchors[v_index];
  if (length(v_definition)-length(replace(v_definition,v_anchor,'')))/length(v_anchor)<>1 then
    raise exception 'Unexpected visit customer seam %',v_index;end if;
  v_definition:=replace(v_definition,v_anchor,v_replacements[v_index]);
 end loop;
 execute v_definition;
end $upgrade$;
revoke all on function public.stockflow_accounts_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_accounts_gateway(text,text,text,jsonb) to service_role;
commit;
