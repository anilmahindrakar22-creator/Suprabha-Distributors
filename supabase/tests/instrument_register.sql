-- The replay harness runs this branch immediately before the register migration.
-- Exercise the actual migration on populated legacy tables, then roll it back.
\if :{?instrument_register_upgrade}
begin;
do $seed$
declare c uuid;o uuid;i uuid;t uuid;v uuid;l uuid;r uuid;
begin
 insert into private.stockflow_customers(name,tally_key,created_by_email)
 values('D14 upgrade customer','d14-upgrade-customer','test') returning id into c;
 insert into private.stockflow_orders(customer_id,customer_name,source,status,created_by_email,updated_by_email,idempotency_key)
 values(c,'D14 upgrade customer','phone','delivered','test','test','d14-upgrade-order') returning id into o;
 insert into private.stockflow_equipment_installations(order_id,tally_key,item_name,status,scheduled_date,serial_number,created_by_email,completed_at)
 values(o,'d14-upgrade','Upgrade machine','completed',current_date-60,'UPGRADE-D14','test',now()-interval '60 days') returning id into i;
 insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
 values('d14-upgrade','customer',c,'test');
 insert into private.stockflow_economic_targets(kind,name,company_id,customer_id,customer_source_id,site_id,model_id,installation_id,effective_from,created_by)
 values('placement','Upgrade placement','d14-upgrade',c,'customer','site','model',i,current_date-60,'test') returning id into t;
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,kind,evidence)
 values('d14-upgrade','sale',1,current_date-30,'customer','sale','{}') returning id into v;
 insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
 values(v,'1','reagent',1,'qty',10000,'{}') returning id into l;
 insert into private.stockflow_economic_runs(actor) values('test') returning id into r;
 insert into private.stockflow_economic_results(run_id,source_line_id,target_id,status,reason,share_bps,quantity,revenue_paise,cost_paise,gp_paise)
 values(r,l,t,'attributed','Upgrade fixture',10000,1,10000,5000,5000);
 insert into private.stockflow_economic_events(target_id,kind,amount_paise,effective_date,request_id,actor,reason)
 values(t,'capital',100000,current_date-60,'d14-upgrade-capital','test','Upgrade fixture');
 insert into private.stockflow_economic_expectations(target_id,effective_from,monthly_revenue_paise,monthly_gp_paise,reason,created_by)
 values(t,current_date-60,10000,5000,'Upgrade fixture','test');
 insert into private.stockflow_service_tickets(installation_id,order_id,category,summary,created_by_email)
 values(i,o,'calibration','D14 existing service ticket','test');
end$seed$;
create temporary table d14_upgrade_snapshot as
 select 'placements' as kind,coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb)::text as bytes from private.stockflow_economic_targets t
 union all select 'events',coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb)::text from private.stockflow_economic_events t
 union all select 'results',coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb)::text from private.stockflow_economic_results t
 union all select 'expectations',coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb)::text from private.stockflow_economic_expectations t
 union all select 'service',coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb)::text from private.stockflow_service_tickets t;
-- These migrations use BEGIN/COMMIT, so the harness supplies copies with only
-- their outer transaction statements removed for this rollback-only exercise.
\i :instrument_register_migration
\i :instrument_register_read_migration
do $verify$
declare actual text;rel text;
begin
 foreach rel in array array['placements','events','results','expectations','service'] loop
  execute format('select coalesce(jsonb_agg(to_jsonb(t) order by t.id),''[]''::jsonb)::text from private.%I t',
   case rel when 'placements' then 'stockflow_economic_targets' when 'events' then 'stockflow_economic_events'
    when 'results' then 'stockflow_economic_results' when 'expectations' then 'stockflow_economic_expectations' else 'stockflow_service_tickets' end) into actual;
  if actual is distinct from (select bytes from d14_upgrade_snapshot where kind=rel) then
   raise exception 'D14 migration changed existing % bytes',rel;
  end if;
 end loop;
 if exists(select 1 from private.stockflow_equipment_installations where status='completed' and instrument_id is null)
  or (select count(*) from private.stockflow_instruments)<>(select count(distinct private.stockflow_instrument_serial_key(serial_number)) from private.stockflow_equipment_installations where status='completed') then
  raise exception 'D14 backfill identity/count mismatch';
 end if;
 if not exists(select 1 from private.stockflow_instruments where serial_key='UPGRADED14' and model_id='model') then
  raise exception 'D14 backfill lost placement model';
 end if;
end$verify$;
rollback;
\else
begin;
-- Own fixtures. ZD015 subtransactions roll back every scenario, including DDL.
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('d14-test-key','sha256'),'hex') where name='orders';
insert into public.stockflow_members(email,role,status) values('d14-manager@test.local','management','active');
insert into public.stockflow_snapshots(id,company,fetched_at,payload)
 values('suprabha','D14 fixture',now()::text,'{"catalog":[]}'::jsonb) on conflict(id) do nothing;
insert into private.stockflow_customers(id,name,tally_key,created_by_email) values
 ('d1400000-0000-4000-8000-000000000001','D14 Lab A','d14-lab-a','test'),
 ('d1400000-0000-4000-8000-000000000002','D14 Lab B','d14-lab-b','test');
insert into private.stockflow_economic_policy_versions(attractive_months,review_months,exception_months,actor,reason,automatic_approval,automatic_purchase_cost)
 values(24,36,48,'test','D14 isolated manual policy',false,false);

-- Commission through the real gateway; each order has one line for this item.
create function pg_temp.d14_commission(p_customer uuid,p_serial text,p_key text) returns uuid
language plpgsql as $$
declare v_order uuid;v_installation uuid;v_result jsonb;
begin
 insert into private.stockflow_orders(customer_id,customer_name,source,status,created_by_email,updated_by_email,idempotency_key)
 select id,name,'phone','delivered','d14-manager@test.local','d14-manager@test.local',p_key||'-order'
 from private.stockflow_customers where id=p_customer returning id into v_order;
 insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,quantity)
 values(v_order,'d14-item','D14 instrument',1);
 insert into private.stockflow_equipment_installations(order_id,tally_key,item_name,scheduled_date,created_by_email)
 values(v_order,'d14-item','D14 instrument',private.stockflow_economic_business_date()-60,'d14-manager@test.local') returning id into v_installation;
 v_result:=public.stockflow_installation_gateway('d14-test-key','d14-manager@test.local','complete_installation',jsonb_build_object(
  'orderId',v_order,'expectedVersion',(select version from private.stockflow_orders where id=v_order),
  'installationId',v_installation,'serialNumber',p_serial,'commissioningNotes','D14 verified commissioning','idempotencyKey',p_key));
 if v_result->>'installationId' is distinct from v_installation::text then raise exception 'D14 commissioning receipt mismatch';end if;
 return v_installation;
end$$;

create function pg_temp.d14_register(p_customer uuid,p_serial text,p_day date,p_key text) returns uuid
language plpgsql as $$
declare v_voucher uuid;v_line uuid;v_result jsonb;
begin
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,kind,evidence)
 values('d14-company',p_key,1,p_day,'d14-customer-'||p_customer::text,'sale','{}') returning id into v_voucher;
 insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
 values(v_voucher,'1','d14-item',1,'qty',100000,'{}') returning id into v_line;
 v_result:=public.stockflow_economics_gateway('d14-test-key','d14-manager@test.local','register_historical_instrument',jsonb_build_object(
  'sourceLineId',v_line,'expectedSourceRevision','1','customerId',p_customer,'installedOn',p_day,
  'serialNumber',p_serial,'reason','D14 confirmed invoice evidence','idempotencyKey',p_key));
 return (v_result->>'entityId')::uuid;
end$$;

create function pg_temp.d14_place(p_installation uuid,p_day date,p_model text,p_key text) returns uuid
language plpgsql as $$
declare v_customer uuid;v_result jsonb;
begin
 select coalesce(i.customer_id,o.customer_id) into v_customer
 from private.stockflow_equipment_installations i left join private.stockflow_orders o on o.id=i.order_id where i.id=p_installation;
 v_result:=public.stockflow_economics_gateway('d14-test-key','d14-manager@test.local','create_target',jsonb_build_object(
  'kind','placement','name','D14 placement','companyId','d14-company','customerId',v_customer,
  'customerSourceId','d14-customer-'||v_customer::text,'siteId','d14-site','modelId',p_model,
  'installationId',p_installation,'effectiveFrom',p_day,'capitalPaise','0','idempotencyKey',p_key));
 return (v_result->>'entityId')::uuid;
end$$;

do $test$
declare
 v_scenario integer;v_a uuid:='d1400000-0000-4000-8000-000000000001';v_b uuid:='d1400000-0000-4000-8000-000000000002';
 v_day date:=private.stockflow_economic_business_date()-40;v_close date:=private.stockflow_economic_business_date()-10;
 v_first uuid;v_second uuid;v_instrument uuid;v_target uuid;v_new_target uuid;v_line uuid;v_voucher uuid;v_order uuid;
 v_installation_before jsonb;v_target_before jsonb;v_financial_before jsonb;v_before jsonb;v_after jsonb;v_message text;
begin
 for v_scenario in 1..9 loop
  begin
   if v_scenario=9 then
    -- Completed fixtures bypass the gateways and must still get an identity.
    insert into private.stockflow_orders(customer_id,customer_name,source,status,created_by_email,updated_by_email,idempotency_key)
     select id,name,'phone','delivered','d14-manager@test.local','d14-manager@test.local','d14-direct-order'
     from private.stockflow_customers where id=v_a returning id into v_order;
    insert into private.stockflow_equipment_installations(order_id,tally_key,item_name,status,scheduled_date,serial_number,commissioning_notes,created_by_email,completed_by_email,completed_at)
     values(v_order,'d14-direct-item','D14 direct instrument','completed',v_day,'DIRECT-1','D14 direct fixture','d14-manager@test.local','d14-manager@test.local',now()) returning instrument_id into v_instrument;
    if v_instrument is null or not exists(select 1 from private.stockflow_instruments where id=v_instrument and serial_key='DIRECT1' and created_by='d14-manager@test.local')
     then raise exception 'D14 direct completed insert did not create/link identity';end if;
   elsif v_scenario=2 then
    if private.stockflow_instrument_serial_key('ab-123 ') is distinct from 'AB123'
     or private.stockflow_instrument_serial_key('AB 123') is distinct from 'AB123'
     or private.stockflow_instrument_serial_key('AB/123') is distinct from 'AB123'
     or private.stockflow_instrument_serial_key('ab.123') is distinct from 'AB123' then raise exception 'D14 serial normalisation failed';end if;
   else
    v_first:=pg_temp.d14_commission(v_a,'X1','d14-commission-first');
    select instrument_id into v_instrument from private.stockflow_equipment_installations where id=v_first;
    if v_instrument is null or not exists(select 1 from private.stockflow_instruments where id=v_instrument and serial_key='X1' and serial_number='X1' and created_by='d14-manager@test.local')
     or (select status from private.stockflow_equipment_installations where id=v_first) is distinct from 'completed' then raise exception 'D14 commissioning did not create/link identity';end if;
    if v_scenario in (1,8) then
     v_second:=pg_temp.d14_commission(v_a,'OTHER-2','d14-commission-second');
     if (select instrument_id from private.stockflow_equipment_installations where id=v_second) is not distinct from v_instrument then raise exception 'D14 different serial reused identity';end if;
     if v_scenario=8 then
      -- Deliberately recreate pre-migration data inside this rollback-only savepoint.
      alter table private.stockflow_equipment_installations drop constraint stockflow_completed_installation_instrument;
      alter table private.stockflow_equipment_installations disable trigger stockflow_installation_assign_instrument;
      update private.stockflow_equipment_installations set instrument_id=null,serial_number=(case when id=v_first then 'X1' else 'x-1' end) where id in (v_first,v_second);
      begin
       perform private.stockflow_instrument_backfill_check();
       raise exception 'D14 ambiguous backfill accepted';
      exception when sqlstate 'PT409' then
       get stacked diagnostics v_message=message_text;
       if position('Instrument register backfill stopped: duplicate serials X1' in v_message)=0
        or position(v_first::text in v_message)=0 or position(v_second::text in v_message)=0 then raise exception 'D14 wrong duplicate diagnostic: %',v_message;end if;
      end;
     end if;
    elsif v_scenario=7 then
     insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,kind,evidence)
      values('d14-company','d14-history-sale',1,v_day,'d14-history-customer','sale','{}') returning id into v_voucher;
     insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
      values(v_voucher,'1','d14-item',1,'qty',100000,'{}') returning id into v_line;
     begin
      perform public.stockflow_economics_gateway('d14-test-key','d14-manager@test.local','register_historical_instrument',jsonb_build_object(
       'sourceLineId',v_line,'expectedSourceRevision','1','customerId',v_a,'installedOn',v_day,'serialNumber','x-1','reason','D14 confirmed invoice evidence','idempotencyKey','d14-history-duplicate'));
      raise exception 'D14 normalised historical duplicate accepted';
     exception when sqlstate 'PT409' then
      get stacked diagnostics v_message=message_text;
      if v_message is distinct from 'Instrument is already registered' then raise exception 'D14 wrong historical conflict: %',v_message;end if;
     end;
     if (select count(*) from private.stockflow_equipment_installations where instrument_id=v_instrument)<>1 then raise exception 'D14 duplicate historical installation inserted';end if;
    else
     v_target:=pg_temp.d14_place(v_first,v_day,' d14-model ','d14-place-at-first');
     if (select model_id from private.stockflow_instruments where id=v_instrument) is distinct from 'd14-model' then raise exception 'D14 first placement did not lock trimmed model';end if;
     perform public.stockflow_economics_gateway('d14-test-key','d14-manager@test.local','record_capital',jsonb_build_object(
      'targetId',v_target,'kind','capital','amountPaise','24000000','effectiveDate',v_day,'reason','D14 Lab A capital only','idempotencyKey','d14-first-capital'));
     perform public.stockflow_economics_gateway('d14-test-key','d14-manager@test.local','set_expectation',jsonb_build_object(
      'targetId',v_target,'effectiveFrom',v_day,'monthlyRevenuePaise','2000000','monthlyGpPaise','1000000','reason','D14 Lab A baseline only','idempotencyKey','d14-first-baseline'));
     if (select approval from private.stockflow_economic_targets where id=v_target) is distinct from 'proposed' then raise exception 'D14 fixture policy allowed auto-approval';end if;
     if v_scenario=4 then
      select jsonb_build_object('installations',(select count(*) from private.stockflow_equipment_installations),
       'instruments',(select count(*) from private.stockflow_instruments),'orders',(select count(*) from private.stockflow_orders),
       'events',(select count(*) from private.stockflow_order_events),'commands',(select count(*) from private.stockflow_command_results)) into v_before;
      begin
       v_second:=pg_temp.d14_commission(v_b,' x-1 ','d14-commission-blocked');
       raise exception 'D14 open placement allowed relocation';
      exception when sqlstate 'PT409' then
       get stacked diagnostics v_message=message_text;
       if v_message is distinct from 'Serial is placed at D14 Lab A; end that placement first' then raise exception 'D14 wrong assignment conflict: %',v_message;end if;
      end;
      select jsonb_build_object('installations',(select count(*) from private.stockflow_equipment_installations),
       'instruments',(select count(*) from private.stockflow_instruments),'orders',(select count(*) from private.stockflow_orders),
       'events',(select count(*) from private.stockflow_order_events),'commands',(select count(*) from private.stockflow_command_results)) into v_after;
      if v_after is distinct from v_before then raise exception 'D14 failed commissioning left writes';end if;
     else
      perform public.stockflow_economics_gateway('d14-test-key','d14-manager@test.local','close_target',jsonb_build_object(
       'targetId',v_target,'expectedVersion',(select version from private.stockflow_economic_targets where id=v_target),
       'effectiveTo',v_close,'reason','D14 verified relocation closure','idempotencyKey','d14-close-placement'));
      select to_jsonb(i) into v_installation_before from private.stockflow_equipment_installations i where id=v_first;
      select to_jsonb(t) into v_target_before from private.stockflow_economic_targets t where id=v_target;
      select jsonb_build_object('capital',(select jsonb_agg(to_jsonb(e) order by e.id) from private.stockflow_economic_events e where e.target_id=v_target and e.kind='capital'),
       'expectations',(select jsonb_agg(to_jsonb(e) order by e.id) from private.stockflow_economic_expectations e where e.target_id=v_target)) into v_financial_before;
      if v_scenario=3 then
       v_second:=pg_temp.d14_register(v_b,' x-1 ',v_close,'d14-history-relocated');
       if not exists(select 1 from private.stockflow_equipment_installations where id=v_second and order_id is null and customer_id=v_b and historical_sale_line_id is not null)
        then raise exception 'D14 historical relocation origin missing';end if;
      else
       v_second:=pg_temp.d14_commission(v_b,' x-1 ','d14-commission-relocated');
      end if;
      if v_second=v_first or (select instrument_id from private.stockflow_equipment_installations where id=v_second) is distinct from v_instrument
       or (select count(*) from private.stockflow_equipment_installations where instrument_id=v_instrument)<>2 then raise exception 'D14 relocation lost persistent identity';end if;
      if v_scenario=5 then
       begin
        perform pg_temp.d14_place(v_second,v_close-1,'d14-model','d14-overlap-conflict');
        raise exception 'D14 cross-installation overlap accepted';
       exception when sqlstate 'PT409' then
        get stacked diagnostics v_message=message_text;
        if v_message is distinct from 'Instrument already has an open placement; close it first' then raise exception 'D14 wrong overlap conflict: %',v_message;end if;
       end;
       if exists(select 1 from private.stockflow_economic_targets where installation_id=v_second) then raise exception 'D14 overlap left a placement';end if;
      else
       if v_scenario=6 then
        begin
         perform pg_temp.d14_place(v_second,v_close,'d14-other-model','d14-model-conflict');
         raise exception 'D14 model change accepted';
        exception when sqlstate 'PT409' then
         get stacked diagnostics v_message=message_text;
         if v_message is distinct from 'Model must match this instrument (d14-model)' then raise exception 'D14 wrong model conflict: %',v_message;end if;
        end;
        if exists(select 1 from private.stockflow_economic_targets where installation_id=v_second) then raise exception 'D14 model conflict left a placement';end if;
       end if;
       v_new_target:=pg_temp.d14_place(v_second,v_close,'d14-model','d14-place-relocated');
       if v_new_target=v_target or not exists(select 1 from private.stockflow_economic_targets where id=v_new_target and installation_id=v_second and customer_id=v_b and approval='proposed') then raise exception 'D14 new placement identity/customer incorrect';end if;
       if exists(select 1 from private.stockflow_economic_expectations where target_id=v_new_target)
        or exists(select 1 from private.stockflow_economic_acquisition_links where target_id=v_new_target)
        or exists(select 1 from private.stockflow_economic_events where target_id=v_new_target and amount_paise<>0) then raise exception 'D14 relocation copied financial data';end if;
      end if;
      if (select to_jsonb(i) from private.stockflow_equipment_installations i where id=v_first) is distinct from v_installation_before
       or (select to_jsonb(t) from private.stockflow_economic_targets t where id=v_target) is distinct from v_target_before then raise exception 'D14 relocation changed Lab A history';end if;
      select jsonb_build_object('capital',(select jsonb_agg(to_jsonb(e) order by e.id) from private.stockflow_economic_events e where e.target_id=v_target and e.kind='capital'),
       'expectations',(select jsonb_agg(to_jsonb(e) order by e.id) from private.stockflow_economic_expectations e where e.target_id=v_target)) into v_after;
      if v_after is distinct from v_financial_before then raise exception 'D14 relocation changed Lab A finances';end if;
     end if;
    end if;
   end if;
   raise exception using errcode='ZD015',message='Rollback D14 scenario';
  exception when sqlstate 'ZD015' then null;
  end;
 end loop;
end$test$;
rollback;
\endif
