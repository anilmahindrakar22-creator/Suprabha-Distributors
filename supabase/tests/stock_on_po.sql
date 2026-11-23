begin;
update private.stockflow_gateway_config
  set secret_sha256=encode(extensions.digest('stock-on-po-key','sha256'),'hex') where name='orders';
insert into public.stockflow_members(email,role,roles,status) values
  ('stock-on-po@test.local','sales',array['sales'],'active'),
  ('stock-on-po-inactive@test.local','sales',array['sales'],'suspended');

do $test$
declare r jsonb; a jsonb; v uuid; fixture record;
begin
  -- Earlier concurrency checks leave committed POs; isolate this fixture and roll back below.
  update private.stockflow_purchase_orders set status='cancelled' where status='open';
  insert into public.stockflow_snapshots(id,company,fetched_at,payload)
    values('suprabha','On PO test',now()::text,'{"rows":[{"item":"No open PO","closing":1}]}')
    on conflict(id) do update set payload=excluded.payload;
  r:=private.stockflow_stock_on_po();
  if r is distinct from '{"view":"on_po","items":[]}'::jsonb then raise exception 'Empty contract: %',r; end if;
  for fixture in select * from (values
    ('PO/26-27/0006','open','2026-11-01'::timestamptz,'On PO A',10,0),
    ('PO/26-27/0007','open','2026-11-02'::timestamptz,'On PO A',8,3),
    ('PO/26-27/0008','open','2026-11-03'::timestamptz,'Fully received',4,4),
    ('PO/26-27/0009','received','2026-11-04'::timestamptz,'Received PO',4,0),
    ('PO/26-27/0010','cancelled','2026-11-05'::timestamptz,'Cancelled PO',4,0)
  ) f(po_number,status,created_at,item_key,quantity,received) loop
    insert into private.stockflow_purchase_orders(po_number,supplier_name,status,created_by_email,created_at)
      values(fixture.po_number,'Private supplier fixture',fixture.status,'stock-on-po@test.local',fixture.created_at)
      returning id into v;
    insert into private.stockflow_purchase_order_lines(po_id,tally_item_key,item_name,quantity,received_quantity,rate)
      values(v,fixture.item_key,fixture.item_key,fixture.quantity,fixture.received,123);
  end loop;
  r:=public.stockflow_requirements_gateway('stock-on-po-key','stock-on-po@test.local','get_requirements','{"view":"on_po"}');
  if r->>'view' is distinct from 'on_po' or jsonb_array_length(r->'items')<>1 then
    raise exception 'Excluded lines or missing-item contract: %',r;
  end if;
  a:=r->'items'->0;
  if a->>'itemKey' is distinct from 'On PO A' or (a->>'dueQuantity')::numeric is distinct from 15::numeric
    or a->>'poCount' is distinct from '2' or a->>'latestPoNumber' is distinct from 'PO/26-27/0007'
    or (a->>'latestCreatedAt')::timestamptz is distinct from '2026-11-02'::timestamptz then
    raise exception 'Outstanding sum / latest PO: %',a;
  end if;
  if r::text ilike '%rate%' or r::text ilike '%Private supplier fixture%' then raise exception 'Private fields leaked: %',r; end if;
  begin
    perform public.stockflow_requirements_gateway('wrong-key','stock-on-po@test.local','get_requirements','{"view":"on_po"}');
    raise exception 'Wrong key allowed';
  exception when sqlstate '42501' then null; end;
  begin
    perform public.stockflow_requirements_gateway('stock-on-po-key','stock-on-po-inactive@test.local','get_requirements','{"view":"on_po"}');
    raise exception 'Inactive member allowed';
  exception when sqlstate '42501' then null; end;
  begin
    perform public.stockflow_requirements_gateway('stock-on-po-key','stock-on-po@test.local','get_requirements','{"view":"on_po","x":1}');
    raise exception 'Extra payload allowed';
  exception when sqlstate '22023' then null; end;
  r:=public.stockflow_requirements_gateway('stock-on-po-key','stock-on-po@test.local','get_requirements','{"view":"cover"}');
  if r->>'view' is distinct from 'cover' then raise exception 'Cover delegation: %',r; end if;
  raise notice 'PASS stock on-PO results, privacy, membership and delegation';
end $test$;
rollback;
