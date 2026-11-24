-- Disposable replay only; every fixture and gateway-key change rolls back.
begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

create function pg_temp.line_reads_assert(ok boolean,label text) returns void language plpgsql as $$
begin
 if ok is distinct from true then raise exception 'Economics line reads: %',label; end if;
end $$;
-- Inspect the installed constraints immediately before every fixture insert.
create function pg_temp.line_reads_constraints(relation regclass) returns void language plpgsql as $$
declare c record;
begin
 for c in select conname,pg_get_constraintdef(oid) definition from pg_constraint where conrelid=relation order by conname loop
  raise notice 'Fixture constraint %.%: %',relation,c.conname,c.definition;
 end loop;
end $$;
create function pg_temp.line_reads_call(action text,payload jsonb default '{}'::jsonb) returns jsonb language sql as $$
 select public.stockflow_economics_gateway('line-reads-key','line-reads-manager@test.local',action,payload)
$$;

update private.stockflow_gateway_config
 set secret_sha256=encode(extensions.digest('line-reads-key','sha256'),'hex') where name='orders';
select pg_temp.line_reads_constraints('public.stockflow_members');
-- Normalized unique email; role belongs to valid roles; active is a valid status.
insert into public.stockflow_members(email,role,roles,status) values
 ('line-reads-manager@test.local','management',array['management'],'active'),
 ('line-reads-admin@test.local','administrator',array['administrator'],'active'),
 ('line-reads-sales@test.local','sales',array['sales'],'active'),
 ('line-reads-ops@test.local','operations',array['operations'],'active');

do $test$
declare
 company text:='line-reads-'||extensions.gen_random_uuid()::text;
 fixture record; voucher uuid; line_id uuid; run uuid;
 excluded uuid[]:='{}'; included uuid[]:='{}'; reversed_ids uuid[];
 spd uuid; latest uuid; purchase uuid; labelled uuid;
 full_doc jsonb; expected jsonb; result jsonb; row_doc jsonb; payload jsonb; g jsonb;
 walked jsonb:='[]'; exceptions_walked jsonb:='[]'; groups jsonb; ordered_ids jsonb;
 n integer; i integer; actor text; action text; signature text; db_role text;
begin
 raise notice 'Economics line reads phase: constraint-checked fixtures';
 select id into run from private.stockflow_economic_runs where active;
 if run is null then
  perform pg_temp.line_reads_constraints('private.stockflow_economic_runs');
  -- One active run; actor NOT NULL; generated UUID PK.
  insert into private.stockflow_economic_runs(active,actor) values(true,'line-reads-test') returning id into run;
 end if;
 for fixture in select * from (values
  ('spd',0,'sale',false,'2026-12-20'::date,'{"sourceReference":"SPD-7781"}'::jsonb,'spd-product','{}'::jsonb),
  ('revision',0,'sale',false,'2026-12-21'::date,'{}'::jsonb,'old-product','{}'::jsonb),
  ('revision',1,'sale',false,'2026-12-21'::date,'{}'::jsonb,'label-product','{"label":"Speed Reagent 50%_x"}'::jsonb),
  ('cancelled',0,'sale',true,'2026-12-22'::date,'{}'::jsonb,'cancelled-product','{}'::jsonb),
  ('purchase',0,'purchase',false,'2026-12-19'::date,'{"supplierName":"Speed Supplies"}'::jsonb,'purchase-product','{}'::jsonb)
 ) f(source_id,revision,kind,cancelled,business_date,voucher_evidence,product_id,line_evidence) loop
  perform pg_temp.line_reads_constraints('private.stockflow_economic_source_vouchers');
  -- Revision 0/1 >=0; sale/purchase enum; default INR; unique company/source/revision.
  insert into private.stockflow_economic_source_vouchers
   (company_id,source_id,source_revision,business_date,customer_source_id,kind,cancelled,evidence)
  values(company,fixture.source_id,fixture.revision,fixture.business_date,'line-reads-customer',
   fixture.kind,fixture.cancelled,fixture.voucher_evidence) returning id into voucher;
  perform pg_temp.line_reads_constraints('private.stockflow_economic_source_lines');
  -- Voucher FK; unique voucher/line_key; product 1..240 and unit 1..80; required numeric values.
  insert into private.stockflow_economic_source_lines
   (voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
  values(voucher,'1',fixture.product_id,1,'pack',100,fixture.line_evidence) returning id into line_id;
  if fixture.cancelled or (fixture.source_id='revision' and fixture.revision=0) then
   excluded:=array_append(excluded,line_id);
  else
   included:=array_append(included,line_id);
   case fixture.source_id when 'spd' then spd:=line_id; when 'revision' then latest:=line_id; labelled:=line_id;
    when 'purchase' then purchase:=line_id; end case;
   if fixture.kind='sale' then
    perform pg_temp.line_reads_constraints('private.stockflow_economic_results');
    -- Valid run/line FKs; nullable target; share 1..10000; cost/gp both null; status/reason non-null text.
    insert into private.stockflow_economic_results
     (run_id,source_line_id,status,reason,share_bps,quantity,revenue_paise,cost_paise,gp_paise)
    values(run,line_id,case when fixture.source_id='spd' then 'cost_unavailable' else 'unattributed' end,
     case when fixture.source_id='spd' then 'Line reads cost fixture' else 'no_verified_compatible_placement' end,
     10000,1,100,null,null);
   end if;
  end if;
 end loop;
 perform pg_temp.line_reads_constraints('private.stockflow_economic_import_exceptions');
 -- Identity PK; reason/evidence NOT NULL; fixture source remains unresolved.
 insert into private.stockflow_economic_import_exceptions(company_id,source_id,reason,evidence)
 values(company,'line-reads-import','Line reads import fixture','{"sourceReference":"LINE-READS-IMPORT"}');

 raise notice 'Economics line reads phase: full-read parity, scope and filters';
 full_doc:=private.stockflow_economic_workspace_read('{management}',false);
 select coalesce(jsonb_agg(x),'[]'::jsonb) into expected
 from jsonb_array_elements(full_doc->'sourceLines') x where x->>'companyId'=company;
 result:=pg_temp.line_reads_call('get_economic_source_lines',jsonb_build_object('companyId',company));
 perform pg_temp.line_reads_assert((result->>'total')::integer=jsonb_array_length(expected) and (result->>'total')::integer=3,'company total');
 perform pg_temp.line_reads_assert(result->>'limit'='50' and result->>'offset'='0','source defaults');
 for row_doc in select value from jsonb_array_elements(result->'rows') loop
  perform pg_temp.line_reads_assert(row_doc=(select x from jsonb_array_elements(expected) x where x->>'id'=row_doc->>'id'),'exact source object parity');
 end loop;
 result:=pg_temp.line_reads_call('get_economic_source_lines',jsonb_build_object('ids',to_jsonb(excluded)));
 perform pg_temp.line_reads_assert(result->'rows'='[]'::jsonb and result->>'total'='0','excluded IDs cannot bypass scope');
 perform pg_temp.line_reads_assert(private.stockflow_economic_line_rows(excluded)='[]'::jsonb,'row helper scope');

 for fixture in select * from (values
  ('{"kind":"purchase"}'::jsonb,purchase),
  ('{"q":"spd-77"}'::jsonb,spd),
  ('{"q":"speed supplies"}'::jsonb,purchase),
  ('{"q":"50%_"}'::jsonb,labelled),
  ('{"q":"%"}'::jsonb,labelled),
  ('{"productId":"purchase-product"}'::jsonb,purchase)
 ) f(filter,expected_id) loop
  result:=pg_temp.line_reads_call('get_economic_source_lines',fixture.filter||jsonb_build_object('companyId',company));
  perform pg_temp.line_reads_assert(result->>'total'='1' and result#>>'{rows,0,id}'=fixture.expected_id::text,'filter '||fixture.filter::text);
 end loop;
 result:=pg_temp.line_reads_call('get_economic_source_lines',jsonb_build_object('companyId',company,'customerSourceId','line-reads-customer','kind','sale'));
 perform pg_temp.line_reads_assert(result->>'total'='2','customer and kind AND');
 result:=pg_temp.line_reads_call('get_economic_source_lines',jsonb_build_object('companyId',company,'kind','purchase','q','spd-77'));
 perform pg_temp.line_reads_assert(result->>'total'='0','all filters AND');
 reversed_ids:=array[purchase,spd,latest];
 result:=pg_temp.line_reads_call('get_economic_source_lines',jsonb_build_object('companyId',company,'ids',to_jsonb(reversed_ids)));
 perform pg_temp.line_reads_assert(result->>'limit'='3','ids default limit');
 select jsonb_agg(x->>'id' order by ord) into ordered_ids from jsonb_array_elements(result->'rows') with ordinality a(x,ord);
 perform pg_temp.line_reads_assert(ordered_ids=to_jsonb(reversed_ids),'caller ids order');
 result:=pg_temp.line_reads_call('get_economic_source_lines',jsonb_build_object('companyId',company,'ids',to_jsonb(reversed_ids),'limit',1,'offset',1));
 perform pg_temp.line_reads_assert(result->>'total'='3' and result#>>'{rows,0,id}'=spd::text and jsonb_array_length(result->'rows')=1,'ids pagination');
 -- Helper independently preserves input order, including repeated requested IDs.
 select jsonb_agg(x->'id' order by ord) into ordered_ids
 from jsonb_array_elements(private.stockflow_economic_line_rows(array[purchase,spd,purchase])) with ordinality a(x,ord);
 perform pg_temp.line_reads_assert(ordered_ids=to_jsonb(array[purchase,spd,purchase]),'helper ordinality');

 raise notice 'Economics line reads phase: deterministic source paging';
 n:=jsonb_array_length(expected);
 for i in 0..n-1 loop
  result:=pg_temp.line_reads_call('get_economic_source_lines',jsonb_build_object('companyId',company,'limit',1,'offset',i));
  perform pg_temp.line_reads_assert(result->>'total'='3' and result->>'limit'='1' and (result->>'offset')::integer=i and jsonb_array_length(result->'rows')=1,'page metadata');
  walked:=walked||(result->'rows');
 end loop;
 select jsonb_agg(to_jsonb(l.id) order by v.business_date desc,v.source_id,l.line_key,l.id) into ordered_ids
 from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where l.id=any(included);
 select jsonb_agg(x->'id' order by ord) into result from jsonb_array_elements(walked) with ordinality a(x,ord);
 perform pg_temp.line_reads_assert(result=ordered_ids,'documented paging order, each candidate once');
 result:=pg_temp.line_reads_call('get_economic_source_lines',jsonb_build_object('companyId',company,'offset',3));
 perform pg_temp.line_reads_assert(result->'rows'='[]'::jsonb and result->>'total'='3','empty final page');

 raise notice 'Economics line reads phase: exceptions multiset and groups';
 result:=pg_temp.line_reads_call('get_economic_exceptions');
 perform pg_temp.line_reads_assert(result->>'limit'='200' and result->>'offset'='0','exceptions defaults');
 n:=(result->>'total')::integer; groups:=result->'groups';
 i:=0;
 while i<n loop
  result:=pg_temp.line_reads_call('get_economic_exceptions',jsonb_build_object('limit',2,'offset',i));
  perform pg_temp.line_reads_assert((result->>'total')::integer=n and result->>'limit'='2' and (result->>'offset')::integer=i and result->'groups'=groups,'exceptions page metadata and global groups');
  exceptions_walked:=exceptions_walked||(result->'rows'); i:=i+2;
 end loop;
 select coalesce(jsonb_agg(x order by x::text),'[]'::jsonb) into expected from jsonb_array_elements(full_doc->'exceptions') x;
 select coalesce(jsonb_agg(x order by x::text),'[]'::jsonb) into result from jsonb_array_elements(exceptions_walked) x;
 perform pg_temp.line_reads_assert(result=expected,'exceptions exact multiset');
 select coalesce(jsonb_agg(x order by x->>'date' desc nulls last,x->>'sourceId',x->>'sourceLineId' nulls last,x::text),'[]'::jsonb) into expected from jsonb_array_elements(full_doc->'exceptions') x;
 perform pg_temp.line_reads_assert(exceptions_walked=expected,'exceptions page order');
 perform pg_temp.line_reads_assert((select coalesce(sum((x->>'count')::bigint),0) from jsonb_array_elements(groups) x)=n,'groups count total');
 for g in select value from jsonb_array_elements(groups) loop
  perform pg_temp.line_reads_assert(
   (g->>'netSalesPaise')::numeric=(select sum((x->>'netSalesPaise')::numeric) from jsonb_array_elements(exceptions_walked) x where x->>'status' is not distinct from g->>'status' and x->>'reason' is not distinct from g->>'reason')
   and (g->>'count')::bigint=(select count(*) from jsonb_array_elements(exceptions_walked) x where x->>'status' is not distinct from g->>'status' and x->>'reason' is not distinct from g->>'reason'),'group sum and count');
 end loop;
 select jsonb_agg(x order by (x->>'count')::bigint desc,x->>'status',x->>'reason') into result from jsonb_array_elements(groups) x;
 perform pg_temp.line_reads_assert(result=groups,'group order');

 raise notice 'Economics line reads phase: payload validation';
 for payload in select x from (values
  ('{"unknown":1}'::jsonb),('{"kind":"x"}'),('{"q":""}'),
  (jsonb_build_object('q',repeat('x',81))),('{"ids":[]}'),
  (jsonb_build_object('ids',to_jsonb(array_fill(spd,array[201])))),
  ('{"ids":["not-a-uuid"]}'),('{"limit":0}'),('{"limit":201}'),('{"offset":-1}'),
  ('{"companyId":""}'),('{"customerSourceId":null}'),('{"productId":12}'),
  (jsonb_build_object('companyId',repeat('x',241))),
  ('{"ids":[null]}'),('{"ids":"bad"}'),('{"limit":1.5}'),('{"offset":10001}'),
  ('{"q":null}'),('[]'),('null')
 ) invalid(x) loop
  begin
   perform pg_temp.line_reads_call('get_economic_source_lines',payload);
   raise exception 'Invalid source payload accepted: %',payload;
  exception when sqlstate '22023' then null; end;
 end loop;
 for payload in select x from (values
  ('{"limit":501}'::jsonb),('{"unknown":1}'),('{"limit":0}'),('{"offset":-1}'),
  ('{"offset":100001}'),('{"limit":"2"}'),('{"offset":null}'),('[]')
 ) invalid(x) loop
  begin
   perform pg_temp.line_reads_call('get_economic_exceptions',payload);
   raise exception 'Invalid exceptions payload accepted: %',payload;
  exception when sqlstate '22023' then null; end;
 end loop;

 raise notice 'Economics line reads phase: gateway access and delegation';
 foreach action in array array['get_economic_source_lines','get_economic_exceptions'] loop
  foreach actor in array array['line-reads-sales@test.local','line-reads-ops@test.local'] loop
   begin
    perform public.stockflow_economics_gateway('line-reads-key',actor,action,'{}');
    raise exception 'Restricted member accepted: %',actor;
   exception when sqlstate '42501' then null; end;
  end loop;
  begin
   perform public.stockflow_economics_gateway('wrong-key','line-reads-admin@test.local',action,'{}');
   raise exception 'Wrong gateway key accepted';
  exception when sqlstate '42501' then null; end;
  perform public.stockflow_economics_gateway('line-reads-key','line-reads-admin@test.local',action,'{}');
  perform pg_temp.line_reads_call(action);
 end loop;
 perform pg_temp.line_reads_call('get_data_checks');
 result:=pg_temp.line_reads_call('get_instrument_economics','{"view":"summary"}');
 perform pg_temp.line_reads_assert(result->>'readView'='summary','summary delegation');

 raise notice 'Economics line reads phase: settings and privileges';
 perform pg_temp.line_reads_assert((select 'statement_timeout=20s'=any(proconfig) from pg_proc where oid='public.stockflow_economics_gateway(text,text,text,jsonb)'::regprocedure),'gateway timeout');
 foreach db_role in array array['anon','authenticated'] loop
  perform pg_temp.line_reads_assert(not has_function_privilege(db_role,'public.stockflow_economics_gateway(text,text,text,jsonb)','EXECUTE'),'gateway privilege '||db_role);
  perform pg_temp.line_reads_assert(not has_function_privilege(db_role,'public.stockflow_economics_gateway_before_line_reads(text,text,text,jsonb)','EXECUTE'),'wrapped gateway privilege '||db_role);
 end loop;
 foreach signature in array array['private.stockflow_economic_line_rows(uuid[])','private.stockflow_economic_source_lines_read(jsonb)','private.stockflow_economic_exceptions_read(jsonb)'] loop
  foreach db_role in array array['anon','authenticated','service_role'] loop
   perform pg_temp.line_reads_assert(not has_function_privilege(db_role,signature,'EXECUTE'),'private privilege '||signature||' '||db_role);
  end loop;
 end loop;
 perform pg_temp.line_reads_assert(has_function_privilege('service_role','public.stockflow_economics_gateway(text,text,text,jsonb)','EXECUTE'),'service gateway grant');
 raise notice 'Economics line reads phase: complete (rollback follows)';
end $test$;
rollback;

