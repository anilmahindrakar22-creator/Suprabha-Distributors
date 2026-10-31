begin;

-- All assertions are scoped to these transaction-local, unique fixture keys.
insert into public.stockflow_snapshots(id,company,fetched_at,payload)
values('suprabha','CITY PIN TEST',now()::text,'{"rows":[],"customers":[]}'::jsonb)
on conflict(id) do nothing;

do $test$
declare
  v_prefix text := 'city-pin-' || gen_random_uuid()::text || '-';
  v_company text := v_prefix || 'company';
  v_version text := '2026-11-02T13:00:00Z';
  v_input text; v_key text; v_id uuid; v_index integer; v_mode integer;
  v_payload jsonb; v_rows jsonb := '[]'::jsonb; v_before jsonb;
begin
  foreach v_input in array array[
    'Mob. No #','Mob. No. #','Mob. No #, #','MOB. NO #','Mob No #','Mob-#','MOB NO #',
    'Ph. No. #, #','Ph. No. #','D L NO KA- DG9-99B-# 9','DL No- KA-GL9-99-#, 99',
    'D L No. KA- BD9-#, KA-','Cell No?','Mobile No?','Tel','Phone No 9999999999',
    '  mob-9999999999','9999 9999','Town 12 34 56 78','', '   ',repeat('x',161)
  ] loop
    if private.stockflow_clean_city(v_input) is not null then raise exception 'P1 accepted junk: %',v_input; end if;
  end loop;
  foreach v_input in array array['Kalaburagi','Behind Court Gulbarga','Kalaburagi-585102','Aland Dist Kalaburagi',repeat('x',160),'Town 1234567','Mobileville'] loop
    if private.stockflow_clean_city('  ' || v_input || '  ') is distinct from v_input then raise exception 'P1 changed valid city: %',v_input; end if;
  end loop;
  if private.stockflow_clean_city(null) is not null then raise exception 'P1 null city'; end if;
  raise notice 'PASS: P1 city prefix, length and digit rules';

  select payload into v_payload from public.stockflow_snapshots where id='suprabha';
  v_rows := jsonb_build_array(
    jsonb_build_object('tallyKey',v_prefix || 'insert-junk','name',v_prefix || 'insert-junk','city','Mob. No #'),
    jsonb_build_object('tallyKey',v_prefix || 'insert-valid','name',v_prefix || 'insert-valid','city',' Kalaburagi '));
  update public.stockflow_snapshots set payload=(v_payload-'customers') || jsonb_build_object('customers',v_rows) where id='suprabha';
  if not exists(select 1 from private.stockflow_customers where tally_key=v_prefix || 'insert-junk' and city is null)
    or not exists(select 1 from private.stockflow_customers where tally_key=v_prefix || 'insert-valid' and city='Kalaburagi') then raise exception 'P2 insert cities'; end if;
  raise notice 'PASS: P2 insert rejects junk and stores valid city';

  -- Exercise both ON CONFLICT and the confirmed-GUID update/rename path.
  insert into private.stockflow_economic_ledger_generations(company_id,source_version,observed_at,valid,catalog_version,content_hash,row_count)
  values(v_company,v_version,v_version::timestamptz,true,v_version,v_prefix,3);
  for v_mode in 0..1 loop
    v_rows := '[]'::jsonb;
    for v_index in 1..3 loop
      v_key := v_prefix || 'update-' || v_mode || '-' || v_index;
      insert into private.stockflow_customers(tally_key,name,city,created_by_email)
      values(case when v_mode=1 then v_key || '-old' else v_key end,v_key,
        case when v_index=2 then 'Kalaburagi' else 'DL No- KA-GL9-99-#, 99' end,'city-pin-test') returning id into v_id;
      if v_mode=1 then
        insert into private.stockflow_economic_ledger_masters(company_id,source_version,guid,name)
        values(v_company,v_version,v_key,v_key);
        insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
        values(v_company,v_key,v_id,'city-pin-test');
      end if;
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('tallyKey',v_key,'name',v_key,
        'city',case when v_index=1 then 'Aland Dist Kalaburagi' else 'Cell No?' end,
        'pinCode',' 585 102 ','state',' Karnataka '));
    end loop;
    update public.stockflow_snapshots set payload=(v_payload-'customers') || jsonb_build_object('customers',v_rows) where id='suprabha';
    for v_index in 1..3 loop
      v_key := v_prefix || 'update-' || v_mode || '-' || v_index;
      if not exists(select 1 from private.stockflow_customers where tally_key=v_key
        and city is not distinct from (case v_index when 1 then 'Aland Dist Kalaburagi' when 2 then 'Kalaburagi' else null end)
        and pin_code='585102' and state='Karnataka') then raise exception 'P3 update path %, case %',v_mode,v_index; end if;
      if v_mode=1 and not exists(select 1 from private.stockflow_economic_customer_identities i
        join private.stockflow_customers c on c.id=i.customer_id where i.company_id=v_company and i.source_id=v_key and c.tally_key=v_key) then raise exception 'P3 lost linked UUID'; end if;
    end loop;
    -- Missing/invalid incoming values preserve the linked and unlinked fields.
    select jsonb_agg((e-'pinCode') || jsonb_build_object('state',repeat('x',61))) into v_rows from jsonb_array_elements(v_rows) e;
    update public.stockflow_snapshots set payload=(v_payload-'customers') || jsonb_build_object('customers',v_rows) where id='suprabha';
    if (select count(*) from private.stockflow_customers where tally_key like v_prefix || 'update-' || v_mode || '-%' and pin_code='585102' and state='Karnataka')<>3 then raise exception 'P4/P5 update preservation'; end if;
  end loop;
  raise notice 'PASS: P3 city repair/preservation on upsert and confirmed-GUID paths';

  v_rows := '[]'::jsonb;
  for v_index in 1..6 loop
    v_input := (array['585102',' 585 102 ','58510','085102','abc',null])[v_index];
    v_key := v_prefix || 'pin-' || v_index;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object('tallyKey',v_key,'name',v_key,
      'state',case v_index when 1 then ' Karnataka ' when 2 then repeat('x',61) when 3 then '  ' when 4 then repeat('x',60) else null end)
      || case when v_input is null then '{}'::jsonb else jsonb_build_object('pinCode',v_input) end);
  end loop;
  update public.stockflow_snapshots set payload=(v_payload-'customers') || jsonb_build_object('customers',v_rows) where id='suprabha';
  for v_index in 1..6 loop
    if not exists(select 1 from private.stockflow_customers where tally_key=v_prefix || 'pin-' || v_index
      and pin_code is not distinct from (case when v_index<=2 then '585102' else null end)) then raise exception 'P4 PIN case %',v_index; end if;
  end loop;
  select jsonb_agg(e-'pinCode'-'state') into v_rows from jsonb_array_elements(v_rows) e;
  update public.stockflow_snapshots set payload=(v_payload-'customers') || jsonb_build_object('customers',v_rows) where id='suprabha';
  if (select count(*) from private.stockflow_customers where tally_key in (v_prefix || 'pin-1',v_prefix || 'pin-2') and pin_code='585102')<>2 then raise exception 'P4 missing PIN lost stored value'; end if;
  raise notice 'PASS: P4 PIN validation, whitespace stripping and later preservation';
  for v_index in 1..6 loop
    if not exists(select 1 from private.stockflow_customers where tally_key=v_prefix || 'pin-' || v_index
      and state is not distinct from (case v_index when 1 then 'Karnataka' when 4 then repeat('x',60) else null end)) then raise exception 'P5 state case %',v_index; end if;
  end loop;
  raise notice 'PASS: P5 state trimming, length and later preservation';

  select to_jsonb(c) into v_before from private.stockflow_customers c where tally_key=v_prefix || 'pin-1';
  foreach v_rows in array array['{}'::jsonb,'{"customers":null}'::jsonb,'{"customers":[]}'::jsonb,'{"customers":{}}'::jsonb] loop
    update public.stockflow_snapshots set payload=(v_payload-'customers') || v_rows where id='suprabha';
    if (select to_jsonb(c) from private.stockflow_customers c where tally_key=v_prefix || 'pin-1') is distinct from v_before then raise exception 'P6 partial snapshot changed customer'; end if;
  end loop;
  v_rows := jsonb_build_array(jsonb_build_object('tallyKey',v_prefix || 'insert-valid','name',v_prefix || 'renamed','tallyBalance','123.45'));
  update public.stockflow_snapshots set payload=(v_payload-'customers') || jsonb_build_object('customers',v_rows) where id='suprabha';
  if not exists(select 1 from private.stockflow_customers where tally_key=v_prefix || 'insert-valid' and active and name=v_prefix || 'renamed' and tally_balance=123.45 and balance_as_of is not null)
    or not exists(select 1 from private.stockflow_customers where tally_key=v_prefix || 'pin-1' and not active) then raise exception 'P6 balance/active handling'; end if;
  raise notice 'PASS: P6 partial snapshot, balance, active and linked UUID behavior';
end $test$;
rollback;
