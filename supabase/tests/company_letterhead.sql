begin;
set local statement_timeout='60s';
create function pg_temp.l_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Company letterhead: %',label; end if; end$$;
create function pg_temp.l_reject(payload jsonb,code text default '22023',actor text default 'administrator',action text default 'set_letterhead')
returns void language plpgsql as $$
begin
  begin
    perform public.stockflow_letterhead_gateway('letterhead-key','letterhead-'||actor||'@test.local',action,payload);
  exception when others then
    if sqlstate=code then return; end if;
    raise;
  end;
  raise exception 'Accepted invalid letterhead request: %',payload;
end$$;
insert into private.stockflow_gateway_config(name,secret_sha256)
values('orders',encode(extensions.digest('letterhead-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,roles,status)
select 'letterhead-'||r||'@test.local',r,array[r],'active'
from unnest(array['accounts','operations','administrator','management']) r;

do $tests$
declare initial jsonb; result jsonb; payload jsonb; bad jsonb; role_name text; table_name text; denied boolean;
begin
  -- 1: migration seed, with no writes to disguise a missing seed.
  perform pg_temp.l_assert((select company_name='Suprabha Distributors' and version=1
    from private.stockflow_company_letterhead where id=1),'1 seed');
  -- 2: all purchase roles can read; Accounts cannot.
  foreach role_name in array array['operations','management','administrator'] loop
    initial:=public.stockflow_letterhead_gateway('letterhead-key','letterhead-'||role_name||'@test.local','get_letterhead','{}');
    perform pg_temp.l_assert(initial->>'companyName'='Suprabha Distributors' and initial->>'version'='1','2 allowed read');
  end loop;
  perform pg_temp.l_reject('{}','42501','accounts','get_letterhead');
  perform pg_temp.l_reject('{"extra":true}','22023','administrator','get_letterhead');
  perform pg_temp.l_reject('{}','22023','administrator','unknown');
  begin perform public.stockflow_letterhead_gateway('bad','letterhead-administrator@test.local','get_letterhead','{}');
    raise exception 'Bad gateway key accepted'; exception when sqlstate '42501' then null; end;
  payload:=jsonb_build_object('idempotencyKey',gen_random_uuid()::text,'expectedVersion',1,
    'companyName',' New Company ','address',' Office ','gstin',' 29abcde1234f1z5 ','phone',' 123 ','deliveryAddress',' Warehouse ');
  -- 3: only an administrator writes; audit contains exact before/after shapes.
  perform pg_temp.l_reject(payload,'42501','management');
  perform pg_temp.l_reject(payload,'42501','operations');
  result:=public.stockflow_letterhead_gateway('letterhead-key','letterhead-administrator@test.local','set_letterhead',payload);
  perform pg_temp.l_assert(result->>'version'='2' and result->>'companyName'='New Company' and result->>'address'='Office'
    and result->>'phone'='123' and result->>'deliveryAddress'='Warehouse','3 trimmed update/version');
  perform pg_temp.l_assert((select count(*)=1 from private.stockflow_letterhead_events),'3 one event');
  perform pg_temp.l_assert((select before=initial and after=result and version=2 and actor_email='letterhead-administrator@test.local'
    from private.stockflow_letterhead_events),'3 event before/after/actor');
  perform pg_temp.l_assert((select updated_by_email='letterhead-administrator@test.local' from private.stockflow_company_letterhead),'3 updater');
  -- 4: exact replay precedes optimistic version check.
  perform pg_temp.l_assert(public.stockflow_letterhead_gateway('letterhead-key','letterhead-administrator@test.local','set_letterhead',payload)=result,'4 replay');
  perform pg_temp.l_assert((select count(*)=1 from private.stockflow_letterhead_events)
    and (select version=2 from private.stockflow_company_letterhead),'4 no second event/version');
  perform pg_temp.l_reject(payload||'{"companyName":"Different"}');
  -- 5: a fresh key with an old version conflicts.
  perform pg_temp.l_reject(payload||jsonb_build_object('idempotencyKey',gen_random_uuid()::text),'PT409');
  -- 6: normalization, invalid GSTIN, and clearing.
  perform pg_temp.l_assert(result->>'gstin'='29ABCDE1234F1Z5','6 uppercase GSTIN');
  payload:=payload||jsonb_build_object('expectedVersion',2,'idempotencyKey',gen_random_uuid()::text);
  perform pg_temp.l_reject(payload||'{"gstin":"invalid"}');
  -- 7: strict shape, types and bounds.
  for bad in select x from jsonb_array_elements(jsonb_build_array(payload||'{"extra":true}',payload-'phone',
    payload||'{"companyName":"   "}',payload||jsonb_build_object('address',repeat('a',401)),
    payload||'{"expectedVersion":0}',payload||'{"expectedVersion":1.5}',payload||'{"idempotencyKey":"bad"}',
    payload||'{"phone":null}',payload||'{"gstin":42}')) x loop
    perform pg_temp.l_reject(bad);
  end loop;
  result:=public.stockflow_letterhead_gateway('letterhead-key','letterhead-administrator@test.local','set_letterhead',payload||'{"gstin":""}');
  perform pg_temp.l_assert(result->'gstin'='null'::jsonb and result->>'version'='3','6 empty GSTIN is null');
  -- 8: append-only triggers must reject even owner writes.
  denied:=false;
  begin update private.stockflow_letterhead_events set version=99;
    exception when others then denied:=true; end;
  perform pg_temp.l_assert(denied,'8 immutable event');
  denied:=false;
  begin delete from private.stockflow_letterhead_events;
    exception when others then denied:=true; end;
  perform pg_temp.l_assert(denied,'8 no event delete');
  -- 9: no direct table SELECT, including service_role.
  foreach role_name in array array['anon','authenticated','service_role'] loop
    foreach table_name in array array['stockflow_company_letterhead','stockflow_letterhead_events'] loop
      perform pg_temp.l_assert(not has_table_privilege(role_name,'private.'||table_name,'select'),'9 table ACL '||role_name||'/'||table_name);
    end loop;
  end loop;
end$tests$;
rollback;
