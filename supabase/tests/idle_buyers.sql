begin;
update private.stockflow_gateway_config
  set secret_sha256=encode(extensions.digest('idle-buyers-key','sha256'),'hex') where name='orders';
insert into public.stockflow_members(email,role,roles,status) values
  ('idle-management@test.local','management',array['management'],'active'),
  ('idle-sales@test.local','sales',array['sales'],'active'),
  ('idle-other@test.local','sales',array['sales'],'active'),
  ('idle-accounts@test.local','accounts',array['accounts'],'active'),
  ('idle-inactive@test.local','sales',array['sales'],'suspended');

do $test$
declare r jsonb; expected jsonb; fixture record; v uuid; l1 uuid; l2 uuid; l3 uuid; territory uuid;
begin
  insert into private.stockflow_customers(name,created_by_email) values('Idle Lab 1','test') returning id into l1;
  insert into private.stockflow_customers(name,created_by_email) values('Idle Lab 2','test') returning id into l2;
  insert into private.stockflow_customers(name,created_by_email) values('Idle Lab 3','test') returning id into l3;
  insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by) values
    ('idle-buyers-test','l1',l1,'test'),('idle-buyers-test','l2',l2,'test'),('idle-buyers-test','l3',l3,'test');
  insert into private.stockflow_territories(name,created_by) values('Idle buyers test','test') returning id into territory;
  insert into private.stockflow_customer_assignments(customer_id,owner_email,territory_id,effective_from,version,created_by) values
    (l1,'idle-sales@test.local',territory,'2025-01-01',1,'test'),
    (l2,'idle-other@test.local',territory,'2025-01-01',1,'test');
  insert into public.stockflow_snapshots(id,company,fetched_at,payload)
    values('suprabha','Idle buyers test',now()::text,'{"catalog":[
      {"item":"Idle X","group":"Test","closing":2,"baseUnit":"Nos"},
      {"item":"Idle Y","group":"Test","closing":3,"baseUnit":"Nos"}]}')
    on conflict(id) do update set payload=excluded.payload;
  insert into private.stockflow_economic_item_catalogs(company_id,source_version,observed_at,content)
    values('idle-buyers-test','v1',now(),'{"groups":[],"products":[{"id":"x","name":"Idle X"},{"id":"y","name":"Idle Y"}]}');
  for fixture in select * from (values
    ('bill1','l1','2026-01-01'::date,1.2345),
    ('bill2','l1','2026-02-01'::date,2.3456),
    ('bill3','l2','2026-03-01'::date,4),
    ('bill4','l3','2026-04-01'::date,5),
    ('unlinked','unknown','2026-05-01'::date,6)
  ) f(source_id,customer,bought,quantity) loop
    insert into private.stockflow_economic_source_vouchers
      (company_id,source_id,source_revision,business_date,kind,cancelled,customer_source_id,evidence)
      values('idle-buyers-test',fixture.source_id,0,fixture.bought,'sale',false,fixture.customer,'{}') returning id into v;
    insert into private.stockflow_economic_source_lines
      (voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
      values(v,'1','x',fixture.quantity,'Nos',0,'{}');
  end loop;
  r:=private.stockflow_idle_stock('2026-11-18',1);
  expected:='[
    {"itemKey":"Idle Y","group":"Test","closing":3,"baseUnit":"Nos","lastSoldOn":null},
    {"itemKey":"Idle X","group":"Test","closing":2,"baseUnit":"Nos","lastSoldOn":"2026-05-01"}]';
  if (select jsonb_agg(i-'buyerCount' order by ord) from jsonb_array_elements(r->'items') with ordinality a(i,ord)) is distinct from expected
    or r->'items'->0->>'buyerCount'<>'0' or r->'items'->1->>'buyerCount'<>'3' then
    raise exception 'Idle list changed: %',r;
  end if;
  r:=public.stockflow_requirements_gateway('idle-buyers-key','idle-management@test.local','get_requirements','{"view":"idle_buyers","itemKey":"Idle X"}');
  if r->>'totalInScope'<>'3' or r->>'otherBuyers'<>'0' or jsonb_array_length(r->'buyers')<>3
    or r->'buyers'->0->>'customerName'<>'Idle Lab 3' or r->'buyers'->1->>'customerName'<>'Idle Lab 2'
    or r->'buyers'->2->>'customerName'<>'Idle Lab 1' or r->'buyers'->2->>'bills'<>'2'
    or (r->'buyers'->2->>'quantity')::numeric<>3.580 then raise exception 'Management history: %',r; end if;
  if r::text like '%rate%' then raise exception 'Private monetary field: %',r; end if;
  r:=public.stockflow_requirements_gateway('idle-buyers-key',' IDLE-SALES@test.local ','get_requirements','{"view":"idle_buyers","itemKey":"Idle X"}');
  if r->>'totalInScope'<>'1' or r->>'otherBuyers'<>'2' or jsonb_array_length(r->'buyers')<>1
    or r->'buyers'->0->>'customerId'<>l1::text or r::text like '%Idle Lab 2%' or r::text like '%Idle Lab 3%' then
    raise exception 'Sales scope: %',r;
  end if;
  update private.stockflow_customer_assignments set effective_to='2026-01-01' where customer_id=l1;
  r:=private.stockflow_idle_buyers('Idle X','idle-sales@test.local');
  if r->'buyers'<>'[]' or r->>'totalInScope'<>'0' or r->>'otherBuyers'<>'3' then raise exception 'Ended assignment: %',r; end if;
  r:=private.stockflow_idle_buyers('Idle Y',null);
  if r<> '{"view":"idle_buyers","itemKey":"Idle Y","buyers":[],"totalInScope":0,"otherBuyers":0}'::jsonb then raise exception 'No buyers: %',r; end if;
  for fixture in select * from (values
    ('wrong-key','idle-management@test.local'),
    ('idle-buyers-key','idle-inactive@test.local'),
    ('idle-buyers-key','idle-accounts@test.local')
  ) f(key,email) loop
    begin
      perform public.stockflow_requirements_gateway(fixture.key,fixture.email,'get_requirements','{"view":"idle_buyers","itemKey":"Idle X"}');
      raise exception 'Buyer access allowed: %',fixture;
    exception when sqlstate '42501' then null; end;
  end loop;
  for fixture in select payload from (values
    ('{"view":"idle_buyers","itemKey":"Idle X","extra":1}'::jsonb),
    ('{"view":"idle_buyers"}'::jsonb),('{"view":"idle_buyers","itemKey":1}'::jsonb),
    ('{"view":"idle_buyers","itemKey":"   "}'::jsonb)
  ) f(payload) loop
    begin
      perform public.stockflow_requirements_gateway('idle-buyers-key','idle-management@test.local','get_requirements',fixture.payload);
      raise exception 'Invalid payload allowed: %',fixture.payload;
    exception when sqlstate '22023' then null; end;
  end loop;
  r:=public.stockflow_requirements_gateway('idle-buyers-key','idle-management@test.local','get_requirements','{"view":"idle","page":1}');
  if r->>'view'<>'idle' then raise exception 'Idle delegate: %',r; end if;
  r:=public.stockflow_requirements_gateway('idle-buyers-key','idle-management@test.local','get_requirements','{"view":"cover"}');
  if r->>'view'<>'cover' then raise exception 'Cover delegate: %',r; end if;
end $test$;
rollback;
