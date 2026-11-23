begin;
update private.stockflow_gateway_config
  set secret_sha256=encode(extensions.digest('idle-stock-key','sha256'),'hex') where name='orders';
insert into public.stockflow_members(email,role,roles,status) values
  ('idle-stock@test.local','operations',array['operations'],'active');

do $test$
declare r jsonb; baseline jsonb; fixture record; v uuid; fixture_catalog jsonb; c_index integer; b_index integer;
begin
  baseline:=private.stockflow_idle_stock('2026-11-18',1);
  fixture_catalog:='[
    {"item":"Test Item A","group":"Test group","closing":2,"baseUnit":"Nos"},
    {"item":"Test Item B","group":"Test group","closing":3,"baseUnit":"Nos"},
    {"item":"Test Item C","group":"Test group","closing":4,"baseUnit":"Nos"},
    {"item":"Test Item D","group":"Test group","closing":5,"baseUnit":"Nos"},
    {"item":"Test Item E","group":"Test group","closing":0,"baseUnit":"Nos"},
    {"item":"Test Item F","group":"Test group","closing":6,"baseUnit":"Nos"}]';
  fixture_catalog:=fixture_catalog||jsonb_build_array(jsonb_build_object(
    'item','Test Item G','group',E'\u0004 Primary','closing',7,'baseUnit','Nos'));
  insert into public.stockflow_snapshots(id,company,fetched_at,payload)
    values('suprabha','Idle stock test',now()::text,jsonb_build_object('catalog',fixture_catalog))
    on conflict(id) do update set payload=jsonb_set(coalesce(stockflow_snapshots.payload,'{}'::jsonb),'{catalog}',
      (case when jsonb_typeof(stockflow_snapshots.payload->'catalog')='array'
        then stockflow_snapshots.payload->'catalog' else '[]'::jsonb end)||fixture_catalog);
  insert into private.stockflow_economic_item_catalogs(company_id,source_version,observed_at,content)
    values('idle-stock-test','idle-v1',now(),'{"groups":[],"products":[
      {"id":"a","name":"Test Item A"},{"id":"b","name":"Test Item B"},
      {"id":"c","name":"Test Item C"},{"id":"d","name":"Test Item D"},
      {"id":"e","name":"Test Item E"},{"id":"f","name":"Test Item F"}]}');
  for fixture in select * from (values
    ('sale-a',0,'2026-11-18'::date-10,'sale',false,'a'),
    ('sale-b',0,'2026-11-18'::date-200,'sale',false,'b'),
    ('sale-d',0,'2026-11-18'::date-200,'sale',false,'d'),
    ('sale-d',1,'2026-11-18'::date-200,'sale',true,'d'),
    ('return-f',0,'2026-11-18'::date-5,'return',false,'f')
  ) f(source_id,revision,business_date,kind,cancelled,product_id) loop
    insert into private.stockflow_economic_source_vouchers
      (company_id,source_id,source_revision,business_date,kind,cancelled,evidence)
      values('idle-stock-test',fixture.source_id,fixture.revision,fixture.business_date,
        fixture.kind,fixture.cancelled,'{}') returning id into v;
    insert into private.stockflow_economic_source_lines
      (voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
      values(v,'1',fixture.product_id,1,'Nos',0,'{}');
  end loop;
  r:=private.stockflow_idle_stock('2026-11-18',1);
  if (r->>'idleCount')::integer<>(baseline->>'idleCount')::integer+5
    or (r->>'inStockCount')::integer<>(baseline->>'inStockCount')::integer+6 then
    raise exception 'Idle/in-stock deltas: baseline %, result %',baseline,r;
  end if;
  -- Restrict the stock catalog to fixtures so existing items cannot displace them from page 1.
  update public.stockflow_snapshots set payload=jsonb_set(payload,'{catalog}',fixture_catalog) where id='suprabha';
  r:=private.stockflow_idle_stock('2026-11-18',1);
  if r->>'view' is distinct from 'idle' or r->>'windowDays' is distinct from '180'
    or jsonb_array_length(r->'items')<>5 then raise exception 'Idle contract: %',r; end if;
  if not jsonb_path_exists(r,'$.items[*] ? (@.itemKey == "Test Item G" && @.group == null && @.lastSoldOn == null)') then
    raise exception 'Tally root group must be null: %',r;
  end if;
  if jsonb_path_exists(r,'$.items[*] ? (@.itemKey == "Test Item A" || @.itemKey == "Test Item E")') then
    raise exception 'Recent sale or zero stock included: %',r;
  end if;
  if not jsonb_path_exists(r,'$.items[*] ? (@.itemKey == "Test Item B" && @.lastSoldOn == "2026-05-02")') then
    raise exception 'Old sale date: %',r;
  end if;
  if (select count(*) from jsonb_array_elements(r->'items') i
    where i->>'itemKey' in ('Test Item C','Test Item D','Test Item F') and i->'lastSoldOn'='null'::jsonb)<>3 then
    raise exception 'Never sold / cancelled revision / returns: %',r;
  end if;
  select ord::integer into c_index from jsonb_array_elements(r->'items') with ordinality a(i,ord) where i->>'itemKey'='Test Item C';
  select ord::integer into b_index from jsonb_array_elements(r->'items') with ordinality a(i,ord) where i->>'itemKey'='Test Item B';
  if c_index>=b_index then raise exception 'Null dates must sort first: %',r; end if;
  if (select array_agg(k order by k collate "C")
      from jsonb_object_keys(r->'items'->0) k)
      is distinct from array['baseUnit','closing','group','itemKey','lastSoldOn']::text[] then
    raise exception 'Idle stock speed item JSON keys changed: %',r->'items'->0;
  end if;
  if r->'items' is distinct from '[
    {"itemKey":"Test Item C","group":"Test group","closing":4,"baseUnit":"Nos","lastSoldOn":null},
    {"itemKey":"Test Item D","group":"Test group","closing":5,"baseUnit":"Nos","lastSoldOn":null},
    {"itemKey":"Test Item F","group":"Test group","closing":6,"baseUnit":"Nos","lastSoldOn":null},
    {"itemKey":"Test Item G","group":null,"closing":7,"baseUnit":"Nos","lastSoldOn":null},
    {"itemKey":"Test Item B","group":"Test group","closing":3,"baseUnit":"Nos","lastSoldOn":"2026-05-02"}
  ]'::jsonb then
    raise exception 'Idle stock speed items, values or order changed: %',r->'items';
  end if;
  r:=private.stockflow_idle_stock('2026-11-18',2);
  if r->'items' is distinct from '[]'::jsonb then raise exception 'Fixture page 2 must be empty: %',r; end if;
  r:=public.stockflow_requirements_gateway('idle-stock-key','idle-stock@test.local','get_requirements','{"view":"idle","page":1}');
  if r->>'view' is distinct from 'idle' then raise exception 'Operations access: %',r; end if;
  for fixture in select payload from (values
    ('{"view":"idle","page":0}'::jsonb),('{"view":"idle","page":1,"extra":1}'::jsonb),
    ('{"view":"idle"}'::jsonb),('{"view":"idle","page":"1"}'::jsonb),
    ('{"view":"idle","page":1.5}'::jsonb),('{"view":"idle","page":101}'::jsonb)
  ) f(payload) loop
    begin
      perform public.stockflow_requirements_gateway('idle-stock-key','idle-stock@test.local','get_requirements',fixture.payload);
      raise exception 'Invalid idle payload allowed: %',fixture.payload;
    exception when sqlstate '22023' then null; end;
  end loop;
  raise notice 'PASS idle stock speed: same contract, lines materialized first';
end $test$;
rollback;
