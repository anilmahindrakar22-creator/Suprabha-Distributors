begin;

create table private.stockflow_customer_sync_conflicts (
  id bigint generated always as identity primary key,
  customer_id uuid not null,
  conflicting_customer_id uuid null,
  tally_key text not null check (char_length(tally_key) between 1 and 240),
  guid text null check (char_length(guid) <= 240),
  reason text not null check (char_length(reason) between 1 and 200),
  recorded_on date not null default ((clock_timestamp() at time zone 'UTC')::date),
  recorded_at timestamptz not null default clock_timestamp(),
  constraint stockflow_customer_sync_conflicts_daily_rule unique (customer_id, tally_key, recorded_on)
);
alter table private.stockflow_customer_sync_conflicts enable row level security;
revoke all on private.stockflow_customer_sync_conflicts from public, anon, authenticated, service_role;
create trigger immutable before update or delete on private.stockflow_customer_sync_conflicts
  for each row execute function private.prevent_order_event_mutation();

create or replace function private.stockflow_sync_tally_customers()
returns trigger language plpgsql security definer
set search_path = pg_catalog, private as $$
declare v_customer jsonb; v_tally_key text; v_name text; v_balance numeric(18,2); v_linked_ids uuid[];
  v_pin_code text; v_state text; v_guid text; v_conflicting_id uuid; v_reason text;
begin
  if jsonb_typeof(new.payload->'customers') is distinct from 'array' then return new; end if;
  if jsonb_array_length(new.payload->'customers') = 0 then return new; end if;
  for v_customer in select value from jsonb_array_elements(new.payload->'customers') loop
    v_tally_key := nullif(btrim(v_customer->>'tallyKey'),''); v_name := nullif(btrim(v_customer->>'name'),'');
    if v_tally_key is null or v_name is null or char_length(v_name) not between 2 and 160 then continue; end if;
    begin v_balance := nullif(v_customer->>'tallyBalance','')::numeric; exception when invalid_text_representation or numeric_value_out_of_range then v_balance := null; end;
    v_pin_code := regexp_replace(v_customer->>'pinCode','\s','','g');
    if v_pin_code !~ '^[1-9][0-9]{5}$' then v_pin_code := null; end if;
    v_state := nullif(btrim(v_customer->>'state'),'');
    if char_length(v_state) > 60 then v_state := null; end if;
    v_guid := nullif(btrim(v_customer->>'guid'),'');
    if char_length(v_guid) > 240 then v_guid := null; end if;
    v_linked_ids := null;
    if v_guid is not null then
      select array_agg(distinct i.customer_id order by i.customer_id) into v_linked_ids
      from private.stockflow_economic_customer_identities i where i.source_id=v_guid;
    end if;
    if coalesce(cardinality(v_linked_ids),0)=0 then
    select array_agg(distinct i.customer_id) into v_linked_ids
    from private.stockflow_economic_customer_identities i
    join private.stockflow_economic_ledger_generations g on g.company_id=i.company_id
      and g.source_version=private.stockflow_current_ledger_generation(i.company_id)
    join private.stockflow_economic_ledger_masters l on l.company_id=g.company_id and l.source_version=g.catalog_version
      and l.guid=i.source_id and btrim(l.name)=v_tally_key;
    end if;
    if cardinality(v_linked_ids)>1 then
      insert into private.stockflow_customer_sync_conflicts(customer_id,conflicting_customer_id,tally_key,guid,reason)
      values(v_linked_ids[1],v_linked_ids[2],v_tally_key,v_guid,'Customer ledger identity is ambiguous across companies')
      on conflict on constraint stockflow_customer_sync_conflicts_daily_rule do nothing;
      continue;
    end if;
    if cardinality(v_linked_ids)=1 then
      v_reason := null;
      select id into v_conflicting_id from private.stockflow_customers where tally_key=v_tally_key and id<>v_linked_ids[1];
      if v_conflicting_id is not null then
        v_reason := 'Ledger already has a different customer record';
      else
      begin
      update private.stockflow_customers set tally_key=v_tally_key,name=v_name,
        phone=coalesce(nullif(left(btrim(coalesce(v_customer->>'phone','')),80),''),phone),
        city=case when private.stockflow_clean_city(stockflow_customers.city) is null then private.stockflow_clean_city(v_customer->>'city') else coalesce(private.stockflow_clean_city(v_customer->>'city'),stockflow_customers.city) end,
        pin_code=coalesce(v_pin_code,stockflow_customers.pin_code),state=coalesce(v_state,stockflow_customers.state),
        active=true,updated_at=now(),tally_balance=v_balance,balance_as_of=case when v_balance is null then null else now() end
      where id=v_linked_ids[1];
      exception when unique_violation then
        select id into v_conflicting_id from private.stockflow_customers where tally_key=v_tally_key and id<>v_linked_ids[1];
        v_reason := 'Customer ledger rename conflicted with a concurrent update';
      end;
      end if;
      if v_reason is not null then
        insert into private.stockflow_customer_sync_conflicts(customer_id,conflicting_customer_id,tally_key,guid,reason)
        values(v_linked_ids[1],v_conflicting_id,v_tally_key,v_guid,v_reason)
        on conflict on constraint stockflow_customer_sync_conflicts_daily_rule do nothing;
      end if;
      continue;
    end if;
    -- Keep the visit customer pending for explicit exact-name confirmation.
    -- The source snapshot retains the ledger while its financial fields stay unavailable.
    if exists(select 1 from private.stockflow_customers where active and tally_key is null and name=v_tally_key) then continue;end if;
    insert into private.stockflow_customers(tally_key,name,phone,city,active,created_by_email,updated_at,tally_balance,balance_as_of,pin_code,state)
    values(v_tally_key,v_name,nullif(left(btrim(coalesce(v_customer->>'phone','')),80),''),private.stockflow_clean_city(v_customer->>'city'),true,'tally-sync',now(),v_balance,case when v_balance is null then null else now() end,v_pin_code,v_state)
    on conflict(tally_key) do update set name=excluded.name,phone=coalesce(excluded.phone,stockflow_customers.phone),city=case when private.stockflow_clean_city(stockflow_customers.city) is null then excluded.city else coalesce(excluded.city, stockflow_customers.city) end,pin_code=coalesce(excluded.pin_code,stockflow_customers.pin_code),state=coalesce(excluded.state,stockflow_customers.state),active=true,updated_at=now(),tally_balance=excluded.tally_balance,balance_as_of=excluded.balance_as_of;
  end loop;
  update private.stockflow_customers c set active=false,updated_at=now() where c.tally_key is not null and not exists(select 1 from jsonb_array_elements(new.payload->'customers') item where nullif(btrim(item->>'tallyKey'),'')=c.tally_key);
  return new;
end $$;
revoke all on function private.stockflow_sync_tally_customers() from public, anon, authenticated;

commit;
