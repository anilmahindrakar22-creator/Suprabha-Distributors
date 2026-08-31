create or replace function private.stockflow_sync_tally_customers()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
declare
  v_customer jsonb;
  v_tally_key text;
  v_name text;
begin
  if jsonb_typeof(new.payload->'customers') <> 'array'
     or jsonb_array_length(new.payload->'customers') = 0 then
    return new;
  end if;

  for v_customer in
    select value from jsonb_array_elements(new.payload->'customers')
  loop
    v_tally_key := nullif(btrim(v_customer->>'tallyKey'), '');
    v_name := nullif(btrim(v_customer->>'name'), '');
    if v_tally_key is null or v_name is null
       or char_length(v_name) not between 2 and 160 then
      continue;
    end if;

    insert into private.stockflow_customers (
      tally_key, name, phone, city, active, created_by_email, updated_at
    ) values (
      v_tally_key,
      v_name,
      nullif(left(btrim(coalesce(v_customer->>'phone', '')), 80), ''),
      nullif(left(btrim(coalesce(v_customer->>'city', '')), 160), ''),
      true,
      'tally-sync',
      now()
    )
    on conflict (tally_key) do update
    set name = excluded.name,
        phone = coalesce(excluded.phone, stockflow_customers.phone),
        city = coalesce(excluded.city, stockflow_customers.city),
        active = true,
        updated_at = now();
  end loop;

  update private.stockflow_customers c
  set active = false, updated_at = now()
  where c.tally_key is not null
    and not exists (
      select 1
      from jsonb_array_elements(new.payload->'customers') item
      where nullif(btrim(item->>'tallyKey'), '') = c.tally_key
    );

  return new;
end;
$$;

revoke all on function private.stockflow_sync_tally_customers() from public, anon, authenticated;

drop trigger if exists stockflow_sync_tally_customers on public.stockflow_snapshots;
create trigger stockflow_sync_tally_customers
after insert or update of payload on public.stockflow_snapshots
for each row
when (new.id = 'suprabha')
execute function private.stockflow_sync_tally_customers();

comment on function private.stockflow_sync_tally_customers() is
  'Synchronizes Tally Sundry Debtor ledgers from the trusted desktop stock snapshot into the private order customer directory.';
