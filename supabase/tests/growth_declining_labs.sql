begin;
set local statement_timeout='300s';
set local lock_timeout='60s';

create function pg_temp.gd_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Growth declining assertion failed: %',label;end if;end$$;

create function pg_temp.gd_voucher(src text,lab text,d date,net bigint,
 item text default 'gd-consumable',qty numeric default 1,foc text default null,
 kind text default 'sale',revision integer default 1,cancelled boolean default false) returns void language plpgsql as $$
declare voucher uuid;
begin
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,kind,cancelled,evidence)
 values('gd-co',src,revision,d,lab,kind,cancelled,'{}') returning id into voucher;
 insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,foc_reason,evidence)
 values(voucher,'1',item,qty,'pack',net,foc,jsonb_build_object('label',item));
end$$;

create function pg_temp.gd_call(payload jsonb default '{}') returns jsonb language sql as $$
 select public.stockflow_growth_gateway('growth-declining-key','gd-management@test.local','get_growth_lab_months',payload)
$$;
create function pg_temp.gd_stopped(payload jsonb,actor text default 'management',action text default 'get_growth_stopped_items') returns jsonb language sql as $$
 select public.stockflow_growth_stopped_items_gateway('growth-declining-key','gd-'||actor||'@test.local',action,payload)
$$;
create function pg_temp.gd_row(result jsonb,lab_key text) returns jsonb language sql as $$
 select value from jsonb_array_elements(result->'rows') where value->>'labKey'=lab_key
$$;

insert into private.stockflow_gateway_config(name,secret_sha256)
values('orders',encode(extensions.digest('growth-declining-key','sha256'),'hex'))
on conflict(name) do update set secret_sha256=excluded.secret_sha256;
insert into public.stockflow_members(email,role,roles,status)
select 'gd-'||r||'@test.local',r,array[r],'active'
from unnest(array['administrator','management','operations','accounts']) r;

-- Pin both public reads to the requested fixture day; all replacements roll back.
do $clock$
declare f text; signature text;
begin
 foreach signature in array array['public.stockflow_growth_gateway(text,text,text,jsonb)',
  'public.stockflow_growth_stopped_items_gateway(text,text,text,jsonb)'] loop
  select pg_get_functiondef(signature::regprocedure) into f;
  execute replace(f,'(now() at time zone ''Asia/Kolkata'')::date','''2026-11-22''::date');
 end loop;
end$clock$;

do $fixture$
begin
 -- (1,3,i) Last90 includes November, nets the return, and ignores old/cancelled revisions.
 perform pg_temp.gd_voucher('a-prev','a','2026-06-10',5000000);
 perform pg_temp.gd_voucher('a-last','a','2026-08-20',8000000);
 perform pg_temp.gd_voucher('a-last','a','2026-11-15',2500000,revision=>2);
 perform pg_temp.gd_voucher('a-return','a','2026-09-10',-500000,kind=>'return');
 perform pg_temp.gd_voucher('a-cancelled','a','2026-06-11',9000000,cancelled=>true);
 perform pg_temp.gd_voucher('a-void','a','2026-09-11',9000000);
 perform pg_temp.gd_voucher('a-void','a','2026-09-11',9000000,revision=>2,cancelled=>true);
 perform pg_temp.gd_voucher('a-moved-out','a','2026-06-12',9000000);
 perform pg_temp.gd_voucher('a-moved-out','a','2026-12-01',9000000,revision=>2);
 -- (2) Percentage threshold, absolute threshold, stopped, new, nonpositive annual total.
 perform pg_temp.gd_voucher('pct-prev','pct','2026-06-10',8000000);
 perform pg_temp.gd_voucher('pct-last','pct','2026-09-10',6000000);
 perform pg_temp.gd_voucher('floor-prev','floor','2026-06-10',1600000);
 perform pg_temp.gd_voucher('floor-last','floor','2026-09-10',800000);
 perform pg_temp.gd_voucher('zero-prev','zero','2026-06-10',5000000);
 perform pg_temp.gd_voucher('new-last','new','2026-09-10',5000000);
 perform pg_temp.gd_voucher('negative-prev','negative','2026-06-10',5000000);
 perform pg_temp.gd_voucher('negative-last','negative','2026-09-10',2000000);
 perform pg_temp.gd_voucher('negative-old','negative','2026-01-10',-10000000,kind=>'credit');
 -- (4) Rupees lost precede the lab key; a and b tie.
 perform pg_temp.gd_voucher('b-prev','b','2026-06-10',5000000);
 perform pg_temp.gd_voucher('b-last','b','2026-09-10',2000000);
 perform pg_temp.gd_voucher('c-prev','c','2026-06-10',6000000);
 perform pg_temp.gd_voucher('c-last','c','2026-09-10',2000000);
 -- (ii) A large instrument cannot make steady consumables look declining.
 perform pg_temp.gd_voucher('instrument-prev','instrument-lab','2026-06-10',30000000,'gd-instrument');
 perform pg_temp.gd_voucher('steady-prev','instrument-lab','2026-06-10',1000000);
 perform pg_temp.gd_voucher('steady-last','instrument-lab','2026-11-15',1000000);
 insert into private.stockflow_growth_item_kind_overrides(company_id,product_id,kind,reason,actor)
 values('gd-co','gd-instrument','instrument','Fixture instrument','fixture');
 -- (6) Main stopped item has a product name and the requested rounded rate.
 insert into private.stockflow_products(tally_item_key,name) values('gd-stopped','Stopped reagent');
 perform pg_temp.gd_voucher('stopped-paid','items','2026-06-10',123457,'gd-stopped',3);
 perform pg_temp.gd_voucher('both-prev','items','2026-06-10',300000,'gd-both');
 perform pg_temp.gd_voucher('both-last','items','2026-11-15',100000,'gd-both');
 perform pg_temp.gd_voucher('rank-2','items','2026-06-10',100000,'gd-second');
 perform pg_temp.gd_voucher('rank-3','items','2026-06-10',90000,'gd-third');
 perform pg_temp.gd_voucher('rank-4','items','2026-06-10',80000,'gd-fourth');
 -- (iii) Latest FOC controls the date/unit, while the latest paid line controls rate.
 perform pg_temp.gd_voucher('foc-paid-old','foc','2026-06-01',300000,'gd-foc',3);
 perform pg_temp.gd_voucher('foc-paid','foc','2026-06-10',123457,'gd-foc',3);
 perform pg_temp.gd_voucher('foc-free','foc','2026-08-24',0,'gd-foc',3,'commercial_support');
 perform pg_temp.gd_voucher('only-free','foc','2026-06-10',0,'gd-only-free',3,'commercial_support');
 -- Recent-item revision/cancellation and quantity guards.
 perform pg_temp.gd_voucher('both-void','revision-items','2026-06-10',123457,'gd-revision',3);
 perform pg_temp.gd_voucher('both-void-last','revision-items','2026-09-10',100000,'gd-revision');
 perform pg_temp.gd_voucher('both-void-last','revision-items','2026-09-10',100000,'gd-revision',revision=>2,cancelled=>true);
 perform pg_temp.gd_voucher('zero-qty','revision-items','2026-06-10',1000000,'gd-zero-qty',0);
 perform pg_temp.gd_voucher('superseded-item','revision-items','2026-06-10',1000000,'gd-old-item');
 perform pg_temp.gd_voucher('superseded-item','revision-items','2026-12-10',1000000,'gd-old-item',revision=>2);
end$fixture$;

do $checks$
declare r jsonb; e jsonb; payload jsonb; role_name text; i integer; keys text[];
begin
 r:=pg_temp.gd_call('{"filter":"declining"}');
 perform pg_temp.gd_assert(r=private.stockflow_growth_declining_labs_read('2026-11-22'),'5 declining dispatch');
 e:=pg_temp.gd_row(r,'gd-co|a');
 perform pg_temp.gd_assert(e->'previousNinetyPaise'='5000000'::jsonb
  and e->'lastNinetyPaise'='2000000'::jsonb and e->'usualMonthlyPaise'='1666667'::jsonb
  and e->>'lastPurchaseOn'='2026-11-15' and not e ? 'monthsMissed','1,3,i amounts, current month, revisions and return');
 perform pg_temp.gd_assert(r->'window'='{"from":"2025-11-01","to":"2026-11-01"}'::jsonb
  and jsonb_array_length(r->'months')=12 and jsonb_array_length(e->'monthsPaise')=12
  and e->'totalPaise'='4500000'::jsonb,'whole-month totals remain separate');
 perform pg_temp.gd_assert(not exists(select 1 from jsonb_array_elements(r->'rows') x
  where x->>'labKey' in ('gd-co|pct','gd-co|floor','gd-co|zero','gd-co|new','gd-co|negative','gd-co|instrument-lab')),
  '2,ii exclusion thresholds and consumables only');
 select array_agg(value->>'labKey' order by ordinality) into keys from jsonb_array_elements(r->'rows') with ordinality;
 perform pg_temp.gd_assert(keys=array['gd-co|c','gd-co|a','gd-co|b'] and r->'totalLabs'='3'::jsonb,'4 lost rupees then labKey');
 for i in 1..51 loop
  perform pg_temp.gd_voucher('cap-prev-'||i,'cap-'||lpad(i::text,2,'0'),'2026-06-10',2000000);
  perform pg_temp.gd_voucher('cap-last-'||i,'cap-'||lpad(i::text,2,'0'),'2026-09-10',1000000);
 end loop;
 r:=pg_temp.gd_call('{"filter":"declining"}');
 perform pg_temp.gd_assert(r->'totalLabs'='54'::jsonb and jsonb_array_length(r->'rows')=50
  and r#>>'{rows,49,labKey}'='gd-co|cap-47','4 totalLabs includes labs past cap');
 perform pg_temp.gd_assert(pg_temp.gd_call('{"filter":"lapsing"}')=private.stockflow_growth_lapsing_labs_read('2026-11-22')
  and pg_temp.gd_call('{}')=private.stockflow_growth_lab_months_read('2026-11-22'),'5 existing dispatches');
 begin perform pg_temp.gd_call('{"filter":"x"}');raise exception 'Accepted unknown filter';
 exception when sqlstate '22023' then null;end;
 perform pg_temp.gd_assert((select 'statement_timeout=20s'=any(proconfig) from pg_proc
  where oid='public.stockflow_growth_gateway(text,text,text,jsonb)'::regprocedure),'5 timeout preserved');

 r:=pg_temp.gd_stopped('{"labKeys":["gd-co|items","unknown|lab","gd-co|foc","gd-co|instrument-lab","gd-co|revision-items"]}');
 perform pg_temp.gd_assert(r=private.stockflow_growth_stopped_items_read('2026-11-22',
  array['gd-co|items','unknown|lab','gd-co|foc','gd-co|instrument-lab','gd-co|revision-items']),'6 stopped dispatch');
 perform pg_temp.gd_assert((select array_agg(value->>'labKey' order by ordinality)
  =array['gd-co|items','unknown|lab','gd-co|foc','gd-co|instrument-lab','gd-co|revision-items']
  from jsonb_array_elements(r->'labs') with ordinality),'6 lab input order');
 perform pg_temp.gd_assert(r#>'{labs,1,items}'='[]'::jsonb and r#>'{labs,3,items}'='[]'::jsonb,'6,ii unknown and instrument items absent');
 perform pg_temp.gd_assert((select array_agg(value->>'itemKey' order by ordinality)=array['gd-stopped','gd-second','gd-third']
  from jsonb_array_elements(r#>'{labs,0,items}') with ordinality),'6 top three, both-window item absent');
 e:=r#>'{labs,0,items,0}';
 perform pg_temp.gd_assert(e='{"itemKey":"gd-stopped","itemName":"Stopped reagent","usualMonthlyQuantity":1.000,"unit":"pack","lastBilledOn":"2026-06-10","lastRatePaise":41152}'::jsonb,'6 item fields and rounded rate');
 e:=r#>'{labs,2,items,0}';
 perform pg_temp.gd_assert(e->>'itemKey'='gd-foc' and e->'usualMonthlyQuantity'='3'::jsonb
  and e->>'lastBilledOn'='2026-08-24' and e->'lastRatePaise'='41152'::jsonb,'iii latest paid rate behind FOC');
 perform pg_temp.gd_assert(r#>'{labs,2,items,1,lastRatePaise}'='null'::jsonb,'iii FOC-only rate is JSON null');
 perform pg_temp.gd_assert(jsonb_array_length(r#>'{labs,4,items}')=1
  and r#>>'{labs,4,items,0,itemKey}'='gd-revision','6 revision/cancellation/positive quantity guards');
 -- (7) Match the original growth denial, including its message.
 foreach role_name in array array['operations','accounts'] loop
  begin perform pg_temp.gd_stopped('{"labKeys":["gd-co|items"]}',role_name);raise exception 'Accepted role %',role_name;
  exception when sqlstate 'PT403' then perform pg_temp.gd_assert(sqlerrm='Growth access required','7 role denial message');end;
 end loop;
 for payload in select value from jsonb_array_elements('[{"labKeys":[]},{"labKeys":["a|b","a|c","a|d","a|e","a|f","a|g","a|h","a|i","a|j"]},{"labKeys":["a|b","a|b"]},{"labKeys":[3]},{"labKeys":["a|b"],"extra":1},{"labKeys":[null]},{"labKeys":["no-pipe"]},{"labKeys":["|"]},{"labKeys":"a|b"},{},[],null]'::jsonb) loop
  begin perform pg_temp.gd_stopped(payload);raise exception 'Accepted payload %',payload;
  exception when sqlstate '22023' then perform pg_temp.gd_assert(sqlerrm='Invalid stopped items request','7 invalid payload message');end;
 end loop;
 begin perform pg_temp.gd_stopped(jsonb_build_object('labKeys',jsonb_build_array(repeat('x',300)||'|')));raise exception 'Accepted long key';
 exception when sqlstate '22023' then null;end;
 begin perform pg_temp.gd_stopped('{"labKeys":["a|b"]}','management','wrong');raise exception 'Accepted wrong action';
 exception when sqlstate '22023' then null;end;
 perform pg_temp.gd_assert(pg_temp.gd_stopped('{"labKeys":["unknown|lab"]}','administrator')
  ='{"labs":[{"labKey":"unknown|lab","items":[]}]}'::jsonb,'7 administrator allowed');
 -- (8) Private reads remain inaccessible even to service_role.
 foreach role_name in array array['anon','authenticated','service_role'] loop
  perform pg_temp.gd_assert(not has_function_privilege(role_name,'private.stockflow_growth_declining_labs_read(date)','execute')
   and not has_function_privilege(role_name,'private.stockflow_growth_stopped_items_read(date,text[])','execute'),'8 private ACL '||role_name);
 end loop;
 perform pg_temp.gd_assert(not has_function_privilege('authenticated','public.stockflow_growth_stopped_items_gateway(text,text,text,jsonb)','execute')
  and not has_function_privilege('anon','public.stockflow_growth_stopped_items_gateway(text,text,text,jsonb)','execute')
  and has_function_privilege('service_role','public.stockflow_growth_stopped_items_gateway(text,text,text,jsonb)','execute'),'8 gateway ACL');
 raise notice 'PASS growth declining labs 1-8 and amendments i-iii';
end$checks$;

rollback;
