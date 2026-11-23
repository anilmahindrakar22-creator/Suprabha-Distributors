begin;
update private.stockflow_gateway_config
  set secret_sha256=encode(extensions.digest('late-pos-key','sha256'),'hex') where name='orders';
insert into public.stockflow_members(email,role,roles,status) values
  ('late-ops@test.local','operations',array['operations'],'active'),
  ('late-sales@test.local','sales',array['sales'],'active'),
  ('late-inactive@test.local','operations',array['operations'],'suspended');

do $test$
declare r jsonb; a jsonb; v uuid; fixture record;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  update private.stockflow_purchase_orders set status='cancelled' where status='open';
  delete from private.stockflow_stock_policies;
  insert into private.stockflow_stock_policies(lead_time_days,effective_from,created_by_email,reason)
    values(7,v_today,'late-ops@test.local','Late PO fixture');
  -- Future policies must not replace the current policy.
  insert into private.stockflow_stock_policies(lead_time_days,effective_from,created_by_email,reason)
    values(1,v_today+1,'late-ops@test.local','Future fixture');
  for fixture in select * from (values
    ('PO/LATE/0001','open',10,'Mixed',10::numeric,0::numeric),
    ('PO/LATE/0002','open',2,'Mixed',8,3),
    ('PO/LATE/0003','open',7,'Boundary',4,0),
    ('PO/LATE/0004','open',8,'One day',4,0),
    ('PO/LATE/0005','open',10,'Full',4,4),
    ('PO/LATE/0006','received',10,'Received',4,0),
    ('PO/LATE/0007','cancelled',10,'Cancelled',4,0),
    ('PO/LATE/0008','open',2,'Fresh',4,0),
    ('PO/LATE/0009','open',10,'Tie',1,0)
  ) f(po_number,status,age,item_key,quantity,received) loop
    insert into private.stockflow_purchase_orders(po_number,supplier_name,status,created_by_email,created_at)
      values(fixture.po_number,'Late supplier',fixture.status,'late-ops@test.local',
        (v_today-fixture.age+time '00:05') at time zone 'Asia/Kolkata') returning id into v;
    insert into private.stockflow_purchase_order_lines(po_id,tally_item_key,item_name,quantity,received_quantity,rate)
      values(v,fixture.item_key,fixture.item_key,fixture.quantity,fixture.received,123);
    if fixture.po_number='PO/LATE/0001' then
      insert into private.stockflow_purchase_order_lines(po_id,tally_item_key,item_name,quantity,received_quantity,rate)
        values(v,'Second','Second',2.1234,1,123),(v,'Received line','Received line',3,3,123);
    end if;
  end loop;
  r:=public.stockflow_requirements_gateway('late-pos-key','late-ops@test.local','get_requirements','{"view":"late_pos"}');
  if r->>'view' is distinct from 'late_pos' or r->>'leadTimeDays' is distinct from '7'
    or r->>'total' is distinct from '3' or jsonb_array_length(r->'items')<>3 then
    raise exception 'Late list contract: %',r;
  end if;
  a:=r->'items'->0;
  if a->>'poNumber' is distinct from 'PO/LATE/0001' or a->>'lateDays' is distinct from '3'
    or a->>'dueLines' is distinct from '2' or (a->>'dueQuantity')::numeric is distinct from 11.123::numeric
    or a->>'supplierName' is distinct from 'Late supplier'
    or (a->>'createdAt')::timestamptz is distinct from ((v_today-10+time '00:05') at time zone 'Asia/Kolkata')
    or r->'items'->1->>'poNumber' is distinct from 'PO/LATE/0009'
    or r->'items'->2->>'poNumber' is distinct from 'PO/LATE/0004'
    or r->'items'->2->>'lateDays' is distinct from '1' then raise exception 'Late order or due lines: %',r; end if;
  if r::text like '%"rate"%' then raise exception 'Money leaked: %',r; end if;
  r:=public.stockflow_requirements_gateway('late-pos-key','late-sales@test.local','get_requirements','{"view":"on_po"}');
  select x into a from jsonb_array_elements(r->'items') x where x->>'itemKey'='Mixed';
  if a is null or a->>'lateDays' is distinct from '3' or a->>'latePoNumber' is distinct from 'PO/LATE/0001'
    or (a->>'dueQuantity')::numeric is distinct from 15::numeric or a->>'poCount' is distinct from '2'
    or a->>'latestPoNumber' is distinct from 'PO/LATE/0002'
    or (a->>'latestCreatedAt')::timestamptz is distinct from ((v_today-2+time '00:05') at time zone 'Asia/Kolkata') then
    raise exception 'On PO contract: %',a;
  end if;
  select x into a from jsonb_array_elements(r->'items') x where x->>'itemKey'='Fresh';
  if a is null or a->>'lateDays' is distinct from '0' or a->'latePoNumber' is distinct from 'null'::jsonb then
    raise exception 'Fresh on PO: %',a;
  end if;
  select x into a from jsonb_array_elements(r->'items') x where x->>'itemKey'='Boundary';
  if a->>'lateDays' is distinct from '0' then raise exception 'Seven day boundary: %',a; end if;
  begin
    perform public.stockflow_requirements_gateway('wrong','late-ops@test.local','get_requirements','{"view":"late_pos"}');
    raise exception 'Wrong key allowed';
  exception when sqlstate '42501' then null; end;
  begin
    perform public.stockflow_requirements_gateway('late-pos-key','late-inactive@test.local','get_requirements','{"view":"late_pos"}');
    raise exception 'Inactive member allowed';
  exception when sqlstate '42501' then null; end;
  begin
    perform public.stockflow_requirements_gateway('late-pos-key','late-sales@test.local','get_requirements','{"view":"late_pos"}');
    raise exception 'Sales member allowed';
  exception when sqlstate '42501' then null; end;
  begin
    perform public.stockflow_requirements_gateway('late-pos-key','late-ops@test.local','get_requirements','{"view":"late_pos","x":1}');
    raise exception 'Extra payload allowed';
  exception when sqlstate '22023' then null; end;
  r:=public.stockflow_requirements_gateway('late-pos-key','late-sales@test.local','get_requirements','{"view":"cover"}');
  if r->>'view' is distinct from 'cover' then raise exception 'Cover delegation: %',r; end if;
  delete from private.stockflow_stock_policies;
  r:=private.stockflow_late_pos();
  if r is distinct from '{"view":"late_pos","leadTimeDays":null,"total":0,"items":[]}'::jsonb then
    raise exception 'No policy late list: %',r;
  end if;
  r:=private.stockflow_stock_on_po();
  if exists(select 1 from jsonb_array_elements(r->'items') x
    where x->>'lateDays' is distinct from '0' or x->'latePoNumber' is distinct from 'null'::jsonb) then
    raise exception 'No policy on PO: %',r;
  end if;
  raise notice 'PASS late POs: IST boundaries, due lines, policy, privacy, roles and delegation';
end $test$;
rollback;
