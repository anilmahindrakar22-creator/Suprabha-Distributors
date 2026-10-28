-- Run against a migrated non-production database. This test is self-contained and rolls back.
begin;

update private.stockflow_gateway_config
set secret_sha256=encode(extensions.digest('stockflow-order-number-test','sha256'),'hex')
where name='orders';

insert into public.stockflow_members(email,role,status,updated_at)
values('order-number-test@stockflow.local','administrator','active',now())
on conflict(email) do update set role='administrator',status='active',updated_at=now();

insert into public.stockflow_snapshots(id,company,fetched_at,payload)
values(
  'suprabha','SUPRABHA TEST',now()::text,
  jsonb_build_object('company','SUPRABHA TEST','fetchedAt',now()::text,'catalog',jsonb_build_array(jsonb_build_object(
    'tallyKey','ORDER-NUMBER-ITEM','item','Order Number Test Reagent','group','Integration tests','baseUnit','Nos','closing',10,'active',true
  )))
)
on conflict(id) do update set company=excluded.company, fetched_at=excluded.fetched_at, payload=excluded.payload, updated_at=now();

do $test$
declare
  v_year text := private.stockflow_financial_year(now());
  v_before integer;
  v_first jsonb;
  v_second jsonb;
  v_replay jsonb;
  v_stored text;
begin
  -- Financial year boundaries in IST.
  if private.stockflow_financial_year('2027-03-31 18:29:59+00') <> '26-27' then raise exception '31 Mar 11:59 pm IST belongs to 26-27'; end if;
  if private.stockflow_financial_year('2027-03-31 18:30:00+00') <> '27-28' then raise exception '1 Apr 12:00 am IST starts 27-28'; end if;
  if private.stockflow_financial_year('2026-01-15 06:00:00+00') <> '25-26' then raise exception 'January belongs to the previous financial year'; end if;
  if private.stockflow_financial_year('2099-06-01 06:00:00+00') <> '99-00' then raise exception 'Century rollover'; end if;

  select coalesce(max(last_value),0) into v_before from private.stockflow_order_number_counters where financial_year=v_year;

  v_first := public.stockflow_order_gateway('stockflow-order-number-test','order-number-test@stockflow.local','create_order',
    jsonb_build_object('idempotencyKey','order-number-0001','customerName','Order Number Laboratory','source','phone',
      'lines',jsonb_build_array(jsonb_build_object('tallyKey','ORDER-NUMBER-ITEM','quantity',1))));
  v_second := public.stockflow_order_gateway('stockflow-order-number-test','order-number-test@stockflow.local','create_order',
    jsonb_build_object('idempotencyKey','order-number-0002','customerName','Order Number Laboratory','source','phone',
      'lines',jsonb_build_array(jsonb_build_object('tallyKey','ORDER-NUMBER-ITEM','quantity',1))));

  if v_first->>'orderNumber' <> 'SO/' || v_year || '/' || lpad((v_before+1)::text,4,'0') then
    raise exception 'Unexpected first order number %', v_first->>'orderNumber';
  end if;
  if v_second->>'orderNumber' <> 'SO/' || v_year || '/' || lpad((v_before+2)::text,4,'0') then
    raise exception 'Unexpected second order number %', v_second->>'orderNumber';
  end if;
  select order_number into v_stored from private.stockflow_orders where id=(v_first->>'orderId')::uuid;
  if v_stored is distinct from v_first->>'orderNumber' then raise exception 'Stored order number differs from response'; end if;

  -- An idempotent replay returns the same order and does not use a number.
  v_replay := public.stockflow_order_gateway('stockflow-order-number-test','order-number-test@stockflow.local','create_order',
    jsonb_build_object('idempotencyKey','order-number-0001','customerName','Order Number Laboratory','source','phone',
      'lines',jsonb_build_array(jsonb_build_object('tallyKey','ORDER-NUMBER-ITEM','quantity',1))));
  if v_replay->>'orderId' <> v_first->>'orderId' then raise exception 'Replay created a different order'; end if;
  if (select last_value from private.stockflow_order_number_counters where financial_year=v_year) <> v_before+2 then
    raise exception 'Replay consumed an order number';
  end if;

  -- Five-digit counts are not truncated.
  update private.stockflow_order_number_counters set last_value=9999 where financial_year=v_year;
  if private.stockflow_next_order_number(now()) <> 'SO/' || v_year || '/10000' then raise exception 'Order number truncated past 9999'; end if;

  if has_function_privilege('authenticated','private.stockflow_next_order_number(timestamptz)','execute')
     or has_table_privilege('authenticated','private.stockflow_order_number_counters','select') then
    raise exception 'Order number counter is exposed to clients';
  end if;
end $test$;

rollback;
