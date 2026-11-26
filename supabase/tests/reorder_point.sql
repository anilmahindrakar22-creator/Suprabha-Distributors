begin;

do $test$
declare
  r jsonb; a jsonb; v uuid; product text; day date; i integer;
  v_today date := '2026-11-18';
  expected_point numeric := ceil(greatest(8*(120/90.0),40));
  expected_up_to numeric := ceil(60*(120/90.0)+(expected_point-8*(120/90.0)));
begin
  delete from private.stockflow_reorder_policies;
  insert into private.stockflow_reorder_policies(cover_days,effective_from,created_by_email,reason)
    values(60,'2026-01-01','reorder-point@test.local','Fixture'),
      (120,v_today+1,'reorder-point@test.local','Future fixture');
  delete from private.stockflow_stock_policies;
  insert into private.stockflow_stock_policies(lead_time_days,effective_from,created_by_email,reason)
    values(7,'2026-01-01','reorder-point@test.local','Fixture'),
      (30,v_today+1,'reorder-point@test.local','Future fixture');
  insert into public.stockflow_snapshots(id,company,fetched_at,payload)
    values('suprabha','Reorder point test',now()::text,'{"catalog":[
      {"item":"SMOOTH","closing":5,"purchaseOrder":2},
      {"item":"SPIKY","closing":0},{"item":"ABOVE","closing":7,"purchaseOrder":2},
      {"item":"EQUAL","closing":8},
      {"item":"LOW","closing":0},{"item":"OK","closing":0},{"item":"HIGH","closing":0}],
      "rows":[{"item":"LOW","reorderLevel":3},{"item":"OK","reorderLevel":10},
        {"item":"HIGH","reorderLevel":20}]}')
    on conflict(id) do update set payload=excluded.payload;
  insert into private.stockflow_economic_item_catalogs(company_id,source_version,observed_at,content)
    values('reorder-point-test','reorder-point-v1',now(),'{"groups":[],"products":[
      {"id":"SMOOTH","name":"SMOOTH"},{"id":"SPIKY","name":"SPIKY"},
      {"id":"ABOVE","name":"ABOVE"},{"id":"EQUAL","name":"EQUAL"},
      {"id":"LOW","name":"LOW"},{"id":"OK","name":"OK"},{"id":"HIGH","name":"HIGH"}]}');
  for i in 0..179 loop
    day:=v_today-i;
    insert into private.stockflow_economic_source_vouchers
      (company_id,source_id,source_revision,business_date,kind,cancelled,evidence)
      values('reorder-point-test','daily-'||i,0,day,'sale',false,'{}') returning id into v;
    foreach product in array array['SMOOTH','ABOVE','EQUAL','LOW','OK','HIGH'] loop
      insert into private.stockflow_economic_source_lines
        (voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
        values(v,product,product,1,'Nos',0,'{}');
    end loop;
  end loop;
  for i in 0..5 loop
    day:=('2026-11-10'::date-i*interval '1 month')::date;
    insert into private.stockflow_economic_source_vouchers
      (company_id,source_id,source_revision,business_date,kind,cancelled,evidence)
      values('reorder-point-test','spiky-'||i,0,day,'sale',false,'{}') returning id into v;
    insert into private.stockflow_economic_source_lines
      (voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
      values(v,'1','SPIKY',40,'Nos',0,'{}');
  end loop;
  r:=private.stockflow_reorder_check(v_today);
  if r->>'view' is distinct from 'reorder_check' or r->>'coverDays' is distinct from '60'
    or r->>'windowDays' is distinct from '90' or r->>'salesThrough' is distinct from v_today::text
    or r->>'leadTimeDays' is distinct from '7' or r->>'reviewDays' is distinct from '1'
    or r->>'shortCount' is distinct from '3' or r->>'levelCount' is distinct from '2'
    or jsonb_array_length(r->'short')<>3 or jsonb_array_length(r->'level')<>2
    or jsonb_path_exists(r,'$.**.target') then
    raise exception 'Reorder point payload: %',r;
  end if;
  select x into a from jsonb_array_elements(r->'short') x where x->>'itemKey'='SMOOTH';
  if a is null or a is distinct from '{"itemKey":"SMOOTH","closing":5,"onOrder":2,
    "usedLast90":90,"daysCover":7,"reorderPoint":8,"orderUpTo":60,"suggestedQty":53}'::jsonb then
    raise exception 'Smooth reorder point and order quantity: %',a;
  end if;
  select x into a from jsonb_array_elements(r->'short') x where x->>'itemKey'='SPIKY';
  if a is null or (a->>'usedLast90')::numeric is distinct from 120::numeric
    or (a->>'reorderPoint')::numeric is distinct from expected_point
    or (a->>'orderUpTo')::numeric is distinct from expected_up_to
    or (a->>'suggestedQty')::numeric is distinct from expected_up_to then
    raise exception 'Spiky percentile and exact safety arithmetic: %',a;
  end if;
  select x into a from jsonb_array_elements(r->'short') x where x->>'itemKey'='EQUAL';
  if a is null or (a->>'suggestedQty')::numeric is distinct from 52::numeric then
    raise exception 'Held at reorder point must be short: %',a;
  end if;
  if exists(select 1 from jsonb_array_elements(r->'short') x
    where x->>'itemKey' in ('ABOVE','LOW','OK','HIGH')) then
    raise exception 'Above point or Tally-listed item in short: %',r;
  end if;
  if r->'level' is distinct from '[{"itemKey":"LOW","reorderLevel":3,"usedLast90":90,
    "direction":"low","reorderPoint":8,"orderUpTo":60},
    {"itemKey":"HIGH","reorderLevel":20,"usedLast90":90,
    "direction":"high","reorderPoint":8,"orderUpTo":60}]'::jsonb then
    raise exception 'Tally levels must compare to reorder point: %',r;
  end if;
  raise notice 'PASS reorder point: daily demand, percentile, safety, held trigger, levels and payload';
end $test$;
rollback;
