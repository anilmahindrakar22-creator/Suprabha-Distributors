begin;
set local lock_timeout='60s';
set local statement_timeout='120s';

insert into public.stockflow_members(email,role,roles,status) values
 ('no-territory-manager@example.test','management',array['management'],'active'),
 ('no-territory-owner@example.test','sales',array['sales'],'active');
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('no-territory-test-key','sha256'),'hex') where name='orders';

do $test$
declare
  token text:='NoTerritory'||replace(extensions.gen_random_uuid()::text,'-','');
  actor text:='no-territory-manager@example.test';
  owner_email text:='no-territory-owner@example.test';
  a uuid; c uuid; d uuid; inactive uuid; territory uuid;
  baseline bigint; result jsonb; payload jsonb; bad jsonb; ids uuid[];
begin
  payload:=jsonb_build_object('search',token);
  result:=public.stockflow_accounts_gateway('no-territory-test-key',actor,'get_accounts',payload);
  baseline:=(result#>>'{page,total}')::bigint;
  if baseline<>0 then raise exception 'Unique fixture token already exists';end if;

  insert into private.stockflow_customers(name,created_by_email) values(token||' A',actor) returning id into a;
  insert into private.stockflow_customers(name,created_by_email) values(token||' C',actor) returning id into c;
  insert into private.stockflow_customers(name,created_by_email) values(token||' D',actor) returning id into d;
  insert into private.stockflow_territories(name,created_by) values(token,actor) returning id into territory;
  insert into private.stockflow_customer_assignments(customer_id,owner_email,territory_id,effective_from,version,created_by) values
    (a,owner_email,territory,current_date,1,actor),
    (d,owner_email,territory,current_date-2,1,actor);
  update private.stockflow_customer_assignments set effective_to=current_date-1 where customer_id=d and effective_to is null;

  -- T1: no assignment and an ended assignment both have no current territory.
  result:=public.stockflow_accounts_gateway('no-territory-test-key',actor,'get_accounts',payload||'{"unassignedTerritory":true}');
  select array_agg((item->>'id')::uuid order by (item->>'id')::uuid) into ids from jsonb_array_elements(result->'accounts') item;
  if ids is distinct from (select array_agg(id order by id) from unnest(array[c,d]) id)
    or (result#>>'{page,total}')::bigint<>baseline+2 then raise exception 'T1 missing-territory membership/total failed: %',result;end if;
  result:=public.stockflow_accounts_gateway('no-territory-test-key',actor,'get_accounts',payload||'{"unassignedTerritory":true,"page":2}');
  if jsonb_array_length(result->'accounts')<>0 or (result#>>'{page,total}')::bigint<>baseline+2 then raise exception 'T1 paging failed';end if;

  -- T2: owner filter for the assigned account intersects to no unassigned rows.
  result:=public.stockflow_accounts_gateway('no-territory-test-key',actor,'get_accounts',payload||jsonb_build_object('unassignedTerritory',true,'ownerEmail',owner_email));
  if jsonb_array_length(result->'accounts')<>0 or (result#>>'{page,total}')::bigint<>0 then raise exception 'T2 owner intersection failed';end if;

  -- T3: inactive labs never enter the filtered book.
  insert into private.stockflow_customers(name,created_by_email,active) values(token||' inactive',actor,false) returning id into inactive;
  result:=public.stockflow_accounts_gateway('no-territory-test-key',actor,'get_accounts',payload||'{"unassignedTerritory":true}');
  if jsonb_array_length(result->'accounts')<>2 or (result#>>'{page,total}')::bigint<>baseline+2
    or exists(select 1 from jsonb_array_elements(result->'accounts') item where item->>'id'=inactive::text) then raise exception 'T3 inactive lab returned';end if;

  -- T4: require JSON boolean true and reject any simultaneous territoryId.
  for bad in select value from jsonb_array_elements(jsonb_build_array(
    '{"unassignedTerritory":false}'::jsonb,'{"unassignedTerritory":"true"}'::jsonb,
    jsonb_build_object('unassignedTerritory',true,'territoryId',territory),
    '{"unassignedTerritory":null}'::jsonb,'{"unassignedTerritory":1}'::jsonb,
    '{"unassignedTerritory":[]}'::jsonb,'{"unassignedTerritory":{}}'::jsonb,
    '{"unassignedTerritory":true,"territoryId":null}'::jsonb)) loop
    begin
      perform public.stockflow_accounts_gateway('no-territory-test-key',actor,'get_accounts',payload||bad);
      raise exception 'T4 invalid territory accepted: %',bad;
    exception when sqlstate '22023' then
      if sqlerrm<>'Invalid territory' then raise;end if;
    end;
  end loop;

  -- T5: omitting the key preserves all active token matches.
  result:=public.stockflow_accounts_gateway('no-territory-test-key',actor,'get_accounts',payload);
  select array_agg((item->>'id')::uuid order by (item->>'id')::uuid) into ids from jsonb_array_elements(result->'accounts') item;
  if ids is distinct from (select array_agg(id order by id) from unnest(array[a,c,d]) id)
    or (result#>>'{page,total}')::bigint<>baseline+3 then raise exception 'T5 unfiltered results changed';end if;
  raise notice 'PASS accounts no territory T1-T5';
end $test$;
rollback;
