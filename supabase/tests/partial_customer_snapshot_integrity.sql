begin;
insert into public.stockflow_snapshots(id,company,fetched_at,payload)
values('suprabha','SUPRABHA TEST',now()::text,'{"company":"SUPRABHA TEST","rows":[],"groups":[],"customers":[]}'::jsonb)
on conflict(id) do nothing;
do $test$
declare original jsonb; before_customer jsonb; variant jsonb;
begin
  insert into private.stockflow_customers(name,tally_key,created_by_email,active,tally_balance)
  values('Partial snapshot regression','partial-snapshot-regression','test',true,123);
  select to_jsonb(c) into before_customer from private.stockflow_customers c where tally_key='partial-snapshot-regression';
  select payload into original from public.stockflow_snapshots where id='suprabha';
  if original is null then raise exception 'Snapshot fixture required'; end if;
  foreach variant in array array['{}'::jsonb,'{"customers":null}'::jsonb,'{"customers":[]}'::jsonb,'{"customers":{}}'::jsonb,'{"customers":"invalid"}'::jsonb] loop
    update public.stockflow_snapshots set payload=(original-'customers')||variant where id='suprabha';
    if (select to_jsonb(c) from private.stockflow_customers c where tally_key='partial-snapshot-regression') is distinct from before_customer then
      raise exception 'Partial customer evidence changed existing customer: %',variant;
    end if;
  end loop;
  -- A complete nonempty replacement still imports balances and soft-deactivates
  -- customers absent from that list. No business record is deleted.
  update public.stockflow_snapshots set payload=(original-'customers')||jsonb_build_object('customers',jsonb_build_array(
    jsonb_build_object('name','Complete snapshot regression','tallyKey','complete-snapshot-regression','tallyBalance',456))) where id='suprabha';
  if not exists(select 1 from private.stockflow_customers where tally_key='partial-snapshot-regression' and not active)
    or not exists(select 1 from private.stockflow_customers where tally_key='complete-snapshot-regression' and active and tally_balance=456) then
    raise exception 'Complete customer snapshot behavior regressed';
  end if;
end $test$;
rollback;
