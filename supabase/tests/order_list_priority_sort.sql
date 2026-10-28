-- Exercises priority ordering through the real order command gateways; all fixtures roll back.
begin;

alter table public.stockflow_members drop constraint if exists stockflow_members_roles_pending_union;
insert into public.stockflow_members(email,role,roles,status)
values('priority-sort@test.local','administrator',array['administrator'],'active');
update private.stockflow_gateway_config
set secret_sha256=encode(extensions.digest('priority-sort-key','sha256'),'hex')
where name='orders';
insert into public.stockflow_snapshots(id,company,fetched_at,payload)
values('suprabha','PRIORITY SORT TEST',now()::text,
  jsonb_build_object('catalog',jsonb_build_array(jsonb_build_object(
    'tallyKey','PRIORITY-SORT-ITEM','item','Priority sort item','group','Tests','baseUnit','Nos','closing',10))))
on conflict(id) do update set company=excluded.company,fetched_at=excluded.fetched_at,payload=excluded.payload;
insert into private.stockflow_customers(id,name,tally_key,created_by_email)
values('61000000-0000-4000-8000-000000000001','Priority sort customer','priority-sort-customer','priority-sort@test.local');

-- now() is transaction-stable, so assign distinct capture instants to the gateway-created rows.
create function pg_temp.priority_sort_created_at()
returns trigger language plpgsql as $$
begin
  new.created_at := timestamptz '2026-10-28 12:00:00+05:30'
    + substring(new.idempotency_key from 'priority-sort-create-([0-9]+)')::integer * interval '1 minute';
  return new;
end $$;
create trigger priority_sort_created_at
before insert on private.stockflow_orders
for each row when (new.idempotency_key like 'priority-sort-create-%')
execute function pg_temp.priority_sort_created_at();

do $test$
declare
  ids uuid[] := array[]::uuid[];
  priorities text[] := array['normal','urgent','high','urgent','high','normal','urgent','normal'];
  minutes integer[] := array[30,20,10,40,50,60,25,80];
  labels text[] := array['normal-old','urgent-old','high-old','urgent-new','high-new','normal-new','cancelled-urgent-older','cancelled-normal-newer'];
  created jsonb;
  changed jsonb;
  listed jsonb;
  i integer;
  wanted text[];
  got text[];
  current_version integer;
begin
  for i in 1..array_length(labels,1) loop
    created:=public.stockflow_order_gateway('priority-sort-key','priority-sort@test.local','create_order',
      jsonb_build_object('customerId','61000000-0000-4000-8000-000000000001',
        'customerName','Priority sort '||labels[i],'source','phone',
        'priority',priorities[i],'idempotencyKey','priority-sort-create-'||lpad(minutes[i]::text,2,'0'),
        'lines',jsonb_build_array(jsonb_build_object('tallyKey','PRIORITY-SORT-ITEM','quantity',1))));
    if created->>'orderId' is null then raise exception 'Could not create priority sort fixture %',labels[i]; end if;
    ids:=array_append(ids,(created->>'orderId')::uuid);
  end loop;

  -- Keep the command log below its per-minute throttle between fixture bursts.
  delete from private.stockflow_request_log where actor_email='priority-sort@test.local';
  for i in 1..array_length(ids,1) loop
    select version into current_version from private.stockflow_orders where id=ids[i];
    changed:=public.stockflow_priority_gateway('priority-sort-key','priority-sort@test.local','set_order_priority',
      jsonb_build_object('orderId',ids[i],'expectedVersion',current_version,'priority',priorities[i],
        'idempotencyKey','priority-sort-priority-'||i));
    if changed->>'priority' is distinct from priorities[i] then raise exception 'Could not set priority for %',labels[i]; end if;
  end loop;

  delete from private.stockflow_request_log where actor_email='priority-sort@test.local';
  foreach i in array array[7,8] loop
    select version into current_version from private.stockflow_orders where id=ids[i];
    changed:=public.stockflow_order_gateway('priority-sort-key','priority-sort@test.local','transition_order',
      jsonb_build_object('orderId',ids[i],'expectedVersion',current_version,'toStatus','cancelled',
        'reason','Priority sort fixture','idempotencyKey','priority-sort-cancel-'||i));
    if changed->>'status' is distinct from 'cancelled' then raise exception 'Could not cancel fixture %',labels[i]; end if;
  end loop;

  listed:=public.stockflow_order_list_gateway('priority-sort-key','priority-sort@test.local','list_orders',
    jsonb_build_object('status','all','query','Priority sort','pageSize',3,'page',1));
  select array_agg(o->>'customerName' order by pos) into got
  from jsonb_array_elements(listed->'orders') with ordinality e(o,pos);
  wanted:=array['Priority sort urgent-new','Priority sort cancelled-urgent-older','Priority sort urgent-old'];
  if got is distinct from wanted then raise exception 'Priority first-page order mismatch: %',got; end if;

  listed:=public.stockflow_order_list_gateway('priority-sort-key','priority-sort@test.local','list_orders',
    jsonb_build_object('status','all','query','Priority sort','pageSize',20));
  select array_agg(o->>'customerName' order by pos) into got
  from jsonb_array_elements(listed->'orders') with ordinality e(o,pos);
  wanted:=array['Priority sort urgent-new','Priority sort cancelled-urgent-older','Priority sort urgent-old',
    'Priority sort high-new','Priority sort high-old',
    'Priority sort cancelled-normal-newer','Priority sort normal-new','Priority sort normal-old'];
  if got is distinct from wanted then raise exception 'Priority list order mismatch: %',got; end if;

  listed:=public.stockflow_order_list_gateway('priority-sort-key','priority-sort@test.local','list_orders',
    jsonb_build_object('status','cancelled','query','Priority sort','pageSize',20));
  select array_agg(o->>'customerName' order by pos) into got
  from jsonb_array_elements(listed->'orders') with ordinality e(o,pos);
  if got is distinct from array['Priority sort cancelled-normal-newer','Priority sort cancelled-urgent-older'] then
    raise exception 'Cancelled list must remain newest first: %',got;
  end if;
end $test$;

rollback;
