begin;
create extension if not exists dblink with schema public;

-- Independent sessions need committed fixtures. Create and remove only this disposable race's rows remotely.
do $race$
declare
  race_token uuid := gen_random_uuid();
  race_email text;
  original_config private.stockflow_push_config%rowtype;
  original_orders_hash text;
  original_snapshot jsonb;
  connection_string text := format('host=127.0.0.1 port=%s dbname=%s user=%s',current_setting('port'),current_database(),current_user);
  cleanup_sql text;
  first_rows jsonb;
  second_rows jsonb;
  second_pid integer;
  attempt integer;
  scenario integer;
  a_connected boolean := false;
  b_connected boolean := false;
begin
  if exists(select 1 from private.stockflow_push_subscriptions) then
    raise exception 'Push race requires a disposable database without subscriptions';
  end if;
  select * into strict original_config from private.stockflow_push_config where id;
  select secret_sha256 into strict original_orders_hash from private.stockflow_gateway_config where name = 'orders';
  select to_jsonb(s) into original_snapshot from public.stockflow_snapshots s where id = 'suprabha';
  race_email := 'push-race-' || race_token || '@test.local';
  cleanup_sql := format($cleanup$
    begin;
    set local session_replication_role = replica;
    delete from private.stockflow_push_deliveries where recipient_email = %1$L;
    delete from private.stockflow_push_subscriptions where member_email = %1$L;
    delete from private.stockflow_outbox where aggregate_id in (select id from private.stockflow_orders where created_by_email = %1$L);
    delete from private.stockflow_command_results where actor_email = %1$L;
    delete from private.stockflow_request_log where actor_email = %1$L;
    delete from private.stockflow_order_events where order_id in (select id from private.stockflow_orders where created_by_email = %1$L);
    delete from private.stockflow_order_lines where order_id in (select id from private.stockflow_orders where created_by_email = %1$L);
    delete from private.stockflow_orders where created_by_email = %1$L;
    delete from private.stockflow_customers where id = %2$L::uuid;
    delete from private.stockflow_products where tally_item_key = 'PUSH-RACE-' || %2$L;
    delete from public.stockflow_members where email = %1$L;
    update private.stockflow_push_config set push_enabled = %3$L::boolean,
      push_starts_at = %4$L::timestamptz, updated_at = %5$L::timestamptz where id;
    update private.stockflow_gateway_config set secret_sha256 = %6$L where name = 'orders';
    delete from public.stockflow_snapshots where id = 'suprabha';
    insert into public.stockflow_snapshots select s.*
      from jsonb_populate_record(null::public.stockflow_snapshots, %7$L::jsonb) s where s.id is not null;
    commit;
  $cleanup$, race_email, race_token, original_config.push_enabled, original_config.push_starts_at,
    original_config.updated_at, original_orders_hash, original_snapshot);
  perform public.dblink_connect('push_claim_a',connection_string);
  a_connected := true;
  perform public.dblink_connect('push_claim_b',connection_string);
  b_connected := true;
  perform public.dblink_exec('push_claim_a','set statement_timeout=''15s''');
  perform public.dblink_exec('push_claim_b','set statement_timeout=''15s''');
  perform public.dblink_exec('push_claim_a',format($setup$
    begin;
    insert into public.stockflow_members(email,role,roles,status) values(%1$L,'administrator',array['administrator'],'active');
    insert into private.stockflow_customers(id,name,tally_key,created_by_email)
      values(%2$L::uuid,'Push race fixture',%1$L,%1$L);
    insert into private.stockflow_products(tally_item_key,name,base_unit)
      values('PUSH-RACE-' || %2$L,'Push race reagent','Nos');
    insert into public.stockflow_snapshots(id,company,fetched_at,payload)
      values('suprabha','PUSH RACE TEST',now()::text,jsonb_build_object('catalog',jsonb_build_array(
        jsonb_build_object('tallyKey','PUSH-RACE-' || %2$L,'item','Push race reagent','baseUnit','Nos','group','Push tests','closing',10,'active',true))))
      on conflict(id) do update set payload = excluded.payload;
    update private.stockflow_gateway_config set secret_sha256 = encode(extensions.digest(%1$L,'sha256'),'hex') where name = 'orders';
    do $fixture$
    declare result jsonb; n integer;
    begin
      result := public.stockflow_order_gateway(%1$L,%1$L,'create_order',jsonb_build_object(
        'customerId',%2$L,'customerName','Push race fixture','source','phone','idempotencyKey',%1$L,
        'lines',jsonb_build_array(jsonb_build_object('tallyKey','PUSH-RACE-' || %2$L,'quantity',2))));
      if result->>'status' is distinct from 'awaiting_confirmation' or result->>'orderId' is null then
        raise exception 'Race order gateway failed';
      end if;
      for n in 1..2 loop
        perform public.stockflow_push_gateway(%1$L,%1$L,'push_subscribe',jsonb_build_object(
          'endpoint','https://push.test/race/' || %2$L || '/' || n,
          'keys',jsonb_build_object('p256dh','B' || repeat('A',86),'auth',repeat('A',22))));
      end loop;
    end $fixture$;
    update private.stockflow_push_config set push_enabled = true, push_starts_at = now() - interval '1 minute' where id;
    commit;
  $setup$,race_email,race_token));
  select pid into second_pid from public.dblink('push_claim_b','select pg_backend_pid()') as t(pid integer);
  for scenario in 1..2 loop
    if scenario = 2 then
      perform public.dblink_exec('push_claim_a',format(
        'update private.stockflow_push_deliveries set claimed_at=now()-interval ''3 minutes'' where recipient_email=%L',race_email));
    end if;
    perform public.dblink_exec('push_claim_a','begin');
    select rows into first_rows from public.dblink('push_claim_a',
      'select coalesce(jsonb_agg(to_jsonb(d)),''[]''::jsonb) from private.stockflow_push_due(1) d') as t(rows jsonb);
    if jsonb_array_length(first_rows) <> 1 then raise exception 'First sweep did not claim one row'; end if;
    perform public.dblink_send_query('push_claim_b',
      'select coalesce(jsonb_agg(to_jsonb(d)),''[]''::jsonb) from private.stockflow_push_due(2) d');
    for attempt in 1..500 loop
      exit when exists(select 1 from pg_locks where pid = second_pid and not granted);
      perform pg_sleep(0.01);
    end loop;
    if not exists(select 1 from pg_locks where pid = second_pid and not granted) then
      raise exception 'Overlapping sweeps did not contend on a real claim lock (scenario %)',scenario;
    end if;
    perform public.dblink_exec('push_claim_a','commit');
    select rows into second_rows from public.dblink_get_result('push_claim_b') as t(rows jsonb);
    perform * from public.dblink_get_result('push_claim_b') as t(rows jsonb);
    if jsonb_array_length(second_rows) <> 1 or exists(
      select 1 from jsonb_array_elements(first_rows) a cross join jsonb_array_elements(second_rows) b
      where a->>'event_id' = b->>'event_id' and a->>'recipient_email' = b->>'recipient_email'
        and a->>'endpoint_hash' = b->>'endpoint_hash'
    ) or first_rows->0->>'claim_id' is not distinct from second_rows->0->>'claim_id' then
      raise exception 'Concurrent sweeps returned overlapping or missing claims (scenario %)',scenario;
    end if;
    if (select count(*) from private.stockflow_push_deliveries where recipient_email = race_email
      and status = 'pending' and attempts = 0 and claimed_at is not null and claim_id is not null) <> 2 then
      raise exception 'Race failed to persist exactly two unattempted claims';
    end if;
  end loop;
  perform public.dblink_disconnect('push_claim_b');
  b_connected := false;
  perform public.dblink_exec('push_claim_a',cleanup_sql);
  perform public.dblink_disconnect('push_claim_a');
  a_connected := false;
exception when others then
  if b_connected then perform public.dblink_disconnect('push_claim_b'); end if;
  if a_connected then
    perform public.dblink_exec('push_claim_a','rollback');
    perform public.dblink_exec('push_claim_a',cleanup_sql);
    perform public.dblink_disconnect('push_claim_a');
  end if;
  raise;
end $race$;

alter table public.stockflow_members drop constraint if exists stockflow_members_roles_pending_union;
update private.stockflow_gateway_config
set secret_sha256 = encode(extensions.digest('push-test-orders-key','sha256'),'hex') where name = 'orders';
delete from private.stockflow_gateway_config where name = 'push';
insert into public.stockflow_members(email,role,status) values
  ('push-admin@test.local','administrator','active'),
  ('push-management@test.local','management','active'),
  ('push-accounts@test.local','accounts','active'),
  ('push-billing@test.local','billing','active'),
  ('push-both@test.local','accounts','active'),
  ('push-warehouse@test.local','warehouse','active'),
  ('push-operations@test.local','operations','active'),
  ('push-sales@test.local','sales','active'),
  ('push-inactive@test.local','billing','active'),
  ('push-viewer@test.local','viewer','active');
update public.stockflow_members set roles = array[role] where email like 'push-%@test.local';
update public.stockflow_members set roles = array['accounts','billing'] where email = 'push-both@test.local';
create temporary table push_test_due on commit drop as select * from private.stockflow_push_due() with no data;
update private.stockflow_pricing_policies set active = false where active;
insert into private.stockflow_pricing_policies(policy_version,minimum_margin_percent,target_margin_percent,
  override_approval_percent,rounding_increment,rounding_rule_version,effective_from,created_by_email)
values('push-alerts-test',25,30,5,1,'push-alerts-rounding',(now() at time zone 'Asia/Kolkata')::date-90,'test');

create function pg_temp.push_test_create(p_customer uuid,p_key text)
returns uuid language plpgsql as $$
declare result jsonb; o uuid;
begin
  result := public.stockflow_order_gateway('push-test-orders-key','push-admin@test.local','create_order',
    jsonb_build_object('customerId',p_customer,'customerName','Push Care Hospital','source','phone',
      'idempotencyKey','push-create-' || p_key,
      'lines',jsonb_build_array(jsonb_build_object('tallyKey','PUSH-ITEM','quantity',3))));
  o := (result->>'orderId')::uuid;
  if o is null or result->>'status' is distinct from 'awaiting_confirmation'
     or (select count(*) from private.stockflow_order_lines where order_id = o) <> 1 then
    raise exception 'Push fixture create failed: %',result;
  end if;
  return o;
end $$;

create function pg_temp.push_test_transition(p_order uuid,p_status text,
  p_actor text default 'push-admin@test.local',p_invoice text default null)
returns bigint language plpgsql as $$
declare result jsonb; event bigint;
begin
  result := public.stockflow_order_gateway('push-test-orders-key',p_actor,'transition_order',
    jsonb_build_object('orderId',p_order,'expectedVersion',(select version from private.stockflow_orders where id = p_order),
      'toStatus',p_status,'tallyInvoiceNumber',p_invoice,'idempotencyKey','push-transition-' || p_order || '-' || p_status));
  if result->>'status' is distinct from p_status
     or (select status from private.stockflow_orders where id = p_order) is distinct from p_status then
    raise exception 'Push fixture transition failed: %',result;
  end if;
  select id into strict event from private.stockflow_order_events
    where order_id = p_order and event_type = 'status_changed' and to_status = p_status;
  return event;
end $$;

create function pg_temp.push_test_recipients(p_event bigint,p_emails text[],p_body text)
returns void language plpgsql as $$
declare actual text[]; expected text[];
begin
  select array_agg(r.recipient_email order by r.recipient_email) into actual
    from private.stockflow_push_recipients(p_event) r where r.recipient_email like 'push-%@test.local';
  select array_agg(email order by email) into expected from unnest(p_emails) email;
  if actual is distinct from expected or exists(select 1 from private.stockflow_push_recipients(p_event) r
    where r.recipient_email like 'push-%@test.local' and r.body is distinct from p_body) then
    raise exception 'Unexpected role handoff for event %: % / %',p_event,actual,expected;
  end if;
end $$;

-- Only the clock is injected; gateways still write every event and its status fields.
create function pg_temp.push_test_event_clock() returns trigger language plpgsql as $$
declare event_time text := nullif(current_setting('stockflow.test_push_event_time',true),'');
begin
  if event_time is not null and new.actor_email like 'push-%@test.local' then
    new.created_at := event_time::timestamptz;
  end if;
  return new;
end $$;
create trigger push_test_event_clock before insert on private.stockflow_order_events
  for each row execute function pg_temp.push_test_event_clock();

do $test$
declare
  customer uuid;
  o uuid;
  age_order uuid;
  event bigint;
  assignment bigint;
  old_event bigint;
  mapped_event bigint;
  number text;
  a text;
  signature text;
  payload jsonb;
  result jsonb;
  sent_result jsonb;
  failed_result jsonb;
  gone_result jsonb;
  old_result jsonb;
  old_claim uuid;
  item record;
  i integer;
  today date := (now() at time zone 'Asia/Kolkata')::date;
  keys constant jsonb := jsonb_build_object('p256dh', 'B' || repeat('A',86), 'auth', repeat('A',22));
begin
  foreach a in array array['push-accounts@test.local','push-billing@test.local','push-both@test.local',
    'push-warehouse@test.local','push-operations@test.local','push-sales@test.local','push-inactive@test.local'] loop
    perform public.stockflow_push_gateway('push-test-orders-key',a,'push_subscribe',
      jsonb_build_object('endpoint','https://push.test/' || a,'keys',keys,'userAgent','Push test'));
  end loop;
  update public.stockflow_members set status = 'suspended' where email = 'push-inactive@test.local';
  begin
    perform public.stockflow_push_gateway('push-test-orders-key','push-inactive@test.local','push_config');
    raise exception 'Inactive member accessed push';
  exception when insufficient_privilege then null; end;
  begin
    perform public.stockflow_push_gateway('wrong','push-accounts@test.local','push_config');
    raise exception 'Wrong gateway key accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.stockflow_push_gateway('push-test-orders-key','push-viewer@test.local','push_subscribe',
      jsonb_build_object('endpoint','http://push.test/bad','keys',keys));
    raise exception 'Insecure endpoint accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.stockflow_push_gateway('push-test-orders-key','push-viewer@test.local','push_subscribe',
      jsonb_build_object('endpoint','https://push.test/bad','keys',jsonb_build_object('auth','bad')));
    raise exception 'Malformed keys accepted';
  exception when invalid_parameter_value then null; end;

  payload := jsonb_build_object('endpoint','https://push.test/shared','keys',keys);
  perform public.stockflow_push_gateway('push-test-orders-key','push-accounts@test.local','push_subscribe',payload);
  update private.stockflow_push_subscriptions set failure_count = 3, last_failure_at = now()
    where endpoint = 'https://push.test/shared';
  perform public.stockflow_push_gateway('push-test-orders-key','push-viewer@test.local','push_subscribe',payload);
  if not exists(select 1 from private.stockflow_push_subscriptions where endpoint = 'https://push.test/shared'
    and member_email = 'push-viewer@test.local' and failure_count = 0 and last_failure_at is null) then
    raise exception 'Shared endpoint ownership or reset failed';
  end if;
  result := public.stockflow_push_gateway('push-test-orders-key','push-accounts@test.local','push_unsubscribe',payload);
  if result is distinct from '{"ok":true,"removed":0}'::jsonb then raise exception 'Deleted another member endpoint'; end if;
  result := public.stockflow_push_gateway('push-test-orders-key','push-viewer@test.local','push_unsubscribe',payload);
  if result is distinct from '{"ok":true,"removed":1}'::jsonb then raise exception 'Own unsubscribe failed'; end if;

  perform public.stockflow_push_gateway('push-test-orders-key','push-viewer@test.local','push_subscribe',payload);
  update private.stockflow_push_subscriptions set created_at = now() - interval '1 day'
    where endpoint = 'https://push.test/shared';
  for i in 1..10 loop
    perform public.stockflow_push_gateway('push-test-orders-key','push-viewer@test.local','push_subscribe',
      jsonb_build_object('endpoint','https://push.test/cap/' || i,'keys',keys));
  end loop;
  if (select count(*) from private.stockflow_push_subscriptions where member_email = 'push-viewer@test.local') <> 10
     or exists(select 1 from private.stockflow_push_subscriptions where endpoint = 'https://push.test/shared') then
    raise exception 'Subscription cap did not discard oldest';
  end if;

  insert into private.stockflow_customers(name,tally_key,created_by_email)
    values('Push Care Hospital','push-care-hospital','test') returning id into customer;
  insert into private.stockflow_products(tally_item_key,name,base_unit) values('PUSH-ITEM','Private reagent','Nos');
  insert into private.stockflow_tally_purchase_costs(tally_item_key,cost_amount,cost_kind,effective_at,source_reference,source_id,source_version)
    values('PUSH-ITEM',3465,'purchase_price',today-20,'push-cost','push-cost','1');
  insert into private.stockflow_tally_sales_prices(customer_id,tally_item_key,invoice_rate,invoice_date,invoice_reference,source_id,source_version)
    values(customer,'PUSH-ITEM',6000,today-10,'PRIVATE-INVOICE','push-sale','1');
  insert into public.stockflow_snapshots(id,company,fetched_at,payload)
    values('suprabha','PUSH TEST',now()::text,jsonb_build_object('catalog',jsonb_build_array(
      jsonb_build_object('tallyKey','PUSH-ITEM','item','Private reagent','baseUnit','Nos','group','Push tests','closing',10,'active',true))))
    on conflict(id) do update set payload = excluded.payload;

  perform set_config('stockflow.test_push_event_time',(now() - interval '2 minutes')::text,true);
  o := pg_temp.push_test_create(customer,'billing-order');
  select order_number into strict number from private.stockflow_orders where id = o;
  select id into strict mapped_event from private.stockflow_order_events where order_id = o and event_type = 'order_created';
  perform pg_temp.push_test_recipients(mapped_event,
    array['push-admin@test.local','push-management@test.local','push-sales@test.local','push-operations@test.local'],'New order to confirm');
  mapped_event := pg_temp.push_test_transition(o,'awaiting_approval');
  if exists(select 1 from private.stockflow_push_recipients(mapped_event)) then raise exception 'Internal confirm change notified again'; end if;
  mapped_event := pg_temp.push_test_transition(o,'confirmed');
  perform pg_temp.push_test_recipients(mapped_event,array['push-warehouse@test.local','push-operations@test.local'],'Ready to pick & pack');
  if not exists(select 1 from private.stockflow_orders ord join private.stockflow_billing_snapshots s
    on s.id = ord.pricing_snapshot_id and s.order_id = ord.id
    where ord.id = o and ord.pricing_state = 'approved' and s.invalidated_at is null) then
    raise exception 'Confirm did not seal current approved pricing';
  end if;
  result := public.stockflow_fulfilment_gateway('push-test-orders-key','push-admin@test.local','save_fulfilment',
    jsonb_build_object('orderId',o,'expectedVersion',(select version from private.stockflow_orders where id = o),
      'idempotencyKey','push-pack-quantities','deliveryAddress','Push test address',
      'lines',jsonb_build_array(jsonb_build_object('tallyKey','PUSH-ITEM','fulfilledQuantity',2))));
  if result->>'ok' is distinct from 'true' then raise exception 'Save fulfilment failed: %',result; end if;
  select id into strict mapped_event from private.stockflow_order_events where order_id = o and event_type = 'fulfilment_updated';
  if exists(select 1 from private.stockflow_push_recipients(mapped_event)) then raise exception 'Internal picking change notified again'; end if;
  mapped_event := pg_temp.push_test_transition(o,'packed');
  perform pg_temp.push_test_recipients(mapped_event,array['push-accounts@test.local','push-both@test.local'],'Packed · ready for Tally billing');
  perform set_config('stockflow.test_push_event_time','',true);
  event := pg_temp.push_test_transition(o,'awaiting_tally_billing','push-both@test.local');

  if exists(select 1 from private.stockflow_push_due()) then raise exception 'Disabled push returned work'; end if;
  if public.stockflow_push_gateway('push-test-orders-key','push-viewer@test.local','push_config')
    is distinct from '{"enabled":false}'::jsonb then raise exception 'Disabled config is wrong'; end if;
  update private.stockflow_push_config set push_enabled = true, push_starts_at = null;
  if exists(select 1 from private.stockflow_push_due()) then raise exception 'Null activation returned work'; end if;
  update private.stockflow_push_config set push_starts_at = now() - interval '1 minute', updated_at = now();
  if public.stockflow_push_gateway('push-test-orders-key','push-viewer@test.local','push_config')
    is distinct from '{"enabled":true}'::jsonb then raise exception 'Enabled config is wrong'; end if;

  update private.stockflow_role_order_scopes set scope = 'created_by' where role = 'billing';
  insert into push_test_due select * from private.stockflow_push_due();
  if exists(select 1 from push_test_due d where d.event_id = event and d.recipient_email = 'push-billing@test.local')
     or (select count(*) from push_test_due where event_id = event) <> 2 then
    raise exception 'Push bypassed order access or lost accessible recipients';
  end if;
  update private.stockflow_role_order_scopes set scope = 'global' where role = 'billing';
  update private.stockflow_push_deliveries set claimed_at = now() - interval '3 minutes' where event_id = event;
  truncate push_test_due;
  insert into push_test_due select * from private.stockflow_push_due();
  foreach a in array array['push-accounts@test.local','push-billing@test.local','push-both@test.local'] loop
    if (select count(*) from push_test_due d where d.event_id = event and d.recipient_email = a) <> 1 then
      raise exception 'Expected one billing push for %, including the actor with both roles', a;
    end if;
  end loop;
  if exists(select 1 from push_test_due d where d.event_id = event
    and d.recipient_email in ('push-warehouse@test.local','push-inactive@test.local','push-sales@test.local','push-operations@test.local')) then
    raise exception 'Ineligible member got billing push';
  end if;
  for item in select * from push_test_due d where d.event_id = event loop
    if item.title is distinct from 'Push Care Hospital · ' || number
       or item.body is distinct from (case when item.recipient_email = 'push-billing@test.local'
         then 'Packed and priced · ready to bill' else 'Packed · ready for Tally billing' end) then
      raise exception 'Wrong push title/body: %', item;
    end if;
    if (replace(item.title, number, '') || item.body) ~ '[0-9₹]'
       or (replace(item.title, number, '') || item.body) ~* '(3465|6000|12000|Private reagent|PRIVATE-INVOICE|gross|profit|margin)' then
      raise exception 'Push leaked financial or item detail';
    end if;
  end loop;

  if exists(select 1 from private.stockflow_push_due()) then raise exception 'Fresh claims were returned twice'; end if;
  if (select count(distinct claim_id) from push_test_due) <> 1
     or exists(select 1 from push_test_due where claim_id is null)
     or exists(select 1 from private.stockflow_push_deliveries where event_id = event and attempts <> 0) then
    raise exception 'Claim batch identity or initial attempts wrong';
  end if;
  select claim_id into old_claim from push_test_due limit 1;
  select jsonb_agg(jsonb_build_object('eventId',d.event_id,'recipientEmail',d.recipient_email,
    'endpointHash',d.endpoint_hash,'claimId',d.claim_id,'outcome','gone')) into old_result from push_test_due d;
  update private.stockflow_push_deliveries set claimed_at = now() - interval '3 minutes' where event_id = event;
  truncate push_test_due;
  insert into push_test_due select * from private.stockflow_push_due();
  if (select count(*) from push_test_due) <> 3 or exists(select 1 from push_test_due where claim_id = old_claim) then
    raise exception 'Stale claim not replaced with a new batch';
  end if;
  perform private.stockflow_push_record(old_result);
  if exists(select 1 from private.stockflow_push_deliveries where event_id = event and (attempts <> 0 or status <> 'pending'))
     or (select count(*) from private.stockflow_push_subscriptions
       where member_email in ('push-accounts@test.local','push-billing@test.local','push-both@test.local')) <> 3 then
    raise exception 'Superseded claim changed delivery or removed subscription';
  end if;
  old_event := mapped_event;
  if not exists(select 1 from private.stockflow_order_events where id = old_event
    and created_at < (select push_starts_at from private.stockflow_push_config where id))
     or not exists(select 1 from private.stockflow_push_recipients(old_event)) then
    raise exception 'Pre-activation fixture must have an eligible real handoff before activation';
  end if;
  if exists(select 1 from private.stockflow_push_due() d where d.event_id = old_event) then
    raise exception 'Pre-activation event was due';
  end if;
  update private.stockflow_push_config set push_starts_at = now() - interval '2 days';
  perform set_config('stockflow.test_push_event_time',(now() - interval '25 hours')::text,true);
  age_order := pg_temp.push_test_create(customer,'expired-order');
  perform set_config('stockflow.test_push_event_time','',true);
  select id into strict old_event from private.stockflow_order_events where order_id = age_order and event_type = 'order_created';
  if not exists(select 1 from private.stockflow_order_events where id = old_event
    and created_at >= (select push_starts_at from private.stockflow_push_config where id)
    and created_at < now() - interval '24 hours')
     or not exists(select 1 from private.stockflow_push_recipients(old_event)) then
    raise exception 'Age fixture must be eligible and after activation but older than twenty-four hours';
  end if;
  if exists(select 1 from private.stockflow_push_due() d where d.event_id = old_event) then
    raise exception 'Expired event was due';
  end if;
  update private.stockflow_push_config set push_starts_at = now() - interval '1 minute';

  select jsonb_build_array(jsonb_build_object('eventId',event,'recipientEmail',d.recipient_email,'endpointHash',d.endpoint_hash,'claimId',d.claim_id,'outcome','sent'))
    into sent_result from push_test_due d where d.event_id = event and d.recipient_email = 'push-accounts@test.local';
  perform private.stockflow_push_record(sent_result);
  perform private.stockflow_push_record(sent_result);
  if exists(select 1 from private.stockflow_push_due() d where d.event_id = event and d.recipient_email = 'push-accounts@test.local')
     or not exists(select 1 from private.stockflow_push_deliveries where event_id = event
       and recipient_email = 'push-accounts@test.local' and status = 'sent' and attempts = 1 and sent_at is not null)
     or not exists(select 1 from private.stockflow_push_subscriptions where member_email = 'push-accounts@test.local' and last_success_at is not null) then
    raise exception 'Sent recording or replay failed';
  end if;
  select jsonb_build_array(jsonb_build_object('eventId',event,'recipientEmail',d.recipient_email,'endpointHash',d.endpoint_hash,'claimId',d.claim_id,'outcome','gone'))
    into gone_result from push_test_due d where d.event_id = event and d.recipient_email = 'push-billing@test.local';
  perform private.stockflow_push_record(gone_result);
  perform private.stockflow_push_record(gone_result);
  if exists(select 1 from private.stockflow_push_subscriptions where member_email = 'push-billing@test.local') then
    raise exception 'Gone subscription not removed';
  end if;
  for i in 1..5 loop
    select jsonb_build_array(jsonb_build_object('eventId',event,'recipientEmail',d.recipient_email,'endpointHash',d.endpoint_hash,
      'claimId',d.claim_id,'outcome','failed','error',repeat('x',400)))
      into failed_result from push_test_due d where d.event_id = event and d.recipient_email = 'push-both@test.local';
    if failed_result is null then raise exception 'Missing retry claim'; end if;
    perform private.stockflow_push_record(failed_result);
    perform private.stockflow_push_record(failed_result);
    if not exists(select 1 from private.stockflow_push_deliveries where event_id = event
      and recipient_email = 'push-both@test.local' and attempts = i and status = 'failed')
       or not exists(select 1 from private.stockflow_push_subscriptions
         where member_email = 'push-both@test.local' and failure_count = i) then
      raise exception 'Replayed failure inflated attempts or subscription failures';
    end if;
    if i < 5 then
      truncate push_test_due;
      insert into push_test_due select * from private.stockflow_push_due();
      if (select count(*) from push_test_due where event_id = event and recipient_email = 'push-both@test.local') <> 1 then
        raise exception 'Retry disappeared before limit';
      end if;
      perform private.stockflow_push_record(failed_result);
      if not exists(select 1 from private.stockflow_push_deliveries where event_id = event
        and recipient_email = 'push-both@test.local' and attempts = i and status = 'pending'
        and claim_id <> (failed_result->0->>'claimId')::uuid) then
        raise exception 'Old failure consumed a newer pending claim';
      end if;
    end if;
  end loop;
  perform private.stockflow_push_record(failed_result);
  if exists(select 1 from private.stockflow_push_due() d where d.event_id = event and d.recipient_email = 'push-both@test.local')
     or not exists(select 1 from private.stockflow_push_deliveries where event_id = event
       and recipient_email = 'push-both@test.local' and attempts = 5 and char_length(last_error) = 300)
     or not exists(select 1 from private.stockflow_push_subscriptions where member_email = 'push-both@test.local'
       and failure_count = 5 and last_failure_at is not null) then
    raise exception 'Failure limit or diagnostics wrong';
  end if;

  result := public.stockflow_assignment_gateway('push-test-orders-key','push-admin@test.local','set_order_assignee',
    jsonb_build_object('orderId',o,'expectedVersion',(select version from private.stockflow_orders where id = o),
      'assignedToEmail','push-warehouse@test.local','idempotencyKey','push-alerts-assignment-0001'));
  select id into strict assignment from private.stockflow_order_events where order_id = o and event_type = 'order_assignment_changed';
  if (select count(*) from private.stockflow_push_recipients(assignment)) <> 1
     or not exists(select 1 from private.stockflow_push_due() d where d.event_id = assignment
       and d.recipient_email = 'push-warehouse@test.local' and d.body = 'Assigned to you') then
    raise exception 'Assignment did not notify the new assignee once';
  end if;

  mapped_event := pg_temp.push_test_transition(o,'billed_in_tally','push-billing@test.local','SD/PUSH/BILLED');
  perform pg_temp.push_test_recipients(mapped_event,array['push-operations@test.local'],'Billed · ready for dispatch');
  mapped_event := pg_temp.push_test_transition(o,'ready_for_dispatch');
  if exists(select 1 from private.stockflow_push_recipients(mapped_event)) then raise exception 'Internal dispatch change notified again'; end if;

  foreach signature in array array[
    'public.stockflow_push_gateway(text,text,text,jsonb)', 'private.stockflow_push_recipients(bigint)',
    'private.stockflow_push_due(integer)', 'private.stockflow_push_record(jsonb)', 'public.stockflow_push_sweep(text,text,jsonb)'
  ] loop
    if has_function_privilege('anon',signature,'execute') or has_function_privilege('authenticated',signature,'execute')
       or not has_function_privilege('service_role',signature,'execute') then raise exception 'Wrong grants on %', signature; end if;
  end loop;
  foreach a in array array['stockflow_push_subscriptions','stockflow_push_deliveries','stockflow_push_config'] loop
    if has_table_privilege('anon','private.' || a,'select,insert,update,delete')
       or has_table_privilege('authenticated','private.' || a,'select,insert,update,delete')
       or not (select relrowsecurity from pg_class where oid = ('private.' || a)::regclass) then
      raise exception 'Push table exposed: %', a;
    end if;
  end loop;
  begin
    perform public.stockflow_push_sweep('push-test-sweep-key','due','{}');
    raise exception 'Sweep accepted missing secret row';
  exception when insufficient_privilege then null; end;
  insert into private.stockflow_gateway_config(name,secret_sha256)
    values('push',encode(extensions.digest('push-test-sweep-key','sha256'),'hex'));
  begin
    perform public.stockflow_push_sweep('wrong','due','{}');
    raise exception 'Sweep accepted wrong secret';
  exception when insufficient_privilege then null; end;
  result := public.stockflow_push_sweep('push-test-sweep-key','due','{"limit":1}');
  if jsonb_array_length(result->'rows') <> 1 or result->'rows'->0->>'claim_id' is null then
    raise exception 'Sweep due envelope/limit/claim wrong';
  end if;
  result := public.stockflow_push_sweep('push-test-sweep-key','record',jsonb_build_object('results',sent_result));
  if result is distinct from '{"ok":true}'::jsonb then raise exception 'Sweep record failed'; end if;
end $test$;
rollback;
