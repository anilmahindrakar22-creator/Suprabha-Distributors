begin;
update private.stockflow_gateway_config
  set secret_sha256=encode(extensions.digest('forecast-key','sha256'),'hex') where name='orders';
insert into public.stockflow_members(email,role,roles,status) values
  ('forecast-mgmt@test.local','management',array['management'],'active'),
  ('forecast-admin@test.local','administrator',array['administrator'],'active'),
  ('forecast-ops@test.local','operations',array['operations'],'active'),
  ('forecast-sales@test.local','sales',array['sales'],'active'),
  ('forecast-inactive@test.local','management',array['management'],'suspended');

do $test$
declare r jsonb; a jsonb; rates record; fixture record; v uuid; i integer; checks integer;
  v_today date:='2026-11-18';
begin
  select * into rates from private.stockflow_forecast_rates(array[0,0,0]::numeric[]);
  if rates.base_rate is distinct from 0::numeric or rates.avg6_rate is distinct from 0::numeric
    or rates.cap12_rate is distinct from 0::numeric then raise exception 'Zero rates: %',rates; end if;
  select * into rates from private.stockflow_forecast_rates(array[10,0,20,0,0,30]::numeric[]);
  if rates.base_rate is distinct from 10::numeric or rates.avg6_rate is distinct from 10::numeric
    or rates.cap12_rate is distinct from 10::numeric then raise exception 'Intermittent rates: %',rates; end if;
  select * into rates from private.stockflow_forecast_rates(array[1,1,1,1,1,1,1,1,1,1,1,100]::numeric[]);
  if rates.base_rate is distinct from 34::numeric or rates.avg6_rate is distinct from 17.5::numeric
    or rates.cap12_rate is null or abs(rates.cap12_rate-14::numeric/12)>1e-9 then
    raise exception 'Capped spike: %',rates; end if;
  if private.stockflow_forecast_median_positive(array[2,4]::numeric[]) is distinct from 3::numeric
    or private.stockflow_forecast_median_positive(array[0,0]::numeric[]) is not null then
    raise exception 'Positive median'; end if;
  select * into rates from private.stockflow_forecast_rates('{}'::numeric[]);
  if rates.base_rate is distinct from 0::numeric or rates.avg6_rate is distinct from 0::numeric
    or rates.cap12_rate is distinct from 0::numeric then raise exception 'Empty rates: %',rates; end if;

  insert into public.stockflow_snapshots(id,company,fetched_at,payload)
    values('suprabha','Forecast test',now()::text,'{"rows":[{"item":"S","closing":10,"purchaseOrder":0},{"item":"N","closing":10},{"item":"Z","closing":10}]}')
    on conflict(id) do update set payload=excluded.payload;
  insert into private.stockflow_economic_item_catalogs(company_id,source_version,observed_at,content)
    values('forecast-test','forecast-v1',now(),'{"groups":[],"products":[{"id":"S","name":"S"},{"id":"N","name":"N"},{"id":"Z","name":"Z"}]}');
  for i in 0..11 loop
    insert into private.stockflow_economic_source_vouchers
      (company_id,source_id,source_revision,business_date,kind,cancelled,evidence)
      values('forecast-test','steady-'||i,0,('2025-11-10'::date+i*interval '1 month')::date,'sale',false,'{}') returning id into v;
    insert into private.stockflow_economic_source_lines
      (voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
      values(v,'1','S',5,'Nos',0,'{}');
  end loop;
  for fixture in select * from (values
    ('new-aug',0,'2026-08-10'::date,'sale',false,'N',40::numeric),
    ('new-sep',0,'2026-09-10'::date,'sale',false,'N',5::numeric),
    ('new-oct',0,'2026-10-10'::date,'sale',false,'N',5::numeric),
    ('returns-only',0,'2026-10-10'::date,'return',false,'Z',20::numeric),
    ('cancelled',0,'2026-10-10'::date,'sale',true,'cancelled-product',900::numeric),
    ('revision',0,'2026-10-10'::date,'sale',false,'old-revision-product',900::numeric),
    ('revision',1,'2026-10-10'::date,'sale',false,'S',0::numeric)
  ) f(source_id,revision,business_date,kind,cancelled,product_id,quantity) loop
    insert into private.stockflow_economic_source_vouchers
      (company_id,source_id,source_revision,business_date,kind,cancelled,evidence)
      values('forecast-test',fixture.source_id,fixture.revision,fixture.business_date,fixture.kind,fixture.cancelled,'{}') returning id into v;
    insert into private.stockflow_economic_source_lines
      (voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
      values(v,'1',fixture.product_id,fixture.quantity,'Nos',0,'{}');
  end loop;
  insert into private.stockflow_forecast_runs values(v_today-121,now(),'2026-05-01',0,'{}');
  insert into private.stockflow_forecast_checks values(v_today-121,'2026-05-01',1,'established','avg6',1,5,5,0);
  r:=private.stockflow_refresh_item_forecast(v_today);
  if r->>'throughMonth' is distinct from '2026-10-01' then raise exception 'Through month: %',r; end if;
  if (select count(*) from private.stockflow_item_forecast where company_id='forecast-test')<>2 then
    raise exception 'Forecast population'; end if;
  select * into rates from private.stockflow_item_forecast where company_id='forecast-test' and product_id='S';
  if not found or rates.base_rate is distinct from 5::numeric or rates.avg6_rate is distinct from 5::numeric
    or rates.cap12_rate is distinct from 5::numeric or rates.is_new then raise exception 'Steady rates: %',rates; end if;
  select * into rates from private.stockflow_item_forecast where company_id='forecast-test' and product_id='N';
  if not found or not rates.is_new or rates.first_sale_month is distinct from '2026-08-01'::date
    or abs(rates.base_rate-50::numeric/3)>1e-9 or abs(rates.avg6_rate-50::numeric/6)>1e-9
    or abs(rates.cap12_rate-25::numeric/12)>1e-9 then raise exception 'New rates: %',rates; end if;
  if exists(select 1 from private.stockflow_item_forecast where company_id='forecast-test' and product_id='Z') then
    raise exception 'Returns-only product included'; end if;
  if exists(select 1 from private.stockflow_item_forecast where company_id='forecast-test' and product_id='cancelled-product') then
    raise exception 'Cancelled voucher included'; end if;
  if exists(select 1 from private.stockflow_item_forecast where company_id='forecast-test' and product_id='old-revision-product') then
    raise exception 'Older revision included'; end if;
  select * into rates from private.stockflow_forecast_checks where computed_on=v_today
    and cutoff_month='2026-10-01' and horizon=1 and segment='established' and method='avg6';
  if not found or rates.item_months<>1 or rates.actual<>5 or rates.forecast<>5 or rates.abs_error<>0 then
    raise exception 'October established backtest: %',rates; end if;
  if exists(select 1 from private.stockflow_forecast_runs where computed_on=v_today-121)
    or exists(select 1 from private.stockflow_forecast_checks where computed_on=v_today-121) then raise exception 'Prune cascade'; end if;
  if (select cardinality(uncertified_months) from private.stockflow_forecast_runs where computed_on=v_today)<>14 then
    raise exception 'Missing certification must be visible'; end if;
  checks:=(r->>'checks')::integer;
  update private.stockflow_item_forecast set avg6_rate=999 where company_id='forecast-test';
  r:=private.stockflow_refresh_item_forecast(v_today);
  if (select count(*) from private.stockflow_forecast_runs where computed_on=v_today)<>1
    or (select count(*) from private.stockflow_forecast_checks where computed_on=v_today)<>checks
    or exists(select 1 from private.stockflow_item_forecast where company_id='forecast-test' and avg6_rate=999) then
    raise exception 'Refresh must replace rows and checks: %',r; end if;
  r:=private.stockflow_forecast_trial(v_today);
  select value into a from jsonb_array_elements(r->'items') where value->>'itemKey'='S';
  -- Only September and October fall inside the fixed 90-day window: 10 / 90 per day.
  -- 10 available / (5 / 30.4375) gives floor(60.875) = 60 trial days.
  if a is null or a->>'nowDaysLeft' is distinct from '90' or a->>'avg6DaysLeft' is distinct from '60'
    or a->>'cap12DaysLeft' is distinct from '60' or (a->>'nowMonthly')::numeric is distinct from 3.38::numeric then
    raise exception 'Trial stock cover: %',r; end if;
end $test$;

-- Pin the read clock for gateway fixtures, regardless of the conductor's actual date.
-- The real trial implementation is still called; rollback restores both functions.
alter function private.stockflow_forecast_trial(date) rename to stockflow_forecast_trial_fixture;
create function private.stockflow_forecast_trial(p_today date) returns jsonb
language sql stable security definer set search_path=pg_catalog,private,public,extensions as $$
  select private.stockflow_forecast_trial_fixture('2026-11-18'::date)
$$;
revoke all on function private.stockflow_forecast_trial(date) from public,anon,authenticated,service_role;
do $test$
declare r jsonb; a jsonb; actor text;
begin
  foreach actor in array array['forecast-mgmt@test.local','forecast-admin@test.local'] loop
    r:=public.stockflow_requirements_gateway('forecast-key',actor,'get_requirements','{"view":"forecast_trial"}');
    select value into a from jsonb_array_elements(r->'items') where value->>'itemKey'='S';
    if r->>'view' is distinct from 'forecast_trial' or a is null
      or a->>'nowDaysLeft' is distinct from '90' or a->>'avg6DaysLeft' is distinct from '60' then
      raise exception 'Management / administrator gateway: %',r; end if;
  end loop;
  foreach actor in array array['forecast-ops@test.local','forecast-sales@test.local','forecast-inactive@test.local'] loop
    begin
      perform public.stockflow_requirements_gateway('forecast-key',actor,'get_requirements','{"view":"forecast_trial"}');
      raise exception 'Unauthorized actor allowed: %',actor;
    exception when sqlstate '42501' then null; end;
  end loop;
  begin
    perform public.stockflow_requirements_gateway('wrong','forecast-mgmt@test.local','get_requirements','{"view":"forecast_trial"}');
    raise exception 'Wrong gateway key allowed';
  exception when sqlstate '42501' then null; end;
  begin
    perform public.stockflow_requirements_gateway('forecast-key','forecast-mgmt@test.local','get_requirements','{"view":"forecast_trial","x":1}');
    raise exception 'Extra payload allowed';
  exception when sqlstate '22023' then null; end;
  r:=public.stockflow_requirements_gateway('forecast-key','forecast-mgmt@test.local','get_requirements','{"view":"cover"}');
  if r->>'view' is distinct from 'cover' then raise exception 'Cover delegation: %',r; end if;
  delete from private.stockflow_forecast_runs;
  r:=private.stockflow_forecast_trial('2026-11-18');
  if r is distinct from '{"view":"forecast_trial","asOf":"2026-11-18","computedAt":null,"throughMonth":null,"stale":true,"uncertifiedMonths":[],"check":null,"itemCount":0,"items":[]}'::jsonb then
    raise exception 'No run: %',r; end if;
  raise notice 'PASS item forecast trial: rates, refresh, backtest, pruning, cover and gateway';
end $test$;
rollback;
