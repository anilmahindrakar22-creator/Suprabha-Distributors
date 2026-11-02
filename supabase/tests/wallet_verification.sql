begin;
insert into private.stockflow_gateway_config(name,secret_sha256)
values('orders',encode(extensions.digest('wallet-verification-test-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,status) values
 ('wallet-verifier-a@test.local','administrator','active'),
 ('wallet-verifier-b@test.local','administrator','active'),
 ('wallet-verifier-ops@test.local','operations','active'),
 ('wallet-verifier-sales@test.local','sales','active');
insert into private.stockflow_customers(id,name,tally_key,created_by_email) values
 ('19200000-0000-4000-8000-000000000001','Verification lab','wallet-verification','test');

create function pg_temp.verification_command(actor text,payload jsonb) returns jsonb language sql as $$
 select public.stockflow_wallet_gateway('wallet-verification-test-key',actor,'verify_wallet_snapshot',payload);
$$;
create function pg_temp.verification_invalid(actor text,payload jsonb,expected_state text,expected_message text)
returns void language plpgsql as $$
declare before_count bigint; rejected boolean:=false;
begin
 select count(*) into before_count from private.stockflow_wallet_verifications;
 begin
  perform pg_temp.verification_command(actor,payload);
 exception when others then
  if sqlstate<>expected_state or sqlerrm<>expected_message then raise;end if;
  rejected:=true;
 end;
 if not rejected then raise exception 'Expected verification rejection: %',expected_message;end if;
 if (select count(*) from private.stockflow_wallet_verifications)<>before_count then
  raise exception 'Rejected verification left a row';
 end if;
end$$;

do $checks$
declare
 actor_a text:='wallet-verifier-a@test.local'; actor_b text:='wallet-verifier-b@test.local';
 customer uuid:='19200000-0000-4000-8000-000000000001';
 saved uuid; newer uuid; result jsonb; first_result jsonb; account jsonb; workspace_row jsonb;
 record_payload jsonb; payload jsonb; blocked boolean;
begin
 record_payload:=jsonb_build_object('requestId','wallet-verification-record-0001','customerId',customer,
  'monthlyWalletPaise',8200000,'method','manager_estimate','source','Lab visit','confidence','medium',
  'asOf','2026-10-30','note','Reviewed lab estimate','loweredReason',null,'divisions',jsonb_build_array(),
  'expectedCurrentSnapshotId',null);
 result:=public.stockflow_wallet_gateway('wallet-verification-test-key',actor_a,'record_wallet_snapshot',record_payload);
 saved:=(result->>'snapshotId')::uuid;
 if saved is null then raise exception 'WV1 record failed';end if;
 payload:=jsonb_build_object('requestId','wallet-verification-verify-0001','snapshotId',saved,'note','Checked invoices with the lab');

 -- WV2: even a differently cased actor email cannot verify their own estimate.
 perform pg_temp.verification_invalid(upper(actor_a),payload||jsonb_build_object('requestId','wallet-verification-self-0001'),
  '22023','Someone other than the person who entered it must verify');
 if exists(select 1 from private.stockflow_wallet_verifications where snapshot_id=saved) then
  raise exception 'WV2 self-verification left a row';
 end if;

 -- WV1: second administrator verifies; both read models expose the provenance.
 first_result:=pg_temp.verification_command(actor_b,payload);
 if first_result->>'ok' is distinct from 'true' or first_result->>'snapshotId' is distinct from saved::text
  or first_result->>'verifiedBy' is distinct from actor_b or first_result->>'verifiedAt' is null then
  raise exception 'WV1 unexpected verification result: %',first_result;
 end if;
 account:=public.stockflow_wallet_gateway('wallet-verification-test-key',actor_a,'get_wallet_account',jsonb_build_object('customerId',customer));
 if account#>>'{current,verifiedBy}' is distinct from actor_b
  or account#>>'{current,verifiedAt}' is distinct from first_result->>'verifiedAt'
  or account#>>'{current,verificationNote}' is distinct from payload->>'note'
  or account#>'{history,0}' is distinct from account->'current' then
  raise exception 'WV1 account provenance missing: %',account;
 end if;
 result:=public.stockflow_wallet_gateway('wallet-verification-test-key',actor_a,'get_wallet_workspace',
  jsonb_build_object('view','all','page',1,'search','Verification lab'));
 select value into workspace_row from jsonb_array_elements(result->'rows') where value->>'customerId'=customer::text;
 if workspace_row->>'verified' is distinct from 'true' then raise exception 'WV1 workspace not verified';end if;
 if (select verified_by from private.stockflow_wallet_snapshots where id=saved) is not null then
  raise exception 'WV1 immutable snapshot was changed';
 end if;
 if not exists(select 1 from private.stockflow_wallet_verifications where snapshot_id=saved
  and request_id=payload->>'requestId' and verified_by=actor_b and note=payload->>'note') then
  raise exception 'WV1 verification provenance not stored';
 end if;

 -- WV4: a new request conflicts; an exact retry returns the original result.
 perform pg_temp.verification_invalid(actor_b,payload||jsonb_build_object('requestId','wallet-verification-duplicate-0001'),
  'PT409','Estimate is already verified');
 if pg_temp.verification_command(actor_b,payload) is distinct from first_result
  or (select count(*) from private.stockflow_wallet_verifications where snapshot_id=saved)<>1 then
  raise exception 'WV4 verification replay changed the result or inserted twice';
 end if;

 -- WV3: the newer current snapshot clears the workspace flag, retaining history.
 record_payload:=record_payload||jsonb_build_object('requestId','wallet-verification-record-0002',
  'asOf','2026-10-31','expectedCurrentSnapshotId',saved);
 result:=public.stockflow_wallet_gateway('wallet-verification-test-key',actor_a,'record_wallet_snapshot',record_payload);
 newer:=(result->>'snapshotId')::uuid;
 if newer is null or newer=saved then raise exception 'WV3 newer snapshot missing';end if;
 perform pg_temp.verification_invalid(actor_b,payload||jsonb_build_object('requestId','wallet-verification-old-0001'),
  '22023','Only the current estimate can be verified');
 result:=public.stockflow_wallet_gateway('wallet-verification-test-key',actor_a,'get_wallet_workspace',
  jsonb_build_object('view','all','page',1,'search','Verification lab'));
 select value into workspace_row from jsonb_array_elements(result->'rows') where value->>'customerId'=customer::text;
 if workspace_row->>'verified' is distinct from 'false' then raise exception 'WV3 workspace retained old verification';end if;
 account:=public.stockflow_wallet_gateway('wallet-verification-test-key',actor_b,'get_wallet_account',jsonb_build_object('customerId',customer));
 if account#>>'{current,id}' is distinct from newer::text or account#>>'{current,verifiedBy}' is not null
  or account#>>'{current,verifiedAt}' is not null or account#>>'{current,verificationNote}' is not null
  or account#>>'{history,1,verifiedBy}' is distinct from actor_b then
  raise exception 'WV3 current/history verification incorrect';
 end if;
 if pg_temp.verification_command(actor_b,payload) is distinct from first_result then
  raise exception 'WV4 original replay failed after a newer estimate';
 end if;

 -- WV5: roles and the shared trimmed note validation reject without writes.
 payload:=payload||jsonb_build_object('snapshotId',newer,'requestId','wallet-verification-role-0001');
 perform pg_temp.verification_invalid('wallet-verifier-ops@test.local',payload,'PT403','Wallet management access required');
 perform pg_temp.verification_invalid('wallet-verifier-sales@test.local',payload||jsonb_build_object('requestId','wallet-verification-role-0002'),
  'PT403','Wallet management access required');
 perform pg_temp.verification_invalid(actor_b,(payload-'note')||jsonb_build_object('requestId','wallet-verification-note-0001'),
  '22023','Wallet note required');
 perform pg_temp.verification_invalid(actor_b,payload||jsonb_build_object('requestId','wallet-verification-note-0002','note',' ab '),
  '22023','Wallet note required');
 perform pg_temp.verification_invalid(actor_b,payload||jsonb_build_object('requestId','wallet-verification-note-0003','note',repeat('a',501)),
  '22023','Wallet note required');
 perform pg_temp.verification_invalid(actor_b,payload||jsonb_build_object('requestId','wallet-verification-missing-0001',
  'snapshotId','19200000-0000-4000-8000-000000000099'),'22023','Estimate not found');

 -- WV6: both triggers raise, and the original verification remains intact.
 blocked:=false;
 begin
  update private.stockflow_wallet_verifications set note='Changed verification note' where snapshot_id=saved;
 exception when others then blocked:=true;
 end;
 if not blocked then raise exception 'WV6 verification update accepted';end if;
 blocked:=false;
 begin
  delete from private.stockflow_wallet_verifications where snapshot_id=saved;
 exception when others then blocked:=true;
 end;
 if not blocked then raise exception 'WV6 verification delete accepted';end if;
 if (select count(*) from private.stockflow_wallet_verifications where snapshot_id=saved)<>1
  or (select note from private.stockflow_wallet_verifications where snapshot_id=saved) is distinct from 'Checked invoices with the lab' then
  raise exception 'WV6 verification changed';
 end if;
 raise notice 'PASS wallet_verification';
end $checks$;
rollback;
