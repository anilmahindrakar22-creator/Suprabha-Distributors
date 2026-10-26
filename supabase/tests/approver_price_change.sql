begin;
alter table public.stockflow_members drop constraint if exists stockflow_members_roles_pending_union;
update private.stockflow_gateway_config
set secret_sha256=encode(extensions.digest('price-change-test-key','sha256'),'hex') where name='orders';
update private.stockflow_pricing_policies set active=false where active;
insert into private.stockflow_pricing_policies(policy_version,minimum_margin_percent,target_margin_percent,
  override_approval_percent,rounding_increment,rounding_rule_version,effective_from,created_by_email)
values('price-change-test',25,30,5,1,'price-change-rounding',current_date-30,'test');
insert into public.stockflow_members(email,role,status) values
 ('admin@pricechange.test.local','administrator','active'),
 ('management@pricechange.test.local','management','active'),
 ('accounts@pricechange.test.local','accounts','active'),
 ('sales@pricechange.test.local','sales','active'),
 ('requester@pricechange.test.local','accounts','active');
update public.stockflow_members set roles=array[role] where email like '%@pricechange.test.local';

create temporary table price_change_fixtures(
  name text primary key, order_id uuid, line_id uuid, exception_id uuid, decision_id uuid,
  previous_snapshot uuid
) on commit drop;

do $fixtures$
declare
  customer uuid; o uuid; line uuid; scenario text; item_key text; requester text;
  resolved jsonb; response jsonb;
begin
  insert into private.stockflow_customers(name,tally_key,created_by_email)
  values('Price change customer','price-change-customer','test') returning id into customer;
  foreach scenario in array array['management','low','admin','denied','approve','reject','null_cost','rounding','self','combined','overflow'] loop
    item_key := 'PRICE-CHANGE-' || upper(scenario);
    requester := case when scenario='self' then 'management@pricechange.test.local' else 'requester@pricechange.test.local' end;
    insert into private.stockflow_products(tally_item_key,name,base_unit) values(item_key,item_key,'Nos');
    if scenario <> 'null_cost' then
      insert into private.stockflow_tally_purchase_costs(tally_item_key,cost_amount,cost_kind,effective_at,source_reference,source_id,source_version)
      values(item_key,case when scenario='overflow' then 3465 else 4000 end,'purchase_price',current_date-20,item_key||'-cost',item_key||'-cost','1');
    end if;
    insert into private.stockflow_tally_sales_prices(customer_id,tally_item_key,invoice_rate,invoice_date,invoice_reference,source_id,source_version)
    values(customer,item_key,6000,current_date-10,item_key||'-sale',item_key||'-sale','1');
    insert into private.stockflow_orders(customer_id,customer_name,source,status,idempotency_key,created_by_email,updated_by_email)
    values(customer,'Price change customer','phone','packed','price-change-order-'||scenario,requester,requester) returning id into o;
    insert into private.stockflow_order_lines(order_id,tally_item_key,item_name,quantity)
    values(o,item_key,item_key,1) returning id into line;
    resolved := private.stockflow_resolve_pricing_line(line,current_date);
    response := public.stockflow_pricing_gateway('price-change-test-key',requester,'submit_order_pricing',
      jsonb_build_object('orderId',o,'expectedVersion',(select version from private.stockflow_orders where id=o),
        'pricingDate',current_date,'idempotencyKey','price-change-submit-'||scenario,
        'lines',jsonb_build_array(jsonb_build_object('lineId',line,'enteredRate',4200,
          'reason','Requested discounted rate','evidenceHash',resolved->>'evidenceHash'))));
    if response->>'pricingState' is distinct from 'approval_required' then
      raise exception 'Fixture did not create a pending exception: % %',scenario,response;
    end if;
    insert into price_change_fixtures
    select scenario,o,line,e.id,e.decision_id,ord.pricing_snapshot_id
    from private.stockflow_price_exceptions e join private.stockflow_orders ord on ord.id=e.order_id
    where e.order_id=o and e.state='pending';
    if not found then raise exception 'Missing pending fixture: %',scenario; end if;
  end loop;
end $fixtures$;

create function pg_temp.expect_price_change_error(
  p_actor text, p_payload jsonb, p_state text, p_message text, p_key text default 'price-change-test-key'
) returns void language plpgsql as $$
declare
  before_exception jsonb; before_decision jsonb; before_order jsonb;
  ex private.stockflow_price_exceptions%rowtype;
  event_count bigint; command_count bigint; snapshot_count bigint; outbox_count bigint;
  actual_state text; actual_message text; failed boolean := false;
begin
  select * into strict ex from private.stockflow_price_exceptions where id=(p_payload->>'exceptionId')::uuid;
  before_exception := to_jsonb(ex);
  select to_jsonb(d) into before_decision from private.stockflow_order_pricing_decisions d where id=ex.decision_id;
  select to_jsonb(o) into before_order from private.stockflow_orders o where id=ex.order_id;
  select count(*) into event_count from private.stockflow_pricing_events;
  select count(*) into command_count from private.stockflow_command_results;
  select count(*) into snapshot_count from private.stockflow_billing_snapshots;
  select count(*) into outbox_count from private.stockflow_outbox;
  begin
    perform public.stockflow_pricing_gateway(p_key,p_actor,'approve_price_exception',p_payload);
  exception when others then
    get stacked diagnostics actual_state=returned_sqlstate, actual_message=message_text;
    if actual_state is distinct from p_state or actual_message is distinct from p_message then
      raise exception 'Expected % / %, got % / %',p_state,p_message,actual_state,actual_message;
    end if;
    failed := true;
  end;
  if not failed then raise exception 'Expected denial: %',p_message; end if;
  if before_exception is distinct from (select to_jsonb(e) from private.stockflow_price_exceptions e where id=ex.id)
     or before_decision is distinct from (select to_jsonb(d) from private.stockflow_order_pricing_decisions d where id=ex.decision_id)
     or before_order is distinct from (select to_jsonb(o) from private.stockflow_orders o where id=ex.order_id)
     or event_count <> (select count(*) from private.stockflow_pricing_events)
     or command_count <> (select count(*) from private.stockflow_command_results)
     or snapshot_count <> (select count(*) from private.stockflow_billing_snapshots)
     or outbox_count <> (select count(*) from private.stockflow_outbox) then
    raise exception 'Denied change left partial state: %',p_message;
  end if;
end $$;

do $approvals$
declare
  f record; actor text; rate numeric; expected_rate numeric; payload jsonb; result jsonb; replay jsonb;
  d private.stockflow_order_pricing_decisions%rowtype; e private.stockflow_price_exceptions%rowtype;
  event private.stockflow_pricing_events%rowtype; snapshot uuid; line jsonb; before_order jsonb;
  event_count bigint; command_count bigint; snapshot_count bigint;
  previous_margin numeric; previous_guardrail text;
begin
  for f in select * from price_change_fixtures where name in ('management','low','admin','null_cost','rounding','self','combined') order by name loop
    actor := case when f.name='admin' then 'admin@pricechange.test.local' else 'management@pricechange.test.local' end;
    rate := case when f.name='low' then 4001 when f.name='rounding' then 4510.126 else 4510 end;
    expected_rate := round(rate,2);
    if f.name='combined' then
      update public.stockflow_members set role='accounts',roles=array['accounts','management'] where email=actor;
    end if;
    payload := jsonb_build_object('exceptionId',f.exception_id,'expectedVersion',1,'changedRate',rate,
      'reason','  Owner approved negotiated rate  ','idempotencyKey','price-change-approve-'||f.name);
    select previous_gross_margin_percent,guardrail_state into previous_margin,previous_guardrail
    from private.stockflow_order_pricing_decisions where id=f.decision_id;
    result := public.stockflow_pricing_gateway('price-change-test-key',actor,'approve_price_exception',payload);
    if result->>'ok' is distinct from 'true' or result->>'decision' is distinct from 'approved' then
      raise exception 'Change approval failed: %',result;
    end if;
    select * into strict e from private.stockflow_price_exceptions where id=f.exception_id;
    select * into strict d from private.stockflow_order_pricing_decisions where id=f.decision_id;
    if e.state <> 'approved' or e.version <> 2 or e.entered_rate <> 4200 or e.decided_by_email <> actor
       or e.decision_reason not like 'Price changed from %' or d.approved_rate is distinct from expected_rate
       or d.state <> 'approved' or d.proposed_rate is distinct from 6000::numeric then
      raise exception 'Decision or exception mismatch: %',f.name;
    end if;
    if (case when f.name='null_cost' then d.cost_amount is not null or d.gross_profit_amount is not null or d.gross_margin_percent is not null
        else d.cost_amount is distinct from 4000::numeric
          or d.gross_profit_amount is distinct from expected_rate-4000
          or d.gross_margin_percent is distinct from round((expected_rate-4000)/expected_rate*100,4) end) then
      raise exception 'Incorrect changed-price margins: %',f.name;
    end if;
    if d.previous_gross_margin_percent is distinct from previous_margin
       or d.guardrail_state is distinct from previous_guardrail
       or d.margin_erosion_points is distinct from
         (case when d.cost_amount is null or previous_margin is null then null
           else round((expected_rate-d.cost_amount)/expected_rate*100,2)-previous_margin end)
       or (f.name='management' and previous_margin is null) then
      raise exception 'Incorrect erosion or changed historical margin/guardrail: %',f.name;
    end if;
    if f.name='low' and not (d.gross_margin_percent < 25 and d.approved_rate < d.proposed_rate) then
      raise exception 'Low-margin fixture did not override pricing rules';
    end if;
    select pricing_snapshot_id into snapshot from private.stockflow_orders where id=f.order_id and pricing_state='approved';
    if snapshot is null or snapshot is not distinct from f.previous_snapshot then raise exception 'Missing new approved snapshot'; end if;
    select entry into line from private.stockflow_billing_snapshots s cross join lateral jsonb_array_elements(s.pricing_payload) entry
    where s.id=snapshot and s.order_id=f.order_id and s.invalidated_at is null and entry->>'order_line_id'=f.line_id::text;
    if line is null or line->>'state' is distinct from 'approved' or (line->>'approved_rate')::numeric is distinct from expected_rate
       or (line->>'gross_profit_amount')::numeric is distinct from d.gross_profit_amount
       or (line->>'gross_margin_percent')::numeric is distinct from d.gross_margin_percent then
      raise exception 'Billing snapshot did not use changed decision: %',f.name;
    end if;
    if (select count(*) from private.stockflow_pricing_events where entity_id=f.exception_id and event_type='price_exception_rate_changed') <> 1 then
      raise exception 'Expected exactly one rate-change event';
    end if;
    select * into strict event from private.stockflow_pricing_events where entity_id=f.exception_id and event_type='price_exception_rate_changed';
    if event.entity_type <> 'price_exception' or event.actor_email <> actor
       or event.actor_role is distinct from (select role from public.stockflow_members where email=actor)
       or event.request_id <> payload->>'idempotencyKey'
       or event.metadata is distinct from jsonb_build_object('orderId',f.order_id,'fromRate',4200,'toRate',expected_rate,'reason','Owner approved negotiated rate') then
      raise exception 'Incorrect price-change audit: %',event;
    end if;
    select to_jsonb(o) into before_order from private.stockflow_orders o where id=f.order_id;
    select count(*) into event_count from private.stockflow_pricing_events;
    select count(*) into command_count from private.stockflow_command_results;
    select count(*) into snapshot_count from private.stockflow_billing_snapshots;
    replay := public.stockflow_pricing_gateway('price-change-test-key',actor,'approve_price_exception',payload);
    if replay is distinct from result
       or to_jsonb(e) is distinct from (select to_jsonb(current_ex) from private.stockflow_price_exceptions current_ex where id=f.exception_id)
       or to_jsonb(d) is distinct from (select to_jsonb(current_d) from private.stockflow_order_pricing_decisions current_d where id=f.decision_id)
       or before_order is distinct from (select to_jsonb(o) from private.stockflow_orders o where id=f.order_id)
       or event_count <> (select count(*) from private.stockflow_pricing_events)
       or command_count <> (select count(*) from private.stockflow_command_results)
       or snapshot_count <> (select count(*) from private.stockflow_billing_snapshots) then
      raise exception 'Replay mutated state or did not return stored success: %',f.name;
    end if;
    perform pg_temp.expect_price_change_error(actor,payload||jsonb_build_object('changedRate',4511),
      '22023','Idempotency key was already used for a different request');
    perform pg_temp.expect_price_change_error(actor,payload||jsonb_build_object('reason','Different approval reason'),
      '22023','Idempotency key was already used for a different request');
    if f.name='combined' then
      update public.stockflow_members set role='management',roles=array['management'] where email=actor;
    end if;
  end loop;
end $approvals$;

do $denials$
declare payload jsonb; invalid jsonb; actor text; ex uuid;
begin
  select exception_id into ex from price_change_fixtures where name='denied';
  payload := jsonb_build_object('exceptionId',ex,'expectedVersion',1,'changedRate',4510,
    'reason','Negotiated approval','idempotencyKey','price-change-denied-command');
  foreach actor in array array['accounts@pricechange.test.local','sales@pricechange.test.local'] loop
    perform pg_temp.expect_price_change_error(actor,payload,'42501','Only administrators and management can change a price');
  end loop;
  perform pg_temp.expect_price_change_error('management@pricechange.test.local',payload,'42501','Unauthorized gateway','wrong-key');
  perform pg_temp.expect_price_change_error('management@pricechange.test.local',payload-'reason','22023','A reason is required to change a price');
  for invalid in select value from jsonb_array_elements('[null,"","  ","ab"]'::jsonb) loop
    perform pg_temp.expect_price_change_error('management@pricechange.test.local',payload||jsonb_build_object('reason',invalid),
      '22023','A reason is required to change a price');
  end loop;
  perform pg_temp.expect_price_change_error('management@pricechange.test.local',payload||jsonb_build_object('reason',repeat('x',1001)),
    '22023','A reason is required to change a price');
  for invalid in select value from jsonb_array_elements('[0,-1,"abc",null,0.001,100000000,"NaN","Infinity"]'::jsonb) loop
    perform pg_temp.expect_price_change_error('management@pricechange.test.local',payload||jsonb_build_object('changedRate',invalid),
      '22023','Enter a valid price');
  end loop;
  perform pg_temp.expect_price_change_error('management@pricechange.test.local',payload||jsonb_build_object('expectedVersion',0),
    'PT409','Pricing exception has changed; refresh before trying again');
  -- A delegated command failure must roll back the rate update and its audit event.
  perform pg_temp.expect_price_change_error('management@pricechange.test.local',payload||jsonb_build_object('idempotencyKey','price-change-approve-management'),
    '22023','Idempotency key was already used for a different request');
  update public.stockflow_members set status='suspended' where email='management@pricechange.test.local';
  perform pg_temp.expect_price_change_error('management@pricechange.test.local',payload,'42501','Only administrators and management can change a price');
  update public.stockflow_members set status='active' where email='management@pricechange.test.local';
  select exception_id into ex from price_change_fixtures where name='overflow';
  if not exists(select 1 from private.stockflow_order_pricing_decisions d
    join price_change_fixtures f on f.decision_id=d.id where f.name='overflow' and d.cost_amount=3465) then
    raise exception 'Overflow fixture must have cost 3465';
  end if;
  perform pg_temp.expect_price_change_error('management@pricechange.test.local',
    payload||jsonb_build_object('exceptionId',ex,'changedRate',1,'idempotencyKey','price-change-overflow-command'),
    '22023','Price is too far below cost to record; check the amount');
end $denials$;

do $unchanged$
declare f record; result jsonb; action text; expected_state text;
begin
  for f in select * from price_change_fixtures where name in ('approve','reject') loop
    action := case when f.name='approve' then 'approve_price_exception' else 'reject_price_exception' end;
    expected_state := case when f.name='approve' then 'approved' else 'rejected' end;
    result := public.stockflow_pricing_gateway('price-change-test-key','management@pricechange.test.local',action,
      jsonb_build_object('exceptionId',f.exception_id,'expectedVersion',1,'reason','Original approval flow','idempotencyKey','price-change-legacy-'||f.name));
    if result->>'ok' is distinct from 'true' or result->>'decision' is distinct from expected_state
       or not exists(select 1 from private.stockflow_price_exceptions where id=f.exception_id and state=expected_state and decision_reason='Original approval flow')
       or not exists(select 1 from private.stockflow_order_pricing_decisions where id=f.decision_id and approved_rate=4200 and state=expected_state)
       or exists(select 1 from private.stockflow_pricing_events where entity_id=f.exception_id and event_type='price_exception_rate_changed') then
      raise exception 'Original approve/reject behavior changed: %',f.name;
    end if;
    if (select pricing_state from private.stockflow_orders where id=f.order_id) is distinct from
       (case when f.name='approve' then 'approved' else 'review_required' end) then
      raise exception 'Original order pricing state changed: %',f.name;
    end if;
  end loop;
end $unchanged$;

do $privileges$
declare signature text; client text;
begin
  foreach signature in array array['public.stockflow_pricing_gateway(text,text,text,jsonb)',
    'public.stockflow_pricing_gateway_before_price_change(text,text,text,jsonb)'] loop
    foreach client in array array['anon','authenticated'] loop
      if has_function_privilege(client,signature,'EXECUTE') then raise exception 'Client execute exposed: % %',client,signature; end if;
    end loop;
    if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where p.oid=signature::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE') then
      raise exception 'Public execute exposed: %',signature;
    end if;
  end loop;
  if not has_function_privilege('service_role','public.stockflow_pricing_gateway(text,text,text,jsonb)','EXECUTE') then
    raise exception 'Service role lost gateway execution';
  end if;
end $privileges$;
rollback;
