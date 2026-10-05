begin;
alter table public.stockflow_members drop constraint stockflow_members_roles_pending_union;
insert into public.stockflow_members(email,role,status) values
 ('combined-billing@test.local','sales','active'),('combined-billing-denied@test.local','warehouse','active');
update public.stockflow_members set roles=array['sales','accounts'] where email='combined-billing@test.local';
update public.stockflow_members set roles=array['sales','warehouse'] where email='combined-billing-denied@test.local';
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('combined-billing-key','sha256'),'hex') where name='orders';
insert into private.stockflow_orders(id,customer_name,status,tally_invoice_number,idempotency_key,created_by_email,updated_by_email)
values('70000000-0000-4000-8000-000000000001','Combined billing','billed_in_tally','552','combined-billing-seed','other@test.local','test');
do $$
declare payload jsonb; result jsonb;
begin
 payload:=jsonb_build_object('orderId','70000000-0000-4000-8000-000000000001','expectedVersion',1,
   'idempotencyKey','combined-billing-review','note','Test billing reconciliation','outcome','investigating');
 begin
   perform public.stockflow_billing_review_gateway('combined-billing-key','combined-billing-denied@test.local','record_billing_review',payload||'{"roles":["administrator"]}'::jsonb);
   raise exception 'Forged operational billing approval accepted';
 exception when insufficient_privilege then null; end;
 result:=public.stockflow_billing_review_gateway('combined-billing-key','combined-billing@test.local','record_billing_review',payload);
 if result->>'version'<>'2' then raise exception 'Secondary Accounts billing review failed'; end if;
 if public.stockflow_billing_review_gateway('combined-billing-key','combined-billing@test.local','record_billing_review',payload) is distinct from result then
   raise exception 'Billing receipt replay changed'; end if;
 if (select count(*) from private.stockflow_order_events where order_id='70000000-0000-4000-8000-000000000001'
   and event_type='billing_reconciliation_reviewed' and metadata->'assignedRoles'='["sales","accounts"]'::jsonb)<>1 then
   raise exception 'Billing audit missing or duplicated'; end if;
 begin
   perform public.stockflow_billing_review_gateway('combined-billing-key','combined-billing@test.local','record_billing_review',
     payload||'{"idempotencyKey":"combined-billing-stale"}'::jsonb);
   raise exception 'Stale billing review accepted';
 exception when serialization_failure or sqlstate 'PT409' then null; end;
 update private.stockflow_role_order_scopes set scope='created_by' where role in ('sales','accounts');
 begin
   perform public.stockflow_billing_review_gateway('combined-billing-key','combined-billing@test.local','record_billing_review',payload);
   raise exception 'Narrowed scope replay accepted';
 exception when insufficient_privilege then null; end;
 update private.stockflow_role_order_scopes set scope='global' where role='accounts';
 update private.stockflow_orders set archived_at=now() where id='70000000-0000-4000-8000-000000000001';
 begin
   perform public.stockflow_billing_review_gateway('combined-billing-key','combined-billing@test.local','record_billing_review',payload);
   raise exception 'Archived billing replay accepted';
 exception when insufficient_privilege then null; end;
 if (select version from private.stockflow_orders where id='70000000-0000-4000-8000-000000000001')<>2 then
   raise exception 'Failed review changed version'; end if;
end $$;
rollback;
