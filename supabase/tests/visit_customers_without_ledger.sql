begin;
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('visit-customer-test-key','sha256'),'hex') where name='orders';
insert into public.stockflow_members(email,role,roles,status) values
 ('visit-create-sales@test.local','sales',array['sales'],'active'),
 ('visit-create-ops@test.local','operations',array['operations'],'active'),
 ('visit-create-manager@test.local','management',array['management'],'active'),
 ('visit-create-viewer@test.local','viewer',array['viewer'],'active'),
 ('visit-create-suspended@test.local','sales',array['sales'],'suspended');
insert into public.stockflow_snapshots(id,company,fetched_at,payload) values('suprabha','SUPRABHA TEST',now()::text,'{}') on conflict(id) do nothing;
do $test$
declare v_id uuid;v_visit uuid;v_contact uuid;v_result jsonb;v_payload jsonb;v_read jsonb;v_actor text;v_count bigint;
begin
 v_payload:='{"name":"Visit only fixture lab","city":"Bidar","phone":"9876543210","idempotencyKey":"visit-create-first-0001"}';
 v_result:=public.stockflow_accounts_gateway('visit-customer-test-key','visit-create-sales@test.local','create_customer',v_payload);
 v_id:=(v_result->>'customerId')::uuid;
 if v_id is null or v_result->>'tallyLedgerState'<>'no_ledger'
   or not exists(select 1 from private.stockflow_customers where id=v_id and active and tally_key is null and tally_balance is null and created_by_email='visit-create-sales@test.local') then raise exception 'Visit customer needs no Tally ledger or balance';end if;
 if public.stockflow_accounts_gateway('visit-customer-test-key','visit-create-sales@test.local','create_customer',v_payload) is distinct from v_result
   or (select count(*) from private.stockflow_customer_creation_events where customer_id=v_id)<>1 then raise exception 'Create replay duplicated customer/event';end if;
 begin
  perform public.stockflow_accounts_gateway('visit-customer-test-key','visit-create-sales@test.local','create_customer',v_payload||'{"name":"Changed name"}');
  raise exception 'Changed command content replayed';
 exception when sqlstate '22023' then null;end;
 begin
  perform public.stockflow_accounts_gateway('visit-customer-test-key','visit-create-ops@test.local','create_customer',v_payload||'{"name":" VISIT ONLY FIXTURE LAB ","idempotencyKey":"visit-create-duplicate-0001"}');
  raise exception 'Duplicate active customer created';
 exception when sqlstate 'PT409' then null;end;
 foreach v_actor in array array['visit-create-viewer@test.local','visit-create-suspended@test.local','missing@test.local'] loop
  begin
   perform public.stockflow_accounts_gateway('visit-customer-test-key',v_actor,'create_customer',v_payload);
   raise exception 'Unauthorized customer creation';
  exception when insufficient_privilege then null;end;
 end loop;
 begin
  perform public.stockflow_accounts_gateway('visit-customer-test-key','visit-create-sales@test.local','create_customer',v_payload||'{"tallyKey":"unverified","idempotencyKey":"visit-create-forged-0001"}');
  raise exception 'Unverified ledger accepted through create';
 exception when sqlstate '22023' then null;end;
 v_result:=public.stockflow_accounts_gateway('visit-customer-test-key','visit-create-sales@test.local','log_visit',jsonb_build_object('customerId',v_id,'visitedOn',(now() at time zone 'Asia/Kolkata')::date,'outcome','met','idempotencyKey','visit-create-visit-0001'));
 v_visit:=(v_result->>'visitId')::uuid;
 v_result:=public.stockflow_accounts_gateway('visit-customer-test-key','visit-create-sales@test.local','add_contact',jsonb_build_object('customerId',v_id,'name','Fixture visitor contact','idempotencyKey','visit-create-contact-0001'));
 v_contact:=(v_result->>'contactId')::uuid;
 if v_visit is null or v_contact is null then raise exception 'Cannot log visits/contacts without ledger';end if;
 v_read:=public.stockflow_accounts_gateway('visit-customer-test-key','visit-create-sales@test.local','get_accounts','{"search":"Visit only fixture lab"}');
 if v_read->'accounts'->0->>'tallyLedgerState'<>'no_ledger' or v_read->'accounts'->0->'class'->>'state'<>'not_linked' then raise exception 'App-only customer shown as financial zero/linked';end if;
 -- Unrelated complete customer sync must retain the visit-only customer.
 update public.stockflow_snapshots set payload='{"customers":[{"tallyKey":"Visit other fixture ledger","name":"Visit other fixture ledger"}]}' where id='suprabha';
 if not exists(select 1 from private.stockflow_customers where id=v_id and active and tally_key is null) then raise exception 'Sync removed a visit customer';end if;
 -- The first exact ledger stays pending for a person, without duplicating the UUID.
 update public.stockflow_snapshots set payload=jsonb_build_object('customers',jsonb_build_array(jsonb_build_object('tallyKey','Visit only fixture lab','name','Visit only fixture lab','tallyBalance',150)),
  'economicEvidence',jsonb_build_object('schemaVersion','1','companyId','visit-customer-company','sourceVersion','2026-10-15T12:00:00Z','completeWindow',true,'windowFrom','2026-10-01','windowTo','2026-11-01','vouchers','[]'::jsonb,'customerLedgers','[{"guid":"visit-lab-guid","name":"Visit only fixture lab"}]'::jsonb)) where id='suprabha';
 if (select count(*) from private.stockflow_customers where name='Visit only fixture lab')<>1 or exists(select 1 from private.stockflow_economic_customer_identities where customer_id=v_id) then raise exception 'Source sync guessed identity or created a duplicate';end if;
 v_read:=public.stockflow_economics_gateway('visit-customer-test-key','visit-create-manager@test.local','get_link_suggestions','{"companyId":"visit-customer-company"}');
 if v_read->'rows'->0->>'customerId'<>v_id::text or v_read->'rows'->0->>'state'<>'suggested' then raise exception 'App-only exact ledger cannot be reviewed';end if;
 v_payload:=jsonb_build_object('companyId','visit-customer-company','sourceVersion','2026-10-15T12:00:00Z','rows',jsonb_build_array(jsonb_build_object('customerId',v_id,'ledgerGuid','visit-lab-guid')),'reason','Checked new ledger','idempotencyKey','visit-create-link-0001');
 v_result:=public.stockflow_economics_gateway('visit-customer-test-key','visit-create-manager@test.local','confirm_customer_links',v_payload);
 if public.stockflow_economics_gateway('visit-customer-test-key','visit-create-manager@test.local','confirm_customer_links',v_payload) is distinct from v_result then raise exception 'Link replay changed';end if;
 -- Canonical GUID, rather than old name, retains the same record after rename.
 update public.stockflow_snapshots set payload=jsonb_build_object('customers',jsonb_build_array(jsonb_build_object('tallyKey','Visit renamed fixture lab','name','Visit renamed fixture lab','tallyBalance',150)),
  'economicEvidence',jsonb_build_object('schemaVersion','1','companyId','visit-customer-company','sourceVersion','2026-10-15T13:00:00Z','completeWindow',true,'windowFrom','2026-10-01','windowTo','2026-11-01','vouchers','[]'::jsonb,'customerLedgers','[{"guid":"visit-lab-guid","name":"Visit renamed fixture lab"}]'::jsonb)) where id='suprabha';
 if not exists(select 1 from private.stockflow_customers where id=v_id and active and name='Visit renamed fixture lab' and tally_key='Visit renamed fixture lab' and tally_balance=150)
  or not exists(select 1 from private.stockflow_customer_visits where id=v_visit and customer_id=v_id)
  or not exists(select 1 from private.stockflow_account_contacts where id=v_contact and customer_id=v_id)
  or (select count(*) from private.stockflow_customer_identity_events where customer_id=v_id)<>1 then raise exception 'Rename lost original customer/history or required another link';end if;
 v_read:=public.stockflow_economics_gateway('visit-customer-test-key','visit-create-manager@test.local','get_link_suggestions','{"companyId":"visit-customer-company","state":"linked"}');
 if v_read->'rows'->0->>'customerId'<>v_id::text then raise exception 'Linked customer disappeared after rename';end if;
 select count(*) into v_count from private.stockflow_customer_creation_events;
 begin update private.stockflow_customer_creation_events set actor='rewritten';raise exception 'Creation audit mutable';exception when insufficient_privilege then null;end;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname='stockflow_customer_creation_events' and not c.relrowsecurity)
  or has_table_privilege('authenticated','private.stockflow_customer_creation_events','INSERT') or has_table_privilege('service_role','private.stockflow_customer_creation_events','INSERT') then raise exception 'Creation audit access exposed';end if;
end $test$;
rollback;
