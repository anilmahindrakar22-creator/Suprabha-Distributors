begin;
update private.stockflow_gateway_config
  set secret_sha256=encode(extensions.digest('estimate-key','sha256'),'hex') where name='orders';
insert into public.stockflow_members(email,role,roles,status) values
  ('estimate-manager@test.local','management',array['management'],'active'),
  ('estimate-admin@test.local','administrator',array['administrator'],'active'),
  ('estimate-ops@test.local','operations',array['operations'],'active'),
  ('estimate-sales@test.local','sales',array['sales'],'active'),
  ('estimate-inactive@test.local','management',array['management'],'suspended');

do $test$
declare
  v_today date:=(now() at time zone 'Asia/Kolkata')::date;
  v uuid; i integer; r jsonb; original jsonb; a jsonb; p jsonb; bad jsonb; actor text;
begin
  insert into public.stockflow_snapshots(id,company,fetched_at,payload)
    values('suprabha','Estimate test',now()::text,
      '{"catalog":[{"item":"S","closing":10},{"item":"N","closing":10},{"item":"U","closing":10}],
        "rows":[{"item":"S","closing":10},{"item":"N","closing":10}]}')
    on conflict(id) do update set payload=excluded.payload;
  insert into private.stockflow_economic_item_catalogs(company_id,source_version,observed_at,content)
    values('estimate-test','estimate-v1',now(),
      '{"groups":[],"products":[{"id":"S","name":"S"},{"id":"N","name":"N"},{"id":"U","name":"U"}]}');
  -- Insert source evidence; the refresh builds the forecast rows.
  for i in 1..12 loop
    insert into private.stockflow_economic_source_vouchers
      (company_id,source_id,source_revision,business_date,kind,cancelled,evidence)
      values('estimate-test','steady-'||i,0,
        (date_trunc('month',v_today)-i*interval '1 month')::date,'sale',false,'{}') returning id into v;
    insert into private.stockflow_economic_source_lines
      (voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
      values(v,'1','S',5,'Nos',0,'{}');
  end loop;
  insert into private.stockflow_economic_source_vouchers
    (company_id,source_id,source_revision,business_date,kind,cancelled,evidence)
    values('estimate-test','new-item',0,
      (date_trunc('month',v_today)-interval '1 month')::date,'sale',false,'{}') returning id into v;
  insert into private.stockflow_economic_source_lines
    (voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
    values(v,'1','N',5,'Nos',0,'{}');
  perform private.stockflow_refresh_item_forecast(v_today);

  p:=jsonb_build_object('requestId','a1000000-0000-4000-8000-000000000001','itemKey','N',
    'monthlyQty',30,'reason','Principal monthly plan','reviewOn',v_today+30);
  original:=public.stockflow_requirements_gateway('estimate-key',' ESTIMATE-MANAGER@test.local ',
    'set_item_demand_estimate',p);
  if original->>'monthlyQty' is distinct from '30'
    or original->>'itemKey' is distinct from 'N'
    or original->>'reason' is distinct from 'Principal monthly plan'
    or original->>'reviewOn' is distinct from (v_today+30)::text
    or original->>'setBy' is distinct from 'estimate-manager@test.local'
    or original->>'setAt' is null then raise exception 'Manager audit result: %',original; end if;
  r:=public.stockflow_requirements_gateway('estimate-key','estimate-manager@test.local','get_requirements','{"view":"forecast_trial"}');
  select value into a from jsonb_array_elements(r->'items') where value->>'itemKey'='N';
  -- 10 available / (30 / 30.4375) = 10.145833..., floor = 10.
  if a is null or a#>>'{estimate,monthly}' is distinct from '30.00'
    or a#>>'{estimate,daysLeft}' is distinct from '10'
    or a#>>'{estimate,reason}' is distinct from original->>'reason'
    or a#>>'{estimate,setBy}' is distinct from original->>'setBy' then
    raise exception 'Expected cover and audit: %',a; end if;
  select value into a from jsonb_array_elements(r->'items') where value->>'itemKey'='S';
  if a is null or a->'estimate' is distinct from 'null'::jsonb then raise exception 'Steady item changed: %',a; end if;

  r:=public.stockflow_requirements_gateway('estimate-key','estimate-manager@test.local',
    'set_item_demand_estimate',p||'{"monthlyQty":40}');
  if r is distinct from original or
    (select count(*) from private.stockflow_item_demand_estimates where request_id=(p->>'requestId')::uuid)<>1 then
    raise exception 'Retry changed audit row: %',r; end if;
  perform public.stockflow_requirements_gateway('estimate-key','estimate-admin@test.local',
    'set_item_demand_estimate',p||'{"requestId":"a1000000-0000-4000-8000-000000000002","monthlyQty":40}');
  r:=private.stockflow_forecast_trial(v_today);
  select value into a from jsonb_array_elements(r->'items') where value->>'itemKey'='N';
  if a#>>'{estimate,monthly}' is distinct from '40.00'
    or a#>>'{estimate,setBy}' is distinct from 'estimate-admin@test.local'
    or (select count(*) from private.stockflow_item_demand_estimates where item_key='N')<>2 then
    raise exception 'Latest estimate: %',a; end if;

  -- A catalog item with no sales/forecast row can also take an estimate.
  perform public.stockflow_requirements_gateway('estimate-key','estimate-manager@test.local',
    'set_item_demand_estimate',p||'{"requestId":"a1000000-0000-4000-8000-000000000003","itemKey":"U"}');
  foreach actor in array array['estimate-ops@test.local','estimate-sales@test.local',
    'estimate-inactive@test.local','estimate-missing@test.local'] loop
    begin
      perform public.stockflow_requirements_gateway('estimate-key',actor,'set_item_demand_estimate',p);
      raise exception 'Unauthorized actor accepted: %',actor;
    exception when sqlstate '42501' then
      if sqlerrm<>'Role cannot set expected use' then raise; end if;
    end;
  end loop;
  begin
    perform public.stockflow_requirements_gateway('wrong','estimate-manager@test.local','set_item_demand_estimate',p);
    raise exception 'Wrong gateway key accepted';
  exception when sqlstate '42501' then
    if sqlerrm<>'Unauthorized gateway' then raise; end if;
  end;

  for bad in select value from jsonb_array_elements(jsonb_build_array(
    p||'{"requestId":"a1000000-0000-4000-8000-000000000010","itemKey":"S"}',
    p||'{"requestId":"a1000000-0000-4000-8000-000000000011","itemKey":"missing"}'
  )) loop
    begin
      perform public.stockflow_requirements_gateway('estimate-key','estimate-manager@test.local','set_item_demand_estimate',bad);
      raise exception 'Ineligible item accepted: %',bad;
    exception when sqlstate '22023' then
      if sqlerrm<>'Only new items take an expected use' then raise; end if;
    end;
  end loop;
  p:=p||'{"requestId":"a1000000-0000-4000-8000-000000000020"}';
  for bad in select value from jsonb_array_elements(jsonb_build_array(
    p||'{"extra":true}',p||'{"monthlyQty":0}',p||'{"reason":"short"}',
    p||jsonb_build_object('reviewOn',v_today+200),
    p||jsonb_build_object('reviewOn',v_today+6),
    p||'{"reviewOn":"2026-02-30"}',p||'{"requestId":"not-a-uuid"}',
    p||'{"monthlyQty":"30"}',p||'{"monthlyQty":1000001}',p-'reason','null'::jsonb
  )) loop
    begin
      perform public.stockflow_requirements_gateway('estimate-key','estimate-manager@test.local','set_item_demand_estimate',bad);
      raise exception 'Invalid payload accepted: %',bad;
    exception when sqlstate '22023' then
      if sqlerrm<>'Invalid expected use' then raise; end if;
    end;
  end loop;
  begin
    update private.stockflow_item_demand_estimates set monthly_qty=999 where item_key='N';
    raise exception 'Estimate update accepted';
  exception when raise_exception then
    if sqlerrm<>'Acknowledgements are append-only' then raise; end if;
  end;
  begin
    delete from private.stockflow_item_demand_estimates where item_key='N';
    raise exception 'Estimate delete accepted';
  exception when raise_exception then
    if sqlerrm<>'Acknowledgements are append-only' then raise; end if;
  end;
  raise notice 'PASS item demand estimates: eligibility, latest, audit, retry, access, validation and append-only';
end $test$;
rollback;
