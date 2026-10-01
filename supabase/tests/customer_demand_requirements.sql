begin;
insert into public.stockflow_members(email,role,status) values('requirements@test.local','sales','active');
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('requirements-key','sha256'),'hex') where name='orders';
insert into public.stockflow_snapshots(id,company,fetched_at,payload) values('suprabha','TEST',now()::text,'{"catalog":[{"tallyKey":"DEMAND-A","item":"Demand A","closing":4},{"tallyKey":"DEMAND-C","item":"Demand C","closing":-4}],"rows":[],"groups":[],"fetchedAt":"2026-10-01T00:00:00Z"}'::jsonb)
on conflict(id) do update set payload=excluded.payload;
insert into private.stockflow_orders(id,customer_name,status,priority,created_by_email,updated_by_email,idempotency_key,created_at) values
 ('10000000-0000-4000-8000-000000000001','Demand test','confirmed','high','test','test','demand-order-0001','2026-09-01'),
 ('10000000-0000-4000-8000-000000000002','Demand test','confirmed','normal','test','test','demand-order-0002','2026-09-02'),
 ('10000000-0000-4000-8000-000000000003','Demand test','awaiting_confirmation','normal','test','test','demand-order-0003','2026-09-03'),
 ('10000000-0000-4000-8000-000000000004','Demand test','cancelled','normal','test','test','demand-order-0004','2026-09-04'),
 ('10000000-0000-4000-8000-000000000005','Demand test','delivered','normal','test','test','demand-order-0005','2026-09-05'),
 ('10000000-0000-4000-8000-000000000006','Demand test','confirmed','urgent','test','test','demand-order-0006','2026-09-06');
insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,quantity,fulfilled_quantity) values
 ('10000000-0000-4000-8000-000000000001','DEMAND-A','Demand A',10,2),
 ('10000000-0000-4000-8000-000000000002','DEMAND-A','Demand A',5,0),
 ('10000000-0000-4000-8000-000000000003','DEMAND-A','Demand A',100,0),
 ('10000000-0000-4000-8000-000000000004','DEMAND-A','Demand A',100,0),
 ('10000000-0000-4000-8000-000000000005','DEMAND-A','Demand A',100,0),
 ('10000000-0000-4000-8000-000000000006','DEMAND-B','Demand B',3,0),
 ('10000000-0000-4000-8000-000000000006','DEMAND-C','Demand C',2,0),
 ('10000000-0000-4000-8000-000000000006','DEMAND-FULL','Fulfilled',1,1);
do $test$
declare result jsonb; row_a jsonb; row_b jsonb; row_c jsonb; before_orders jsonb; initial_total integer;
begin
  select jsonb_agg(to_jsonb(o) order by id) into before_orders from private.stockflow_orders o;
  result:=public.stockflow_requirements_gateway('requirements-key','requirements@test.local','get_requirements','{"page":1}');
  initial_total:=(result->'pagination'->>'total')::integer;
  select value into row_a from jsonb_array_elements(result->'rows') where value->>'tallyKey'='DEMAND-A';
  select value into row_b from jsonb_array_elements(result->'rows') where value->>'tallyKey'='DEMAND-B';
  select value into row_c from jsonb_array_elements(result->'rows') where value->>'tallyKey'='DEMAND-C';
  if row_a->>'openDemand' is distinct from '13.000' or (row_a->>'shortage')::numeric<>9 or (row_a->>'affectedOrders')::integer<>2 or row_a->>'priority'<>'high' then raise exception 'Demand aggregation wrong: %',row_a; end if;
  if row_b is null or row_b->'currentStock'<>'null'::jsonb or row_b->'shortage'<>'null'::jsonb then raise exception 'Unknown stock fabricated: %',row_b; end if;
  if (row_c->>'shortage')::numeric<>2 then raise exception 'Negative stock must not imply availability'; end if;
  if exists(select 1 from jsonb_array_elements(result->'rows') where value->>'tallyKey'='DEMAND-FULL') then raise exception 'Fulfilled demand included'; end if;
  if before_orders is distinct from (select jsonb_agg(to_jsonb(o) order by id) from private.stockflow_orders o) then raise exception 'Projection mutated orders'; end if;
  if has_function_privilege('authenticated','public.stockflow_requirements_gateway(text,text,text,jsonb)','EXECUTE') then raise exception 'Direct browser execution granted'; end if;
  insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,quantity)
    select '10000000-0000-4000-8000-000000000001','DEMAND-PAGE-'||n,'Page reagent '||n,1 from generate_series(1,30) n;
  result:=public.stockflow_requirements_gateway('requirements-key','requirements@test.local','get_requirements','{"page":2}');
  if (result->'pagination'->>'total')::integer<>initial_total+30 or (result->'pagination'->>'pageCount')::integer<>2 or jsonb_array_length(result->'rows')<>initial_total+30-25 then raise exception 'Whole-demand pagination incorrect: %',result->'pagination'; end if;
  begin
    perform public.stockflow_requirements_gateway('requirements-key','not-member@test.local','get_requirements'); raise exception 'Nonmember allowed';
  exception when insufficient_privilege then null; end;
  update public.stockflow_snapshots set payload=payload||'{"catalog":[{"tallyKey":"DEMAND-A","closing":20}]}'::jsonb where id='suprabha';
  result:=public.stockflow_requirements_gateway('requirements-key','requirements@test.local','get_requirements');
  select value into row_a from jsonb_array_elements(result->'rows') where value->>'tallyKey'='DEMAND-A';
  if (row_a->>'shortage')::numeric<>0 then raise exception 'Stock arrival did not rebuild shortage'; end if;
  update public.stockflow_snapshots set payload=payload||'{"sourceFetchedAtIso":{"stock":"2026-10-01T12:00:00Z","catalog":"2026-10-01T08:00:00Z"}}'::jsonb where id='suprabha';
  result:=public.stockflow_requirements_gateway('requirements-key','requirements@test.local','get_requirements');
  if result->>'fetchedAt'<>'2026-10-01T08:00:00Z' then raise exception 'Upload date hid older catalog stock'; end if;
  update public.stockflow_snapshots set payload=payload||'{"catalog":[{"tallyKey":"DEMAND-A","closing":20},{"tallyKey":"DEMAND-A","closing":30},{"tallyKey":"DEMAND-B","closing":"invalid"}]}'::jsonb where id='suprabha';
  result:=public.stockflow_requirements_gateway('requirements-key','requirements@test.local','get_requirements');
  select value into row_a from jsonb_array_elements(result->'rows') where value->>'tallyKey'='DEMAND-A';
  select value into row_b from jsonb_array_elements(result->'rows') where value->>'tallyKey'='DEMAND-B';
  if row_a->'currentStock' is distinct from 'null'::jsonb or row_a->'shortage' is distinct from 'null'::jsonb then raise exception 'Duplicate stock evidence fabricated availability'; end if;
  if row_b->'currentStock' is distinct from 'null'::jsonb or row_b->'shortage' is distinct from 'null'::jsonb then raise exception 'Malformed stock evidence fabricated availability'; end if;
end $test$;
rollback;
