begin;

-- ADR-0011 / D-14 (owner, 13 Oct 2026): one persistent identity per machine.
-- Fail closed on ambiguous serial/model backfill. Relocation creates another
-- installation linked to the same ID; no financial data is copied.
-- A trigger assigns the instrument on every completed installation.
create function private.stockflow_instrument_serial_key(p text) returns text
language sql immutable set search_path=pg_catalog as $$
 select upper(regexp_replace(btrim(coalesce(p,'')),'[\s\-/.]','','g'));
$$;
revoke all on function private.stockflow_instrument_serial_key(text) from public,anon,authenticated;

create table private.stockflow_instruments (
 id uuid primary key default extensions.gen_random_uuid(),
 serial_key text not null unique check(length(serial_key) between 2 and 100),
 serial_number text not null,
 model_id text,
 created_by text not null,
 created_at timestamptz not null default now()
);
alter table private.stockflow_instruments enable row level security;
revoke all on private.stockflow_instruments from public,anon,authenticated;
create trigger stockflow_instruments_no_delete
before delete on private.stockflow_instruments
for each row execute function private.prevent_business_delete();

alter table private.stockflow_equipment_installations
 add column instrument_id uuid references private.stockflow_instruments(id);
create index stockflow_equipment_installations_instrument_idx
 on private.stockflow_equipment_installations(instrument_id);

create function private.stockflow_instrument_backfill_check() returns void
language plpgsql set search_path=pg_catalog,private as $$
declare v_duplicates text;
begin
 select string_agg(d.serial_key||' ['||d.installation_ids||']',', ' order by d.serial_key)
 into v_duplicates from (
  select private.stockflow_instrument_serial_key(i.serial_number) as serial_key,
   string_agg(i.id::text,', ' order by i.id) as installation_ids
  from private.stockflow_equipment_installations i where i.status='completed'
  group by private.stockflow_instrument_serial_key(i.serial_number) having count(*)>1
 ) d;
 if v_duplicates is not null then
  raise exception 'Instrument register backfill stopped: duplicate serials %',v_duplicates using errcode='PT409';
 end if;
end$$;
revoke all on function private.stockflow_instrument_backfill_check() from public,anon,authenticated,service_role;
select private.stockflow_instrument_backfill_check();

insert into private.stockflow_instruments(serial_key,serial_number,created_by)
 select private.stockflow_instrument_serial_key(serial_number),serial_number,'migration'
 from private.stockflow_equipment_installations where status='completed';
update private.stockflow_equipment_installations i set instrument_id=m.id
 from private.stockflow_instruments m
 where i.status='completed' and m.serial_key=private.stockflow_instrument_serial_key(i.serial_number);

do $backfill$
declare v_disagreements text;
begin
 select string_agg(d.instrument_id::text||' ['||d.models||']',', ' order by d.instrument_id)
 into v_disagreements from (
  select i.instrument_id,string_agg(distinct t.model_id,', ' order by t.model_id) as models
  from private.stockflow_equipment_installations i
  join private.stockflow_economic_targets t on t.installation_id=i.id and t.kind='placement'
  where i.instrument_id is not null group by i.instrument_id having count(distinct t.model_id)>1
 ) d;
 if v_disagreements is not null then
  raise exception 'Instrument register backfill stopped: placements disagree on model %',v_disagreements using errcode='PT409';
 end if;
 update private.stockflow_instruments m set model_id=d.model_id from (
  select i.instrument_id,min(t.model_id) as model_id
  from private.stockflow_equipment_installations i
  join private.stockflow_economic_targets t on t.installation_id=i.id and t.kind='placement'
  group by i.instrument_id having count(distinct t.model_id)=1
 ) d where m.id=d.instrument_id;
end$backfill$;

create function private.stockflow_assign_instrument(p_serial text,p_customer uuid,p_actor text) returns uuid
language plpgsql set search_path=pg_catalog,private,public,extensions as $$
declare v_key text;v_instrument private.stockflow_instruments%rowtype;v_customer_name text;
begin
 v_key:=private.stockflow_instrument_serial_key(p_serial);
 insert into private.stockflow_instruments(serial_key,serial_number,created_by)
 values(v_key,btrim(p_serial),p_actor) on conflict(serial_key) do nothing;
 select * into v_instrument from private.stockflow_instruments where serial_key=v_key for update;
 select c.name into v_customer_name
 from private.stockflow_economic_targets t
 join private.stockflow_equipment_installations i on i.id=t.installation_id
 left join private.stockflow_orders o on o.id=i.order_id
 join private.stockflow_customers c on c.id=coalesce(i.customer_id,o.customer_id)
 where i.instrument_id=v_instrument.id and t.kind='placement' and t.approval<>'rejected'
  and (t.effective_to is null or t.effective_to>private.stockflow_economic_business_date())
  and coalesce(i.customer_id,o.customer_id) is distinct from p_customer
 order by t.id limit 1;
 if found then raise exception 'Serial is placed at %; end that placement first',v_customer_name using errcode='PT409';end if;
 return v_instrument.id;
end$$;
revoke all on function private.stockflow_assign_instrument(text,uuid,text) from public,anon,authenticated,service_role;

create function private.stockflow_installation_assign_instrument() returns trigger
language plpgsql set search_path=pg_catalog,private,public,extensions as $$
begin
 if new.status='completed' and new.instrument_id is null then
  if TG_OP='INSERT' or old.status is distinct from 'completed' or old.instrument_id is null then
   new.instrument_id := private.stockflow_assign_instrument(new.serial_number,
    coalesce(new.customer_id,(select o.customer_id from private.stockflow_orders o where o.id=new.order_id)),
    coalesce(new.completed_by_email,new.created_by_email));
  end if;
 end if;
 return new;
end$$;
revoke all on function private.stockflow_installation_assign_instrument() from public,anon,authenticated,service_role;
create trigger stockflow_installation_assign_instrument
 before insert or update of status,instrument_id on private.stockflow_equipment_installations
 for each row execute function private.stockflow_installation_assign_instrument();
alter table private.stockflow_equipment_installations
 add constraint stockflow_completed_installation_instrument check(status<>'completed' or instrument_id is not null);

do $upgrade$
declare v_definition text;v_anchor text;
begin
 v_definition:=replace(pg_get_functiondef('private.stockflow_register_historical_instrument(text,jsonb)'::regprocedure),chr(13),'');
 v_anchor:=$seam$coalesce(i.customer_id,o.customer_id)=customer and i.serial_number=serial$seam$;
 if (length(v_definition)-length(replace(v_definition,v_anchor,'')))/length(v_anchor)<>1 then raise exception 'Unexpected instrument register seam';end if;
 v_definition:=replace(v_definition,v_anchor,$seam$coalesce(i.customer_id,o.customer_id)=customer and private.stockflow_instrument_serial_key(i.serial_number)=private.stockflow_instrument_serial_key(serial)$seam$);
 execute v_definition;

 v_definition:=replace(pg_get_functiondef('public.stockflow_economics_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'');
 v_anchor:=$seam$target private.stockflow_economic_targets%rowtype;$seam$;
 if (length(v_definition)-length(replace(v_definition,v_anchor,'')))/length(v_anchor)<>1 then raise exception 'Unexpected instrument register seam';end if;
 v_definition:=replace(v_definition,v_anchor,v_anchor||'v_instrument private.stockflow_instruments%rowtype;');
 v_anchor:=$seam$insert into private.stockflow_economic_targets(kind,name,company_id,customer_id,customer_source_id,site_id,model_id,installation_id,effective_from,created_by)$seam$;
 if (length(v_definition)-length(replace(v_definition,v_anchor,'')))/length(v_anchor)<>1 then raise exception 'Unexpected instrument register seam';end if;
 v_definition:=replace(v_definition,v_anchor,$seam$if p_payload->>'kind'='placement' then
   select m.* into v_instrument from private.stockflow_instruments m
   join private.stockflow_equipment_installations i on i.instrument_id=m.id
   where i.id=(p_payload->>'installationId')::uuid for update of m;
   if not found then raise exception 'Completed installation requires an instrument' using errcode='22023';end if;
   if exists(select 1 from private.stockflow_economic_targets t
    join private.stockflow_equipment_installations i on i.id=t.installation_id
    where i.instrument_id=v_instrument.id and t.kind='placement' and t.approval<>'rejected'
     and daterange(t.effective_from,t.effective_to,'[)') && daterange((p_payload->>'effectiveFrom')::date,null,'[)')) then
    raise exception 'Instrument already has an open placement; close it first' using errcode='PT409';
   end if;
   if v_instrument.model_id is null then
    update private.stockflow_instruments set model_id=btrim(p_payload->>'modelId') where id=v_instrument.id;
   elsif v_instrument.model_id is distinct from btrim(p_payload->>'modelId') then
    raise exception 'Model must match this instrument (%)',v_instrument.model_id using errcode='PT409';
   end if;
  end if;
  $seam$||v_anchor);
 execute v_definition;
end$upgrade$;
revoke all on function private.stockflow_register_historical_instrument(text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.stockflow_economics_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_economics_gateway(text,text,text,jsonb) to service_role;
commit;
