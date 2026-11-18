begin;
-- Record real-copy counts before adding any fixtures.
create temporary table data_checks_baseline as
  select private.stockflow_data_checks('2026-11-18') result;
update private.stockflow_gateway_config
  set secret_sha256=encode(extensions.digest('data-checks-key','sha256'),'hex') where name='orders';
insert into public.stockflow_members(email,role,roles,status) values
  ('data-checks-admin@test.local','administrator',array['administrator'],'active'),
  ('data-checks-ops@test.local','operations',array['operations'],'active');

do $test$
declare baseline jsonb; result jsonb; missing_pin uuid; valid_pin uuid; voucher uuid; fixture record;
begin
  select b.result into baseline from data_checks_baseline b;
  insert into private.stockflow_customers(name,city,pin_code,created_by_email)
    values('Test customer A','Test town',null,'data-checks-admin@test.local') returning id into missing_pin;
  insert into private.stockflow_customers(name,city,pin_code,created_by_email)
    values('Test customer B','Test town','560001','data-checks-admin@test.local') returning id into valid_pin;
  if not exists(select 1 from private.stockflow_pin_centroids where pin_code='560001') then
    raise exception 'Known PIN fixture is missing'; end if;
  insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by) values
    ('data-checks-test','linked-a',missing_pin,'data-checks-admin@test.local'),
    ('data-checks-test','linked-b',valid_pin,'data-checks-admin@test.local');
  insert into private.stockflow_economic_item_catalogs(company_id,source_version,observed_at,content)
    values('data-checks-test','test-v1','2026-11-18T00:00:00Z',
      '{"groups":[],"products":[{"id":"data-checks-test-item","name":"Test missing item"}]}');
  for fixture in select * from (values
    ('unlinked','unlinked',0,'2026-11-17'::date,false),
    ('linked-a','linked-a',0,'2026-11-17'::date,false),
    ('linked-b','linked-b',0,'2026-11-17'::date,false),
    ('cancelled','cancelled-ledger',0,'2026-11-17'::date,true),
    ('outside','outside-ledger',0,'2026-08-20'::date,false),
    ('future','future-ledger',0,'2026-11-19'::date,false),
    ('moved','moved-ledger',0,'2026-11-17'::date,false),
    ('moved','moved-ledger',1,'2026-11-19'::date,false)
  ) f(source_id,customer_source_id,revision,business_date,cancelled) loop
    insert into private.stockflow_economic_source_vouchers
      (company_id,source_id,customer_source_id,source_revision,business_date,kind,cancelled,evidence)
      values('data-checks-test',fixture.source_id,fixture.customer_source_id,fixture.revision,
        fixture.business_date,'sale',fixture.cancelled,'{}') returning id into voucher;
    insert into private.stockflow_economic_source_lines
      (voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
      values(voucher,'1','data-checks-test-item',1,'Nos',0,'{}');
  end loop;
  result:=private.stockflow_data_checks('2026-11-18');
  if (result#>>'{unlinkedLedgers,count}')::bigint <> (baseline#>>'{unlinkedLedgers,count}')::bigint+1
    or (result#>>'{unlinkedLedgers,ofBuying}')::bigint <> (baseline#>>'{unlinkedLedgers,ofBuying}')::bigint+3
    or (result#>>'{noPinCode,count}')::bigint <> (baseline#>>'{noPinCode,count}')::bigint+1
    or (result#>>'{noPinCode,ofBuying}')::bigint <> (baseline#>>'{noPinCode,ofBuying}')::bigint+2
    or (result#>>'{itemsNotInStockFlow,count}')::bigint <> (baseline#>>'{itemsNotInStockFlow,count}')::bigint+1
    or (result#>>'{itemsNotInStockFlow,ofSold}')::bigint <> (baseline#>>'{itemsNotInStockFlow,ofSold}')::bigint+1 then
    raise exception 'Data check fixture deltas failed: before %, after %',baseline,result;
  end if;
  if result->>'view' is distinct from 'data_checks' or result->>'asOf' is distinct from '2026-11-18'
    or jsonb_array_length(result#>'{unlinkedLedgers,top}')>10
    or jsonb_array_length(result#>'{noPinCode,top}')>20 then
    raise exception 'Data check contract failed: %',result;
  end if;
  perform public.stockflow_economics_gateway('data-checks-key','data-checks-admin@test.local','get_data_checks','{}');
  begin
    perform public.stockflow_economics_gateway('data-checks-key','data-checks-admin@test.local','get_data_checks','{"x":1}');
    raise exception 'Non-empty payload allowed';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.stockflow_economics_gateway('data-checks-key','data-checks-ops@test.local','get_data_checks','{}');
    raise exception 'Operations allowed';
  exception when sqlstate '42501' then null; end;
  begin
    perform public.stockflow_economics_gateway('wrong-key','data-checks-admin@test.local','get_data_checks','{}');
    raise exception 'Wrong key allowed';
  exception when sqlstate '42501' then null; end;
end $test$;
rollback;
