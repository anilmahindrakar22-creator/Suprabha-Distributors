begin;
alter table public.stockflow_members drop constraint if exists stockflow_members_roles_pending_union;
insert into public.stockflow_members(email,role,status) values
 ('combined-domain@test.local','viewer','active'),('combined-domain-denied@test.local','accounts','active');
update public.stockflow_members set roles=array['operations','viewer'] where email='combined-domain@test.local';
update public.stockflow_members set roles=array['accounts','warehouse'] where email='combined-domain-denied@test.local';
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('combined-domain-key','sha256'),'hex') where name='orders';
insert into public.stockflow_snapshots(id,company,fetched_at,payload) values('suprabha','TEST',now()::text,'{"catalog":[]}'::jsonb)
on conflict(id) do update set payload=stockflow_snapshots.payload||'{"catalog":[]}'::jsonb;
do $$
declare result jsonb; request_id uuid; payload jsonb;
begin
 payload:='{"productName":"Combined role missing fixture","idempotencyKey":"combined-domain-product-create"}';
 result:=public.stockflow_product_request_gateway('combined-domain-key','combined-domain@test.local','create_product_request',payload);
 request_id:=(result->>'requestId')::uuid;
 if public.stockflow_product_request_gateway('combined-domain-key','combined-domain@test.local','create_product_request',payload) is distinct from result then
   raise exception 'Secondary Operations product replay changed'; end if;
 if jsonb_array_length(public.stockflow_product_request_gateway('combined-domain-key','combined-domain@test.local','list_product_requests','{}')->'requests')<1 then
   raise exception 'Secondary Operations inbox inaccessible'; end if;
 result:=public.stockflow_product_request_gateway('combined-domain-key','combined-domain@test.local','review_product_request',
   jsonb_build_object('requestId',request_id,'expectedVersion',1,'status','rejected','resolution','Not in approved range','idempotencyKey','combined-domain-product-review'));
 if result->>'version'<>'2' then raise exception 'Secondary Operations review failed'; end if;
 begin
  perform public.stockflow_product_request_gateway('combined-domain-key','combined-domain-denied@test.local','create_product_request',payload||'{"roles":["administrator"]}'::jsonb);
  raise exception 'Forged product permission accepted';
 exception when insufficient_privilege then null; end;
 -- Prove role admission at the real existing Service boundary without creating an asset/ticket.
 begin
  perform public.stockflow_service_gateway('combined-domain-key','combined-domain@test.local','resolve_service_ticket',
    '{"idempotencyKey":"combined-domain-service-check","resolution":""}');
  raise exception 'Invalid Service request accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.stockflow_service_gateway('combined-domain-key','combined-domain-denied@test.local','resolve_service_ticket',
    '{"idempotencyKey":"combined-domain-service-denied","resolution":""}');
  raise exception 'Warehouse/Accounts gained Service resolution';
 exception when insufficient_privilege then null; end;
 update public.stockflow_members set status='suspended' where email='combined-domain@test.local';
 begin
  perform public.stockflow_product_request_gateway('combined-domain-key','combined-domain@test.local','create_product_request',payload);
  raise exception 'Suspended domain replay accepted';
 exception when insufficient_privilege then null; end;
end $$;
rollback;
