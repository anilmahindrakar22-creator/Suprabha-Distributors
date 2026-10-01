begin;
insert into public.stockflow_members(email,role,status) values('stock-alert@test.local','warehouse','active');
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('stock-alert-key','sha256'),'hex') where name='orders';
insert into private.stockflow_orders(id,customer_name,status,priority,created_by_email,updated_by_email,idempotency_key)
values('20000000-0000-4000-8000-000000000001','Alert test','confirmed','normal','test','test','stock-alert-order');
insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,quantity,fulfilled_quantity)
values('20000000-0000-4000-8000-000000000001','STOCK-ALERT','Alert reagent',5,1);
insert into public.stockflow_snapshots(id,company,fetched_at,payload)
values('suprabha','ALERT TEST',now()::text,'{"catalogVersion":"2026-10-01T01:00:00Z","catalog":[{"tallyKey":"STOCK-ALERT","closing":0}]}'::jsonb)
on conflict(id) do update set company=excluded.company,payload=excluded.payload;
do $test$
declare result jsonb; before_order jsonb;
begin
  select to_jsonb(o) into before_order from private.stockflow_orders o where id='20000000-0000-4000-8000-000000000001';
  update public.stockflow_snapshots set payload=payload||'{"catalog":[{"tallyKey":"STOCK-ALERT","closing":4}]}'::jsonb where id='suprabha';
  if exists(select 1 from private.stockflow_order_events where order_id='20000000-0000-4000-8000-000000000001' and event_type='stock_increase_reported') then raise exception 'Unchanged source produced alert'; end if;
  update public.stockflow_snapshots set payload=payload||'{"catalogVersion":"2026-10-01T02:00:00Z","catalog":[{"tallyKey":"STOCK-ALERT","closing":0}]}'::jsonb where id='suprabha';
  update public.stockflow_snapshots set payload=payload||'{"catalogVersion":"2026-10-01T03:00:00Z","catalog":[{"tallyKey":"STOCK-ALERT","closing":4}]}'::jsonb where id='suprabha';
  if (select count(*) from private.stockflow_order_events where order_id='20000000-0000-4000-8000-000000000001' and event_type='stock_increase_reported')<>1 then raise exception 'Valid increase did not create one audit'; end if;
  if (select count(*) from private.stockflow_outbox where aggregate_id='20000000-0000-4000-8000-000000000001' and topic='stockflow.stock_increase_reported')<>1 then raise exception 'Valid increase did not create one outbox event'; end if;
  result:=public.stockflow_stock_alert_gateway('stock-alert-key','stock-alert@test.local','get_stock_alerts');
  if (result->'pagination'->>'total')::integer<>1 or (result->'alerts'->0->>'stockAfter')::numeric<>4 then raise exception 'Alert read wrong: %',result; end if;
  if before_order is distinct from (select to_jsonb(o) from private.stockflow_orders o where id='20000000-0000-4000-8000-000000000001') then raise exception 'Alert mutated order state'; end if;
  -- Replayed source, including a stale upload followed by replay, cannot duplicate.
  update public.stockflow_snapshots set payload=payload||'{"catalogVersion":"2026-10-01T02:00:00Z","catalog":[{"tallyKey":"STOCK-ALERT","closing":0}]}'::jsonb where id='suprabha';
  update public.stockflow_snapshots set payload=payload||'{"catalogVersion":"2026-10-01T03:00:00Z","catalog":[{"tallyKey":"STOCK-ALERT","closing":4}]}'::jsonb where id='suprabha';
  if (select count(*) from private.stockflow_outbox where aggregate_id='20000000-0000-4000-8000-000000000001' and topic='stockflow.stock_increase_reported')<>1 then raise exception 'Replay duplicated outbox'; end if;
  update public.stockflow_snapshots set payload=payload||'{"catalogVersion":"2026-10-01T04:00:00Z","catalog":[{"tallyKey":"STOCK-ALERT","closing":6},{"tallyKey":"STOCK-ALERT","closing":7}]}'::jsonb where id='suprabha';
  update public.stockflow_snapshots set payload=payload||'{"catalogVersion":"2026-10-01T05:00:00Z","catalog":[{"tallyKey":"STOCK-ALERT","closing":8}]}'::jsonb where id='suprabha';
  update public.stockflow_snapshots set payload=payload||'{"catalogVersion":"invalid","catalog":[{"tallyKey":"STOCK-ALERT","closing":9}]}'::jsonb where id='suprabha';
  if (select count(*) from private.stockflow_order_events where order_id='20000000-0000-4000-8000-000000000001' and event_type='stock_increase_reported')<>1 then raise exception 'Unreliable stock evidence created notice'; end if;
  if has_function_privilege('authenticated','public.stockflow_stock_alert_gateway(text,text,text,jsonb)','EXECUTE') then raise exception 'Browser RPC grant'; end if;
  begin
    perform public.stockflow_stock_alert_gateway('wrong','stock-alert@test.local','get_stock_alerts'); raise exception 'Wrong key permitted';
  exception when insufficient_privilege then null; end;
  update private.stockflow_order_lines set fulfilled_quantity=quantity where order_id='20000000-0000-4000-8000-000000000001';
  result:=public.stockflow_stock_alert_gateway('stock-alert-key','stock-alert@test.local','get_stock_alerts');
  if (result->'pagination'->>'total')::integer<>0 then raise exception 'Fulfilled order still alerted'; end if;
end $test$;
-- A failed required outbox write must roll back snapshot + audit together.
update private.stockflow_order_lines set fulfilled_quantity=1 where order_id='20000000-0000-4000-8000-000000000001';
update public.stockflow_snapshots set payload=payload||'{"catalogVersion":"2026-10-01T06:00:00Z","catalog":[{"tallyKey":"STOCK-ALERT","closing":0}]}'::jsonb where id='suprabha';
create function private.stock_alert_test_failure() returns trigger language plpgsql as $$ begin if new.topic='stockflow.stock_increase_reported' then raise exception 'injected outbox failure'; end if; return new; end $$;
create trigger stock_alert_test_failure before insert on private.stockflow_outbox for each row execute function private.stock_alert_test_failure();
do $test$
begin
  begin
    update public.stockflow_snapshots set payload=payload||'{"catalogVersion":"2026-10-01T07:00:00Z","catalog":[{"tallyKey":"STOCK-ALERT","closing":10}]}'::jsonb where id='suprabha';
    raise exception 'Expected injected failure';
  exception when raise_exception then if sqlerrm<>'injected outbox failure' then raise; end if; end;
  if (select payload->>'catalogVersion' from public.stockflow_snapshots where id='suprabha')<>'2026-10-01T06:00:00Z' then raise exception 'Failed alert left snapshot change'; end if;
  if (select count(*) from private.stockflow_order_events where order_id='20000000-0000-4000-8000-000000000001' and event_type='stock_increase_reported')<>1 then raise exception 'Failed alert left partial audit'; end if;
end $test$;
drop trigger stock_alert_test_failure on private.stockflow_outbox;
drop function private.stock_alert_test_failure();
insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,quantity)
  select '20000000-0000-4000-8000-000000000001','ALERT-PAGE-'||n,'Page item '||n,1 from generate_series(1,21) n;
update public.stockflow_snapshots set payload=jsonb_build_object('catalogVersion','2026-10-01T08:00:00Z',
  'catalog',(select jsonb_agg(jsonb_build_object('tallyKey','ALERT-PAGE-'||n,'closing',0)) from generate_series(1,21) n)) where id='suprabha';
update public.stockflow_snapshots set payload=jsonb_build_object('sourceFetchedAtIso',jsonb_build_object('catalog','2026-10-01T09:00:00Z','stock','2026-10-01T12:00:00Z'),
  'catalog',(select jsonb_agg(jsonb_build_object('tallyKey','ALERT-PAGE-'||n,'closing',2)) from generate_series(1,21) n)) where id='suprabha';
do $test$
declare result jsonb;
begin
  result:=public.stockflow_stock_alert_gateway('stock-alert-key','stock-alert@test.local','get_stock_alerts','{"page":2}');
  if (result->'pagination'->>'total')::integer<>22 or (result->'pagination'->>'pageCount')::integer<>2 or jsonb_array_length(result->'alerts')<>2 then raise exception 'Alert pagination incorrect: %',result; end if;
  if exists(select 1 from jsonb_array_elements(result->'alerts') r,jsonb_object_keys(r) k where k not in ('tallyKey','itemName','stockBefore','stockAfter','sourceAt','affectedOrders')) then raise exception 'Commercial facts leaked through alerts'; end if;
  result:=public.stockflow_stock_alert_gateway('stock-alert-key','stock-alert@test.local','get_stock_alerts');
  if result->'alerts'->0->>'sourceAt'<>'2026-10-01T09:00:00.000000Z' then raise exception 'Alert used upload/stock time rather than catalog time'; end if;
  update public.stockflow_members set status='suspended' where email='stock-alert@test.local';
  begin
    perform public.stockflow_stock_alert_gateway('stock-alert-key','stock-alert@test.local','get_stock_alerts'); raise exception 'Suspended member allowed';
  exception when insufficient_privilege then null; end;
end $test$;
rollback;
