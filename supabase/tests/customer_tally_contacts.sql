begin;

insert into public.stockflow_members(email,role,roles,status)
values('contacts-sales@example.test','sales',array['sales'],'active');
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('contacts-test-key','sha256'),'hex') where name='orders';

do $test$
declare
  v_customer uuid; v_contacts jsonb; v_read jsonb; v_before jsonb; v_variant jsonb;
  v_ledger jsonb:='{"tallyKey":" contacts-fixture ","name":"Contacts fixture ledger","phone":"12345","city":"Contacts Fixture City"}';
begin
  v_contacts:='[{"name":" First ","phone":"111","email":"first@example.test","source":"ledger_contact"},{"name":"Second","source":"contact_details"}]';
  insert into public.stockflow_snapshots(id,company,fetched_at,payload)
    values('suprabha','CONTACTS TEST',now()::text,jsonb_build_object('customers',jsonb_build_array(v_ledger||jsonb_build_object('contacts',v_contacts))))
    on conflict(id) do update set payload=excluded.payload;
  select id into strict v_customer from private.stockflow_customers where tally_key='contacts-fixture';
  if (select array_agg(ordinal order by ordinal) from private.stockflow_customer_contacts where customer_id=v_customer) is distinct from array[1,2]::smallint[] then
    raise exception 'Two contacts or their ordinals missing'; end if;
  v_read:=public.stockflow_accounts_gateway('contacts-test-key','contacts-sales@example.test','get_accounts','{"search":"Contacts Fixture City"}');
  if v_read->'accounts'->0->'contacts' is distinct from '[{"name":"First","phone":"111","email":"first@example.test"},{"name":"Second","phone":null,"email":null}]'::jsonb then
    raise exception 'Gateway contacts shape or order incorrect: %',v_read; end if;

  select jsonb_agg(to_jsonb(k) order by ordinal) into v_before from private.stockflow_customer_contacts k where customer_id=v_customer;
  -- An older connector and malformed optional fields must preserve row identity.
  foreach v_variant in array array[v_ledger,v_ledger||'{"contacts":null}'::jsonb,v_ledger||'{"contacts":{}}'::jsonb] loop
    update public.stockflow_snapshots set payload=jsonb_build_object('customers',jsonb_build_array(v_variant)) where id='suprabha';
    if (select jsonb_agg(to_jsonb(k) order by ordinal) from private.stockflow_customer_contacts k where customer_id=v_customer) is distinct from v_before then
      raise exception 'Absent/non-array contacts replaced rows'; end if;
  end loop;
  foreach v_variant in array array['{}'::jsonb,'{"customers":[]}'::jsonb,'{"customers":null}'::jsonb] loop
    update public.stockflow_snapshots set payload=v_variant where id='suprabha';
    if (select jsonb_agg(to_jsonb(k) order by ordinal) from private.stockflow_customer_contacts k where customer_id=v_customer) is distinct from v_before then
      raise exception 'Partial snapshot replaced contacts'; end if;
  end loop;

  update public.stockflow_snapshots set payload=jsonb_build_object('customers',jsonb_build_array(v_ledger||'{"contacts":[]}'::jsonb)) where id='suprabha';
  if exists(select 1 from private.stockflow_customer_contacts where customer_id=v_customer) then raise exception 'Empty array did not clear contacts'; end if;
  v_read:=public.stockflow_accounts_gateway('contacts-test-key','contacts-sales@example.test','get_accounts','{"search":"Contacts Fixture City"}');
  if v_read->'accounts'->0->'contacts' is distinct from '[]'::jsonb then raise exception 'Empty contacts must be an array'; end if;

  v_contacts:=jsonb_build_array(
    '{"name":" ","source":"ledger_contact"}'::jsonb,
    '{"name":"Bad email","email":"invalid","source":"ledger_contact"}'::jsonb,
    '{"name":"Valid","source":"contact_details"}'::jsonb,
    jsonb_build_object('name',repeat('x',121),'source','ledger_contact'),
    jsonb_build_object('name','Long phone','phone',repeat('1',41),'source','ledger_contact'),
    jsonb_build_object('name','Long email','email',repeat('a',160)||'@','source','ledger_contact'),
    '{"name":"Bad source","source":"manual"}'::jsonb,
    '{"name":"Bad type","phone":123,"source":"ledger_contact"}'::jsonb,
    '{"name":"Also valid","email":"valid@example.test","source":"ledger_contact"}'::jsonb);
  v_ledger:=v_ledger||'{"name":"Updated contacts ledger","phone":"67890","city":"Updated Contacts Fixture City"}'::jsonb;
  update public.stockflow_snapshots set payload=jsonb_build_object('customers',jsonb_build_array(
    v_ledger||jsonb_build_object('contacts',v_contacts),
    '{"tallyKey":"unknown-contacts-fixture","contacts":[{"name":"Unknown","source":"ledger_contact"}]}'::jsonb)) where id='suprabha';
  if (select array_agg(ordinal order by ordinal) from private.stockflow_customer_contacts where customer_id=v_customer) is distinct from array[3,9]::smallint[] then
    raise exception 'Invalid contacts were not skipped with original ordinals'; end if;
  if exists(select 1 from private.stockflow_customers where tally_key='unknown-contacts-fixture') then raise exception 'Unknown ledger created'; end if;
  if not exists(select 1 from private.stockflow_customers where id=v_customer and name='Updated contacts ledger' and phone='67890' and city='Updated Contacts Fixture City' and active) then
    raise exception 'Existing customer sync changed'; end if;

  select jsonb_agg(jsonb_build_object('name','Contact '||n,'source','ledger_contact') order by n) into v_contacts from generate_series(1,22) n;
  update public.stockflow_snapshots set payload=jsonb_build_object('customers',jsonb_build_array(v_ledger||jsonb_build_object('contacts',v_contacts))) where id='suprabha';
  if (select count(*) from private.stockflow_customer_contacts where customer_id=v_customer)<>20 then raise exception 'Storage must stop at position 20'; end if;
  v_read:=public.stockflow_accounts_gateway('contacts-test-key','contacts-sales@example.test','get_accounts','{"search":"Updated Contacts Fixture City"}');
  if jsonb_array_length(v_read->'accounts'->0->'contacts')<>5
    or v_read->'accounts'->0->'contacts'->0->>'name'<>'Contact 1'
    or v_read->'accounts'->0->'contacts'->4->>'name'<>'Contact 5' then raise exception 'Gateway five-contact cap/order failed'; end if;
  if not (select relrowsecurity from pg_class where oid='private.stockflow_customer_contacts'::regclass)
    or has_table_privilege('anon','private.stockflow_customer_contacts','SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated','private.stockflow_customer_contacts','SELECT,INSERT,UPDATE,DELETE')
    or has_function_privilege('authenticated','private.stockflow_sync_tally_customer_contacts()','EXECUTE')
    or has_function_privilege('anon','private.stockflow_sync_tally_customer_contacts()','EXECUTE') then raise exception 'Contacts privilege boundary incorrect'; end if;
end $test$;

rollback;
