begin;
update private.stockflow_gateway_config
  set secret_sha256=encode(extensions.digest('reorder-key','sha256'),'hex') where name='orders';
insert into public.stockflow_members(email,role,roles,status) values
  ('reorder-ops@test.local','operations',array['operations'],'active'),
  ('reorder-sales@test.local','sales',array['sales'],'active'),
  ('reorder-inactive@test.local','operations',array['operations'],'suspended');

do $test$
declare r jsonb; a jsonb; v uuid; fixture record; product text; day date; i integer;
  v_today date := '2026-11-18';
begin
  delete from private.stockflow_reorder_policies;
  insert into private.stockflow_reorder_policies(cover_days,effective_from,created_by_email,reason)
    values(60,'2026-01-01','reorder-ops@test.local','Fixture'),
      (120,v_today+1,'reorder-ops@test.local','Future fixture');
  insert into public.stockflow_snapshots(id,company,fetched_at,payload)
    values('suprabha','Reorder test',now()::text,'{"catalog":[
      {"item":"A","closing":5,"purchaseOrder":0},{"item":"B","closing":25},
      {"item":"C","closing":5},{"item":"D","closing":5},
      {"item":"E","closing":5},{"item":"F","closing":5},
      {"item":"G","closing":5},{"item":"Duplicate","closing":0},{"item":"Duplicate","closing":0},
      {"item":"Invalid","closing":"1e2"}],
      "rows":[{"item":"D","reorderLevel":100},{"item":"E","reorderLevel":15},{"item":"F","reorderLevel":5}]}')
    on conflict(id) do update set payload=excluded.payload;
  insert into private.stockflow_economic_item_catalogs(company_id,source_version,observed_at,content)
    values('reorder-test','reorder-v1',now(),'{"groups":[],"products":[
      {"id":"A","name":"A"},{"id":"B","name":"B"},{"id":"C","name":"C"},
      {"id":"D","name":"D"},{"id":"E","name":"E"},{"id":"F","name":"F"},
      {"id":"G","name":"G"},{"id":"Duplicate","name":"Duplicate"},{"id":"Invalid","name":"Invalid"}]}');
  foreach product in array array['A','B','C','D','E','F','G','Duplicate','Invalid'] loop
    for i in 1..4 loop
      -- Three recent months total 30; the fourth month proves the 180-day window.
      day:=case i when 1 then '2026-11-10'::date when 2 then '2026-10-10'::date
        when 3 then '2026-09-10'::date else '2026-07-10'::date end;
      if product='C' then day:=case when i<=2 then '2026-11-10'::date else '2026-10-10'::date end; end if;
      insert into private.stockflow_economic_source_vouchers
        (company_id,source_id,source_revision,business_date,kind,cancelled,evidence)
        values('reorder-test',product||i,0,day,'sale',false,'{}') returning id into v;
      insert into private.stockflow_economic_source_lines
        (voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
        values(v,'1',product,case when product='C' then 7.5 else 10 end,'Nos',0,'{}');
    end loop;
  end loop;
  for fixture in select * from (values
    ('revision',0,'2026-11-10'::date,'sale',false,'A',900::numeric),
    ('revision',1,'2026-11-10'::date,'sale',false,'A',0::numeric),
    ('cancelled',0,'2026-11-18'::date,'sale',true,'A',900::numeric),
    ('return',0,'2026-11-11'::date,'return',false,'G',15::numeric),
    ('moved',0,'2026-11-10'::date,'sale',false,'A',900::numeric),
    ('moved',1,'2026-11-19'::date,'sale',false,'A',900::numeric),
    ('boundary',0,v_today-90,'sale',false,'A',900::numeric),
    ('old',0,v_today-180,'sale',false,'A',900::numeric)
  ) f(source_id,revision,business_date,kind,cancelled,product_id,quantity) loop
    insert into private.stockflow_economic_source_vouchers
      (company_id,source_id,source_revision,business_date,kind,cancelled,evidence)
      values('reorder-test',fixture.source_id,fixture.revision,fixture.business_date,
        fixture.kind,fixture.cancelled,'{}') returning id into v;
    insert into private.stockflow_economic_source_lines
      (voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
      values(v,'1',fixture.product_id,fixture.quantity,'Nos',0,'{}');
  end loop;
  r:=private.stockflow_reorder_check(v_today);
  if r->>'view' is distinct from 'reorder_check' or r->>'coverDays' is distinct from '60'
    or r->>'windowDays' is distinct from '90' or r->>'salesThrough' is distinct from '2026-11-10'
    or r->>'shortCount' is distinct from '2' or r->>'levelCount' is distinct from '2'
    or jsonb_array_length(r->'short')<>2 or jsonb_array_length(r->'level')<>2 then
    raise exception 'Reorder contract: %',r;
  end if;
  a:=r->'short'->0;
  if a->>'itemKey' is distinct from 'A' or (a->>'target')::numeric<>20
    or (a->>'daysCover')::numeric<>15 or (a->>'usedLast90')::numeric<>30
    or (a->>'closing')::numeric<>5 or (a->>'onOrder')::numeric<>0 then
    raise exception 'Short / revisions / cancelled: %',a;
  end if;
  a:=r->'short'->1;
  if a->>'itemKey' is distinct from 'G' or (a->>'usedLast90')::numeric<>15
    or (a->>'target')::numeric<>10 or (a->>'daysCover')::numeric<>30 then
    raise exception 'Return netting: %',a;
  end if;
  if r->'level'->0->>'itemKey' is distinct from 'F' or r->'level'->0->>'direction' is distinct from 'low'
    or r->'level'->1->>'itemKey' is distinct from 'D' or r->'level'->1->>'direction' is distinct from 'high'
    or (r->'level'->0->>'target')::numeric<>20 or (r->'level'->1->>'target')::numeric<>20 then
    raise exception 'Level range / order: %',r;
  end if;
  if r::text like '%rate%' then raise exception 'Privacy: %',r; end if;
  r:=public.stockflow_requirements_gateway('reorder-key','reorder-ops@test.local','get_requirements','{"view":"reorder_check"}');
  if r->>'view' is distinct from 'reorder_check' then raise exception 'Gateway read: %',r; end if;
  begin
    perform public.stockflow_requirements_gateway('wrong','reorder-ops@test.local','get_requirements','{"view":"reorder_check","x":1}');
    raise exception 'Wrong key allowed';
  exception when sqlstate '42501' then null; end;
  begin
    perform public.stockflow_requirements_gateway('reorder-key','reorder-inactive@test.local','get_requirements','{"view":"reorder_check","x":1}');
    raise exception 'Inactive member allowed';
  exception when sqlstate '42501' then null; end;
  begin
    perform public.stockflow_requirements_gateway('reorder-key','reorder-sales@test.local','get_requirements','{"view":"reorder_check","x":1}');
    raise exception 'Sales member allowed';
  exception when sqlstate '42501' then null; end;
  begin
    perform public.stockflow_requirements_gateway('reorder-key','reorder-ops@test.local','get_requirements','{"view":"reorder_check","x":1}');
    raise exception 'Extra payload allowed';
  exception when sqlstate '22023' then null; end;
  r:=public.stockflow_requirements_gateway('reorder-key','reorder-sales@test.local','get_requirements','{"view":"cover"}');
  if r->>'view' is distinct from 'cover' then raise exception 'Cover delegation: %',r; end if;
  delete from private.stockflow_reorder_policies;
  r:=private.stockflow_reorder_check(v_today);
  if r is distinct from '{"view":"reorder_check","coverDays":null,"windowDays":90,"salesThrough":null,"shortCount":0,"levelCount":0,"short":[],"level":[]}'::jsonb then
    raise exception 'No policy: %',r;
  end if;
  raise notice 'PASS reorder checks: steady sales, targets, returns, revisions, guards, policy, privacy and gateway';
end $test$;
rollback;
