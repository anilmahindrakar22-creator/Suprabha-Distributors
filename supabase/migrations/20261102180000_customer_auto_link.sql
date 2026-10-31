begin;

create or replace function private.stockflow_sync_tally_customers()
returns trigger language plpgsql security definer
set search_path = pg_catalog, private as $$
declare v_customer jsonb; v_tally_key text; v_name text; v_balance numeric(18,2); v_linked_ids uuid[];
  v_pin_code text; v_state text; v_guid text; v_conflicting_id uuid; v_reason text;
begin
  if jsonb_typeof(new.payload->'customers') is distinct from 'array' then return new; end if;
  if jsonb_array_length(new.payload->'customers') = 0 then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('instrument-economics-v1',0));
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
  begin
    with current_generations as materialized (
      select g.company_id,g.source_version,g.catalog_version
      from (select distinct company_id from private.stockflow_economic_ledger_generations) companies
      join private.stockflow_economic_ledger_generations g on g.company_id=companies.company_id
        and g.source_version=private.stockflow_current_ledger_generation(companies.company_id)
      where g.valid
    ), exact_matches as materialized (
      -- Count before checking the GUID: a GUID must never disambiguate names.
      select g.company_id,g.source_version,c.id customer_id,l.guid,l.name,
        count(*) over (partition by g.company_id,c.id) match_count
      from current_generations g
      join private.stockflow_economic_ledger_masters l on l.company_id=g.company_id and l.source_version=g.catalog_version
      join private.stockflow_customers c on c.tally_key=btrim(l.name)
      where c.active and c.tally_key is not null
    ), eligible as materialized (
      select m.* from exact_matches m
      where m.match_count=1
        and not exists(select 1 from private.stockflow_economic_customer_identities i
          where i.company_id=m.company_id and (i.customer_id=m.customer_id or i.source_id=m.guid))
        and exists(select 1 from jsonb_array_elements(new.payload->'customers') item
          where item->>'tallyKey'=btrim(m.name) and jsonb_typeof(item->'guid')='string'
            and nullif(btrim(item->>'guid'),'')=m.guid)
    ), inserted as (
      insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
      select company_id,guid,customer_id,'tally-auto-link' from eligible
      on conflict do nothing
      returning company_id,source_id,customer_id
    )
    insert into private.stockflow_customer_identity_events(
      company_id,source_id,customer_id,action,actor,reason,source_version,ledger_name_at_confirmation,request_id)
    select i.company_id,i.source_id,i.customer_id,'confirmed','tally-auto-link',
      'Automatic exact Tally ledger and GUID match (owner direction, 31 Oct 2026)',
      e.source_version,e.name,'tally-auto-link:'||e.source_version
    from inserted i join eligible e on e.company_id=i.company_id and e.guid=i.source_id and e.customer_id=i.customer_id;
  exception when others then
    raise warning 'customer auto-link skipped: %', sqlerrm;
  end;
  return new;
end $$;
revoke all on function private.stockflow_sync_tally_customers() from public, anon, authenticated;

commit;
