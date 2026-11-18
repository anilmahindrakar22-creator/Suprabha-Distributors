begin;
update private.stockflow_gateway_config
  set secret_sha256=encode(extensions.digest('stock-cover-key','sha256'),'hex') where name='orders';
insert into public.stockflow_members(email,role,roles,status) values
  ('stock-cover@test.local','administrator',array['administrator'],'active');

do $test$
declare r jsonb; a jsonb; v uuid; fixture record;
begin
  insert into public.stockflow_snapshots(id,company,fetched_at,payload)
    values('suprabha','Stock cover test',now()::text,'{"rows":[
      {"item":"Test reagent A","closing":2,"purchaseOrder":0},
      {"item":"Test reagent B","closing":30},
      {"item":"Test reagent C","closing":5}]}')
    on conflict(id) do update set payload=excluded.payload;
  insert into private.stockflow_economic_item_catalogs(company_id,source_version,observed_at,content)
    values('stock-cover-test','cover-v1',now(),'{"groups":[],"products":[
      {"id":"a","name":"Test reagent A"},{"id":"b","name":"Test reagent B"},
      {"id":"c","name":"Test reagent C"}]}');
  -- Only the current 36-unit sale and 9-unit sale count. Zero returns are valid.
  for fixture in select * from (values
    ('sale-a',0,'2026-11-17'::date,'sale',false,'a',360::numeric),
    ('sale-a',1,'2026-11-17'::date,'sale',false,'a',36::numeric),
    ('sale-b',0,'2026-11-16'::date,'sale',false,'b',9::numeric),
    ('cancelled',0,'2026-11-18'::date,'sale',true,'a',900::numeric),
    ('return-zero',0,'2026-11-18'::date,'return',false,'a',0::numeric),
    ('outside-window',0,'2026-08-20'::date,'sale',false,'a',900::numeric),
    ('future-sale',0,'2026-11-19'::date,'sale',false,'a',900::numeric),
    ('moved-sale',0,'2026-11-17'::date,'sale',false,'a',900::numeric),
    ('moved-sale',1,'2026-11-19'::date,'sale',false,'a',900::numeric)
  ) f(source_id,revision,business_date,kind,cancelled,product_id,quantity) loop
    insert into private.stockflow_economic_source_vouchers
      (company_id,source_id,source_revision,business_date,kind,cancelled,evidence)
      values('stock-cover-test',fixture.source_id,fixture.revision,fixture.business_date,
        fixture.kind,fixture.cancelled,'{}') returning id into v;
    insert into private.stockflow_economic_source_lines
      (voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
      values(v,'1',fixture.product_id,fixture.quantity,'Nos',0,'{}');
  end loop;
  r:=private.stockflow_stock_cover('2026-11-18');
  if r->>'view' is distinct from 'cover' or r->>'runsOutCount' is distinct from '1'
    or r->>'leadTimeDays' is distinct from '7' or r->>'windowDays' is distinct from '90'
    or jsonb_array_length(r->'items')<>3 then raise exception 'Cover contract: %',r; end if;
  a:=r->'items'->0;
  if a->>'itemKey' is distinct from 'Test reagent A' or a->>'state' is distinct from 'runs_out'
    or a->>'daysLeft' is distinct from '5' or (a->>'usedLast90')::numeric is distinct from 36::numeric then
    raise exception 'Runs out / latest / cancelled / window: %',a;
  end if;
  a:=r->'items'->1;
  if a->>'itemKey' is distinct from 'Test reagent B' or a->>'state' is distinct from 'covered'
    or a->>'daysLeft' is distinct from '300' then raise exception 'Covered: %',a; end if;
  a:=r->'items'->2;
  if a->>'itemKey' is distinct from 'Test reagent C' or a->>'state' is distinct from 'no_recent_use'
    or a->'daysLeft' is distinct from 'null'::jsonb then raise exception 'No use: %',a; end if;
  begin
    perform public.stockflow_requirements_gateway('stock-cover-key','stock-cover@test.local',
      'get_requirements','{"view":"cover","x":1}');
    raise exception 'Extra cover payload allowed';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.stockflow_requirements_gateway('wrong-key','stock-cover@test.local',
      'get_requirements','{"view":"cover"}');
    raise exception 'Wrong key allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.stockflow_requirements_gateway('stock-cover-key','nonmember@test.local',
      'get_requirements','{"view":"cover"}');
    raise exception 'Nonmember allowed';
  exception when insufficient_privilege then null; end;
  delete from private.stockflow_stock_policies;
  r:=private.stockflow_stock_cover('2026-11-18');
  if r->'leadTimeDays' is distinct from 'null'::jsonb
    or r->'items'->0->>'state' is distinct from 'no_lead_time'
    or r->'items'->1->>'state' is distinct from 'no_lead_time'
    or r->>'runsOutCount' is distinct from '0' then
    raise exception 'Missing lead time must not imply coverage: %',r;
  end if;
end $test$;
rollback;
