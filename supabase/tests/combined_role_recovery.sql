begin;
alter table public.stockflow_members drop constraint if exists stockflow_members_roles_pending_union;
insert into public.stockflow_members(email,role,status) values
 ('combined-recovery-accounts@test.local','sales','active'),
 ('combined-recovery-management@test.local','viewer','active'),
 ('combined-recovery-ops@test.local','warehouse','active');
update public.stockflow_members set roles=array['sales','accounts'] where email='combined-recovery-accounts@test.local';
update public.stockflow_members set roles=array['management','viewer'] where email='combined-recovery-management@test.local';
update public.stockflow_members set roles=array['sales','warehouse'] where email='combined-recovery-ops@test.local';
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('combined-recovery-key','sha256'),'hex') where name='orders';
do $$
declare result jsonb; payload jsonb; action text;
begin
  perform private.begin_stockflow_command('combined-recovery-accounts@test.local','create_price_contract','combined-recovery-receipt','{}');
  perform private.finish_stockflow_command('combined-recovery-accounts@test.local','create_price_contract','combined-recovery-receipt','{}',null,'{"price":999,"cost":400}'::jsonb);
  payload:='{"pricingAction":"create_price_contract","idempotencyKey":"combined-recovery-receipt"}'::jsonb;
  result:=public.stockflow_submission_recovery_gateway('combined-recovery-key','combined-recovery-accounts@test.local','recover_order_submission',payload);
  if result<>'{"status":"accepted"}'::jsonb then raise exception 'Recovery lost receipt or leaked commercial result: %',result; end if;
  foreach action in array array['create_price_contract','approve_customer_price_book','approve_customer_group_margin'] loop
    begin
      perform public.stockflow_submission_recovery_gateway('combined-recovery-key','combined-recovery-ops@test.local','recover_order_submission',
        payload||jsonb_build_object('pricingAction',action,'roles',jsonb_build_array('administrator')));
      raise exception 'Operational-only pricing recovery accepted';
    exception when insufficient_privilege then null; end;
  end loop;
  payload:=payload||jsonb_build_object('pricingAction','approve_customer_group_margin','idempotencyKey','combined-group-close-key','closeUnresolved',true);
  result:=public.stockflow_submission_recovery_gateway('combined-recovery-key','combined-recovery-management@test.local','recover_order_submission',payload);
  if result<>'{"status":"not_saved"}'::jsonb then raise exception 'Secondary management closure failed'; end if;
  if public.stockflow_submission_recovery_gateway('combined-recovery-key','combined-recovery-management@test.local','recover_order_submission',payload) is distinct from result then
    raise exception 'Closure replay changed';
  end if;
  begin
    perform public.stockflow_submission_recovery_gateway('combined-recovery-key','combined-recovery-accounts@test.local','recover_order_submission',payload);
    raise exception 'Accounts gained group management recovery';
  exception when insufficient_privilege then null; end;
  update public.stockflow_members set status='suspended' where email='combined-recovery-accounts@test.local';
  begin
    perform public.stockflow_submission_recovery_gateway('combined-recovery-key','combined-recovery-accounts@test.local','recover_order_submission',
      '{"pricingAction":"create_price_contract","idempotencyKey":"combined-recovery-receipt"}');
    raise exception 'Suspended receipt read accepted';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
