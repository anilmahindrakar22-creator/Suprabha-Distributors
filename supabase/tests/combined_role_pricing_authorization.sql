begin;
alter table public.stockflow_members drop constraint if exists stockflow_members_roles_pending_union;
insert into public.stockflow_members(email,role,status) values
 ('combined-commercial@test.local','sales','active'),
 ('combined-reviewer@test.local','warehouse','active'),
 ('combined-operational@test.local','sales','active');
update public.stockflow_members set roles=array['sales','accounts'] where email='combined-commercial@test.local';
update public.stockflow_members set roles=array['administrator','warehouse'] where email='combined-reviewer@test.local';
update public.stockflow_members set roles=array['sales','warehouse'] where email='combined-operational@test.local';
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('combined-pricing-key','sha256'),'hex') where name='orders';
do $$
declare customer uuid; proposal jsonb; approved jsonb; action text; payload jsonb;
begin
  insert into private.stockflow_customers(name,tally_key,created_by_email)
    values('Combined pricing test','combined-pricing-customer','test') returning id into customer;
  insert into private.stockflow_products(tally_item_key,name,base_unit)
    values('COMBINED-PRICE','Combined reagent','Nos');
  payload:=jsonb_build_object('customerId',customer,'tallyKey','COMBINED-PRICE','price',725,
    'validFrom',current_date,'source','customer_contract','reason','Combined contract test','idempotencyKey','combined-contract-create');
  proposal:=public.stockflow_pricing_gateway('combined-pricing-key','combined-commercial@test.local','create_price_contract',payload);
  if proposal->>'contractId' is null then raise exception 'Secondary Accounts proposal failed'; end if;
  -- Accounts read access must never imply management approval.
  begin
    perform public.stockflow_pricing_gateway('combined-pricing-key','combined-commercial@test.local','approve_price_contract',
      jsonb_build_object('contractId',proposal->>'contractId','expectedVersion',1,'reason','Forged approval',
        'idempotencyKey','combined-account-approve','roles',jsonb_build_array('administrator')));
    raise exception 'Accounts acquired approval permission';
  exception when insufficient_privilege then null; end;
  approved:=public.stockflow_pricing_gateway('combined-pricing-key','combined-reviewer@test.local','approve_price_contract',
    jsonb_build_object('contractId',proposal->>'contractId','expectedVersion',1,'reason','Combined approval verified',
      'idempotencyKey','combined-admin-approve'));
  if not exists(select 1 from private.stockflow_customer_product_prices
    where id=(proposal->>'contractId')::uuid and status='approved' and price_amount=725) then
    raise exception 'Secondary administrator approval failed';
  end if;
  perform public.stockflow_pricing_gateway('combined-pricing-key','combined-commercial@test.local','list_price_contracts','{}');
  foreach action in array array['list_price_contracts','list_pricing_policies','list_standard_item_prices',
    'get_customer_price_book','preview_customer_prices','get_order_pricing','create_price_contract'] loop
    begin
      perform public.stockflow_pricing_gateway('combined-pricing-key','combined-operational@test.local',action,
        payload||jsonb_build_object('roles',jsonb_build_array('administrator')));
      raise exception 'Operational role set retrieved or mutated pricing: %',action;
    exception when insufficient_privilege then null; end;
  end loop;
  update public.stockflow_members set status='suspended' where email='combined-commercial@test.local';
  begin
    perform public.stockflow_pricing_gateway('combined-pricing-key','combined-commercial@test.local','list_price_contracts','{}');
    raise exception 'Suspended commercial read accepted';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
