begin;
set local timezone = 'Pacific/Pago_Pago';

update private.stockflow_gateway_config
set secret_sha256=encode(extensions.digest('ist-attention-test-key','sha256'),'hex')
where name='orders';
insert into public.stockflow_members(email,role,status)
values('ist-attention@test.local','operations','active');
update public.stockflow_members set roles=array['operations'] where email='ist-attention@test.local';

do $test$
declare
  signature text;
  definition text;
  india_today date := (now() at time zone 'Asia/Kolkata')::date;
  customer_id uuid;
  order_id uuid;
  overdue_id uuid;
  today_id uuid;
  day_offset integer;
  baseline jsonb;
  result jsonb;
  summary jsonb;
begin
  foreach signature in array array[
    'private.stockflow_order_matches_filter(private.stockflow_orders,text,text,date)',
    'private.stockflow_operations_summary(text,text)',
    'private.stockflow_operations_summary(text,text[])',
    'public.stockflow_delivery_gateway(text,text,text,jsonb)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    if position('Asia/Kolkata' in definition)=0 or position('current_date' in lower(definition))>0 then
      raise exception 'Expected India date without current_date: %',signature;
    end if;
  end loop;
  foreach signature in array array[
    'public.stockflow_order_list_gateway(text,text,text,jsonb)',
    'public.stockflow_order_summary_gateway(text,text,text,jsonb)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    if position('current_date' in lower(definition))>0
       or position('private.stockflow_operations_summary(v_email,v_roles)' in definition)=0 then
      raise exception 'Expected gateway to delegate to India-date summary: %',signature;
    end if;
  end loop;
  -- These dates coincide for part of the day; definition checks cover that window.
  if current_setting('TimeZone')<>'Pacific/Pago_Pago' or current_date>india_today then
    raise exception 'Unexpected attention test timezone';
  end if;

  baseline := public.stockflow_order_summary_gateway('ist-attention-test-key','ist-attention@test.local',
    'get_order_summary','{}')->'operations';
  insert into private.stockflow_customers(name,created_by_email)
  values('IST Attention Laboratory','ist-attention@test.local') returning id into customer_id;
  for day_offset in -1..1 loop
    insert into private.stockflow_orders(
      customer_id,customer_name,source,status,idempotency_key,created_by_email,updated_by_email,
      expected_delivery_date,courier_name,tracking_number,dispatch_date
    ) values(
      customer_id,'IST Attention Laboratory','phone','ready_for_dispatch',
      'ist-attention-fixture-'||day_offset,'ist-attention@test.local','ist-attention@test.local',
      india_today+day_offset,'Local delivery','Hand delivery',india_today
    ) returning id into order_id;
    if day_offset=-1 then overdue_id := order_id; end if;
    if day_offset=0 then today_id := order_id; end if;

    result := public.stockflow_order_summary_gateway('ist-attention-test-key','ist-attention@test.local',
      'get_order_summary','{}');
    summary := result->'operations';
    if (summary->>'deliveryAttention')::bigint is distinct from
         (baseline->>'deliveryAttention')::bigint+least(day_offset+2,2)
       or (summary->>'delayedFailedDeliveries')::bigint is distinct from
         (baseline->>'delayedFailedDeliveries')::bigint+1
       or (summary->>'needsAttention')::bigint is distinct from
         (baseline->>'needsAttention')::bigint+1 then
      raise exception 'Wrong India-date attention counts at offset %: % (baseline %)',day_offset,summary,baseline;
    end if;
    if summary is distinct from private.stockflow_operations_summary('ist-attention@test.local','operations'::text)
       or summary is distinct from private.stockflow_operations_summary('ist-attention@test.local',array['operations']::text[]) then
      raise exception 'Summary overloads disagree on India-date attention';
    end if;
  end loop;

  result := public.stockflow_order_list_gateway('ist-attention-test-key','ist-attention@test.local','list_orders',
    '{"status":"overdue","query":"customer:IST Attention Laboratory"}');
  if result->'pagination'->>'total' is distinct from '1'
     or jsonb_array_length(result->'orders') is distinct from 1
     or result->'orders'->0->>'id' is distinct from overdue_id::text
     or result->'operations' is distinct from summary then
    raise exception 'Overdue list must contain yesterday only and use the same summary: %',result;
  end if;

  result := public.stockflow_order_list_gateway('ist-attention-test-key','ist-attention@test.local','list_orders',
    '{"status":"delivery_due_today","query":"customer:IST Attention Laboratory"}');
  if result->'pagination'->>'total' is distinct from '1'
     or jsonb_array_length(result->'orders') is distinct from 1
     or result->'orders'->0->>'id' is distinct from today_id::text then
    raise exception 'Due-today list must contain India today only: %',result;
  end if;

  result := public.stockflow_order_list_gateway('ist-attention-test-key','ist-attention@test.local','list_orders',
    '{"status":"delivery_attention","query":"customer:IST Attention Laboratory"}');
  if result->'pagination'->>'total' is distinct from '2'
     or jsonb_array_length(result->'orders') is distinct from 2
     or not exists(select 1 from jsonb_array_elements(result->'orders') o where o->>'id'=overdue_id::text)
     or not exists(select 1 from jsonb_array_elements(result->'orders') o where o->>'id'=today_id::text) then
    raise exception 'Delivery attention must contain yesterday and India today only: %',result;
  end if;
end $test$;
rollback;
