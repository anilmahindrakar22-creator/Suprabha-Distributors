begin;
set local statement_timeout='60s';
create function pg_temp.e_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Letterhead extras: %',label; end if; end$$;
create function pg_temp.e_reject(payload jsonb,code text default '22023',actor text default 'administrator',message text default null,action text default 'set_letterhead_extras')
returns void language plpgsql as $$
begin
  begin
    perform public.stockflow_letterhead_extras_gateway('extras-key','extras-'||actor||'@test.local',action,payload);
  exception when others then
    if sqlstate=code and (message is null or sqlerrm=message) then return; end if;
    raise;
  end;
  raise exception 'Accepted invalid extras request: %',payload;
end$$;
insert into private.stockflow_gateway_config(name,secret_sha256)
values('orders',encode(extensions.digest('extras-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,roles,status)
select 'extras-'||r||'@test.local',r,array[r],'active'
from unnest(array['accounts','operations','administrator','management']) r;

do $tests$
declare initial jsonb; result jsonb; payload jsonb; bad jsonb; role_name text; table_name text; denied boolean;
  png text:=replace(encode(decode('89504e470d0a1a0a0000000d4948445200000001000000010804000000b51c0c020000000b4944415478da63fcff1f0003030200efa345990000002674455874436f6d6d656e74004c65747465726865616420657874726173207465737420666978747572650b68f2c50000000049454e44ae426082','hex'),'base64'),E'\n','');
  jpeg text:=replace(encode(decode('ffd8ff'||repeat('00',97),'hex'),'base64'),E'\n','');
begin
  -- 1: untouched migration defaults.
  initial:=public.stockflow_letterhead_extras_gateway('extras-key','extras-administrator@test.local','get_letterhead_extras','{}');
  perform pg_temp.e_assert(initial='{"logo":null,"terms":[],"version":1}'::jsonb,'1 fresh row');
  -- 2: purchase roles read, only the administrator writes.
  foreach role_name in array array['operations','management','administrator'] loop
    perform pg_temp.e_assert(public.stockflow_letterhead_extras_gateway('extras-key','extras-'||role_name||'@test.local','get_letterhead_extras','{}')=initial,'2 read '||role_name);
  end loop;
  perform pg_temp.e_reject('{}','42501','accounts',null,'get_letterhead_extras');
  perform pg_temp.e_reject('{"extra":true}','22023','administrator',null,'get_letterhead_extras');
  begin perform public.stockflow_letterhead_extras_gateway('bad','extras-administrator@test.local','get_letterhead_extras','{}');
    raise exception 'Bad gateway key accepted'; exception when sqlstate '42501' then null; end;
  payload:=jsonb_build_object('idempotencyKey',gen_random_uuid()::text,'expectedVersion',1,
    'logo',jsonb_build_object('type','image/png','base64',png),'terms',jsonb_build_array(' Payment within 30 days '));
  perform pg_temp.e_reject(payload,'42501','management','Only an administrator can change the letterhead');
  perform pg_temp.e_reject(payload,'42501','operations','Only an administrator can change the letterhead');
  result:=public.stockflow_letterhead_extras_gateway('extras-key','extras-administrator@test.local','set_letterhead_extras',payload);
  perform pg_temp.e_assert(result=jsonb_build_object('logo',payload->'logo','terms',jsonb_build_array('Payment within 30 days'),'version',2),'2 set/version/trim');
  perform pg_temp.e_assert((select count(*)=1 from private.stockflow_letterhead_extras_events),'2 one event');
  -- 3: audits have only metadata and terms, never encoded logo bytes.
  perform pg_temp.e_assert((select before='{"logoType":null,"logoSha256":null,"logoBytes":null,"terms":[]}'::jsonb
    and after=jsonb_build_object('logoType','image/png','logoSha256',encode(extensions.digest(decode(png,'base64'),'sha256'),'hex'),
      'logoBytes',octet_length(decode(png,'base64')),'terms',result->'terms')
    and not (after ? 'base64') and position(left(png,40) in after::text)=0
    and version=2 and actor_email='extras-administrator@test.local' from private.stockflow_letterhead_extras_events),'3 safe event');
  -- 4: exact replay precedes the version check and creates no event.
  perform pg_temp.e_assert(public.stockflow_letterhead_extras_gateway('extras-key','extras-administrator@test.local','set_letterhead_extras',payload)=result,'4 replay');
  perform pg_temp.e_assert((select count(*)=1 from private.stockflow_letterhead_extras_events)
    and (select extras_version=2 from private.stockflow_company_letterhead),'4 no replay mutation');
  perform pg_temp.e_reject(payload||'{"terms":["Different"]}');
  -- 5: new key, stale version.
  perform pg_temp.e_reject(payload||jsonb_build_object('idempotencyKey',gen_random_uuid()::text),'PT409','administrator','Letterhead changed; reload');
  payload:=payload||jsonb_build_object('expectedVersion',2,'idempotencyKey',gen_random_uuid()::text);
  -- 6: type/magic, decoded bounds and malformed encoding.
  perform pg_temp.e_reject(payload||jsonb_build_object('logo',jsonb_build_object('type','image/png','base64',jpeg)),
    '22023','administrator','Invalid logo');
  perform pg_temp.e_reject(payload||jsonb_build_object('logo',jsonb_build_object('type','image/jpeg','base64',png)),
    '22023','administrator','Invalid logo');
  for bad in select x from jsonb_array_elements(jsonb_build_array(
    jsonb_build_object('type','image/png','base64',replace(encode(decode('89504e470d0a1a0a'||repeat('00',91),'hex'),'base64'),E'\n','')),
    jsonb_build_object('type','image/png','base64',replace(encode(decode('89504e470d0a1a0a'||repeat('00',40953),'hex'),'base64'),E'\n','')),
    jsonb_build_object('type','image/png','base64','%%%='))) x loop
    perform pg_temp.e_reject(payload||jsonb_build_object('logo',bad),'22023','administrator','Invalid letterhead extras');
  end loop;
  -- 7: terms and strict request shapes.
  for bad in select x from jsonb_array_elements(jsonb_build_array(
    payload||'{"terms":["1","2","3","4","5","6"]}',payload||'{"terms":[""]}',
    payload||jsonb_build_object('terms',jsonb_build_array(E'first\nsecond')),
    payload||jsonb_build_object('terms',jsonb_build_array(repeat('a',201))),payload||'{"extra":true}',
    payload-'logo',payload||'{"terms":[null]}',payload||'{"terms":null}',
    payload||'{"expectedVersion":0}',payload||'{"expectedVersion":1.5}',payload||'{"idempotencyKey":"bad"}',
    payload||jsonb_build_object('logo',(payload->'logo')||'{"extra":true}'))) x loop
    perform pg_temp.e_reject(bad,'22023','administrator','Invalid letterhead extras');
  end loop;
  -- Valid JPEG and 5 terms, followed by clearing.
  payload:=payload||jsonb_build_object('logo',jsonb_build_object('type','image/jpeg','base64',jpeg),'terms',jsonb_build_array('1','2','3','4',repeat('a',200)));
  result:=public.stockflow_letterhead_extras_gateway('extras-key','extras-administrator@test.local','set_letterhead_extras',payload);
  perform pg_temp.e_assert(result->'logo'=payload->'logo' and result->>'version'='3','6 valid JPEG');
  -- 8: clearing removes both logo columns and records the previous metadata.
  payload:=payload||jsonb_build_object('expectedVersion',3,'idempotencyKey',gen_random_uuid()::text,'logo',null,'terms','[]'::jsonb);
  result:=public.stockflow_letterhead_extras_gateway('extras-key','extras-administrator@test.local','set_letterhead_extras',payload);
  perform pg_temp.e_assert(result='{"logo":null,"terms":[],"version":4}'::jsonb,'8 clear');
  perform pg_temp.e_assert((select before->>'logoType'='image/jpeg' and after->'logoSha256'='null'::jsonb
    from private.stockflow_letterhead_extras_events where version=4),'8 clear audit');
  -- 9: append-only and no direct access, including service_role table access.
  denied:=false;
  begin update private.stockflow_letterhead_extras_events set version=99;
    exception when others then denied:=true; end;
  perform pg_temp.e_assert(denied,'9 immutable');
  denied:=false;
  begin delete from private.stockflow_letterhead_extras_events;
    exception when others then denied:=true; end;
  perform pg_temp.e_assert(denied,'9 no delete');
  foreach role_name in array array['anon','authenticated','service_role'] loop
    foreach table_name in array array['stockflow_company_letterhead','stockflow_letterhead_extras_events'] loop
      perform pg_temp.e_assert(not has_table_privilege(role_name,'private.'||table_name,'select'),'9 table ACL '||role_name||'/'||table_name);
    end loop;
  end loop;
  perform pg_temp.e_assert(not has_function_privilege('authenticated','public.stockflow_letterhead_extras_gateway(text,text,text,jsonb)','execute'),'9 gateway ACL');
end$tests$;
rollback;
