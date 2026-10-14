begin;

insert into public.stockflow_members(email,role,roles,status) values
  ('app-contacts-sales@example.test','sales',array['sales'],'active'),
  ('app-contacts-other@example.test','sales',array['sales'],'active'),
  ('app-contacts-manager@example.test','management',array['management'],'active'),
  ('app-contacts-viewer@example.test','viewer',array['viewer'],'active');
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('app-contacts-test-key','sha256'),'hex') where name='orders';

do $test$
declare
  v_customer uuid; v_contact uuid; v_payload jsonb; v_added jsonb; v_result jsonb; v_read jsonb; v_actor text;
begin
  insert into public.stockflow_snapshots(id,company,fetched_at,payload)
    values('suprabha','APP CONTACTS TEST',now()::text,'{"customers":[{"tallyKey":"app-contacts-fixture","name":"App contacts fixture","city":"App Contacts Fixture City","contacts":[{"name":"Tally person","phone":"+91 98765 43210","source":"ledger_contact"}]}]}'::jsonb)
    on conflict(id) do update set payload=excluded.payload;
  select id into strict v_customer from private.stockflow_customers where tally_key='app-contacts-fixture';
  v_payload:=jsonb_build_object('customerId',v_customer,'name',' Sales person ','phone','9876543210','businessRole','Lab head','email','lab@example.test','idempotencyKey','app-contact-add-key-0001');
  v_added:=public.stockflow_accounts_gateway('app-contacts-test-key','app-contacts-sales@example.test','add_contact',v_payload);
  v_contact:=(v_added->>'contactId')::uuid;
  if v_added->'duplicatePhone' is distinct from 'true'::jsonb then raise exception 'Tally duplicate not flagged'; end if;
  v_result:=public.stockflow_accounts_gateway('app-contacts-test-key','app-contacts-sales@example.test','add_contact',v_payload);
  if v_result is distinct from v_added or (select count(*) from private.stockflow_account_contacts where customer_id=v_customer)<>1
    or (select count(*) from private.stockflow_account_contact_events where contact_id=v_contact)<>1 then
    raise exception 'Replay must return identical result without writes'; end if;

  foreach v_actor in array array['app-contacts-sales@example.test','app-contacts-other@example.test','app-contacts-manager@example.test'] loop
    v_read:=public.stockflow_accounts_gateway('app-contacts-test-key',v_actor,'get_accounts','{"search":"App Contacts Fixture City"}');
    if v_read->'accounts'->0->'appContacts'->0->'canEdit' is distinct from to_jsonb(v_actor<>'app-contacts-other@example.test') then
      raise exception 'Incorrect canEdit for %',v_actor; end if;
    if v_read->'accounts'->0->'appContacts'->0->>'name'<>'Sales person' then raise exception 'Name not trimmed'; end if;
  end loop;
  v_payload:=jsonb_build_object('contactId',v_contact,'name','Manager edited','expectedVersion',1,'idempotencyKey','app-contact-edit-key-0001');
  begin
    perform public.stockflow_accounts_gateway('app-contacts-test-key','app-contacts-other@example.test','update_contact',v_payload);
    raise exception 'Other sales edited contact';
  exception when sqlstate '42501' then null; end;
  v_result:=public.stockflow_accounts_gateway('app-contacts-test-key','app-contacts-manager@example.test','update_contact',v_payload);
  if v_result->>'version'<>'2' then raise exception 'Management update did not bump version'; end if;
  begin
    perform public.stockflow_accounts_gateway('app-contacts-test-key','app-contacts-sales@example.test','update_contact',v_payload||'{"idempotencyKey":"app-contact-stale-key-0001"}'::jsonb);
    raise exception 'Stale update accepted';
  exception when sqlstate 'PT409' then null; end;
  begin
    perform public.stockflow_accounts_gateway('app-contacts-test-key','app-contacts-viewer@example.test','add_contact',jsonb_build_object('customerId',v_customer,'name','Viewer person','idempotencyKey','app-contact-viewer-key-0001'));
    raise exception 'Viewer added contact';
  exception when sqlstate '42501' then null; end;
  -- App duplicates are saved too, and all Tally contacts participate in detection.
  perform public.stockflow_accounts_gateway('app-contacts-test-key','app-contacts-sales@example.test','add_contact',jsonb_build_object('customerId',v_customer,'name','App original','phone','+91 90000 00000','idempotencyKey','app-contact-original-key-0001'));
  v_result:=public.stockflow_accounts_gateway('app-contacts-test-key','app-contacts-sales@example.test','add_contact',jsonb_build_object('customerId',v_customer,'name','App duplicate','phone','9000000000','idempotencyKey','app-contact-duplicate-key-0001'));
  if v_result->'duplicatePhone' is distinct from 'true'::jsonb or (select count(*) from private.stockflow_account_contacts where customer_id=v_customer)<>3 then
    raise exception 'App duplicate must be saved and flagged'; end if;
  v_payload:=jsonb_build_object('contactId',v_contact,'expectedVersion',2,'idempotencyKey','app-contact-remove-key-0001');
  begin
    perform public.stockflow_accounts_gateway('app-contacts-test-key','app-contacts-other@example.test','remove_contact',v_payload);
    raise exception 'Other sales removed contact';
  exception when sqlstate '42501' then null; end;
  v_result:=public.stockflow_accounts_gateway('app-contacts-test-key','app-contacts-sales@example.test','remove_contact',v_payload);
  if v_result->>'version'<>'3' then raise exception 'Removal did not bump version'; end if;
  v_read:=public.stockflow_accounts_gateway('app-contacts-test-key','app-contacts-sales@example.test','get_accounts','{"search":"App Contacts Fixture City"}');
  if exists(select 1 from jsonb_array_elements(v_read->'accounts'->0->'appContacts') k where k->>'id'=v_contact::text) then
    raise exception 'Removed contact visible'; end if;
  begin
    perform public.stockflow_accounts_gateway('app-contacts-test-key','app-contacts-sales@example.test','remove_contact',v_payload||'{"expectedVersion":3,"idempotencyKey":"app-contact-remove-key-0002"}'::jsonb);
    raise exception 'Second removal accepted';
  exception when sqlstate 'PT409' then null; end;
  begin
    delete from private.stockflow_account_contacts where id=v_contact;
    raise exception 'Hard delete accepted';
  exception when sqlstate '42501' then null; end;
  if (select array_agg(action order by created_at,id) from private.stockflow_account_contact_events where contact_id=v_contact) is null
    or (select count(*) from private.stockflow_account_contact_events where contact_id=v_contact)<>3
    or not exists(select 1 from private.stockflow_account_contact_events where contact_id=v_contact and action='updated'
      and old_values->>'version'='1' and new_values->>'version'='2' and actor='app-contacts-manager@example.test')
    or not exists(select 1 from private.stockflow_account_contact_events where contact_id=v_contact and action='removed'
      and old_values->>'version'='2' and new_values->>'version'='3') then raise exception 'Audit rows missing'; end if;
  begin
    update private.stockflow_account_contact_events set actor='tampered' where contact_id=v_contact;
    raise exception 'Event mutation accepted';
  exception when sqlstate '42501' then null; end;
  begin
    delete from private.stockflow_account_contact_events where contact_id=v_contact;
    raise exception 'Event deletion accepted';
  exception when sqlstate '42501' then null; end;
  if not (select relrowsecurity from pg_class where oid='private.stockflow_account_contacts'::regclass)
    or not (select relrowsecurity from pg_class where oid='private.stockflow_account_contact_events'::regclass)
    or has_table_privilege('anon','private.stockflow_account_contacts','SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated','private.stockflow_account_contacts','SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('anon','private.stockflow_account_contact_events','SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated','private.stockflow_account_contact_events','SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'Contact privilege boundary incorrect'; end if;
end $test$;

rollback;
