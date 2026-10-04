begin;
alter table public.stockflow_members drop constraint stockflow_members_roles_pending_union;
insert into public.stockflow_members(email,role,status) values('combined-read@test.local','sales','active');
update public.stockflow_members set roles=array['sales','warehouse'] where email='combined-read@test.local';
update private.stockflow_role_order_scopes set scope='created_by' where role='sales';
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('combined-read-key','sha256'),'hex') where name='orders';
insert into private.stockflow_orders(id,customer_name,status,idempotency_key,created_by_email,updated_by_email)
values('50000000-0000-4000-8000-000000000001','Combined read sentinel','confirmed','combined-read-seed','other@test.local','test');
do $$
declare result jsonb; evidence jsonb;
begin
  result:=public.stockflow_order_list_gateway('combined-read-key','combined-read@test.local','list_orders','{"query":"Combined read sentinel"}');
  if result->'pagination'->>'total'<>'1' or jsonb_array_length(result->'orders')<>1 then raise exception 'Combined list scope/count failed'; end if;
  perform public.stockflow_order_detail_gateway('combined-read-key','combined-read@test.local','get_order_details',
    '{"orderId":"50000000-0000-4000-8000-000000000001"}');
  evidence:=private.stockflow_operational_invoice('{"voucherNumber":"SD/26-27/0552","party":"Customer","date":"2026-10-04","rate":99,"cost":33,"discount":4,"lineItems":[{"itemName":"Reagent","quantity":2,"rate":99,"amount":198}]}'::jsonb);
  if evidence ? 'rate' or evidence ? 'cost' or evidence ? 'discount'
    or evidence->'lineItems'->0 ? 'rate' or evidence->'lineItems'->0 ? 'amount'
    or evidence->'lineItems'->0->>'quantity'<>'2' or evidence->>'voucherNumber'<>'SD/26-27/0552' then
    raise exception 'Operational invoice lost reconciliation evidence or leaked commercial data';
  end if;
  update public.stockflow_members set roles=array['sales'] where email='combined-read@test.local';
  result:=public.stockflow_order_list_gateway('combined-read-key','combined-read@test.local','list_orders','{"query":"Combined read sentinel","roles":["administrator"]}');
  if result->'pagination'->>'total'<>'0' then raise exception 'Payload scope escalation'; end if;
  begin
    perform public.stockflow_order_detail_gateway('combined-read-key','combined-read@test.local','get_order_details',
      '{"orderId":"50000000-0000-4000-8000-000000000001"}');
    raise exception 'Unauthorized detail accepted';
  exception when insufficient_privilege then null; end;
  update public.stockflow_members set status='suspended' where email='combined-read@test.local';
  begin
    perform public.stockflow_order_list_gateway('combined-read-key','combined-read@test.local','list_orders','{}');
    raise exception 'Suspended list accepted';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
