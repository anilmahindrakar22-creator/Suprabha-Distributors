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
 ('line-reads-accounts@test.local','accounts',array['accounts'],'active'),
 ('line-reads-sales@test.local','sales',array['sales'],'active'),
 ('line-reads-ops@test.local','operations',array['operations'],'active');

do $test$
declare
 company text:='line-reads-'||extensions.gen_random_uuid()::text;
 fixture record; voucher uuid; line_id uuid; run uuid; customer uuid; target uuid;
 excluded uuid[]:='{}'; included uuid[]:='{}'; reversed_ids uuid[];
 spd uuid; latest uuid; purchase uuid; labelled uuid; purchase_return uuid;
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
  ('spd',0,'sale',false,'2026-12-20'::date,'{"sourceReference":"SPD-7781"}'::jsonb,'spd-product','{}'::jsonb,1,'pack',100),
  ('revision',0,'sale',false,'2026-12-21'::date,'{}'::jsonb,'old-product','{}'::jsonb,1,'pack',100),
  ('revision',1,'sale',false,'2026-12-21'::date,'{}'::jsonb,'label-product','{"label":"Speed Reagent 50%_x"}'::jsonb,1,'pack',100),
  ('cancelled',0,'sale',true,'2026-12-22'::date,'{}'::jsonb,'cancelled-product','{}'::jsonb,1,'pack',100),
  ('purchase',0,'purchase',false,'2026-12-19'::date,'{"supplierName":"Speed Supplies"}'::jsonb,'purchase-product','{}'::jsonb,2,'box',250),
  ('purchase-return',0,'purchase_return',false,'2026-12-18'::date,'{}'::jsonb,'purchase-return-product','{}'::jsonb,1,'pack',50)
 ) f(source_id,revision,kind,cancelled,business_date,voucher_evidence,product_id,line_evidence,quantity,unit,net_sales_paise) loop
  perform pg_temp.line_reads_constraints('private.stockflow_economic_source_vouchers');
  -- Revision 0/1 >=0; sale/purchase/purchase_return enum; default INR; unique company/source/revision.
  insert into private.stockflow_economic_source_vouchers
   (company_id,source_id,source_revision,business_date,customer_source_id,kind,cancelled,evidence)
  values(company,fixture.source_id,fixture.revision,fixture.business_date,'line-reads-customer',
   fixture.kind,fixture.cancelled,fixture.voucher_evidence) returning id into voucher;
  perform pg_temp.line_reads_constraints('private.stockflow_economic_source_lines');
  -- Voucher FK; unique voucher/line_key; product 1..240 and unit 1..80; required numeric values.
  insert into private.stockflow_economic_source_lines
  (voucher_id,line_key,product_id,quantity,unit,net_sales_paise,batch_id,evidence)
  values(voucher,'1',fixture.product_id,fixture.quantity,fixture.unit,fixture.net_sales_paise,
   case when fixture.source_id='spd' then 'SER-9001' end,fixture.line_evidence) returning id into line_id;
  if fixture.cancelled or (fixture.source_id='revision' and fixture.revision=0) then
   excluded:=array_append(excluded,line_id);
  else
   included:=array_append(included,line_id);
   case fixture.source_id when 'spd' then spd:=line_id; when 'revision' then latest:=line_id; labelled:=line_id;
    when 'purchase' then purchase:=line_id; when 'purchase-return' then purchase_return:=line_id; end case;
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
 -- A real acquisition makes the purchase line used without changing the row expression.
 perform pg_temp.line_reads_constraints('private.stockflow_customers');
 -- Name length 2..160; required creator; generated UUID PK.
 insert into private.stockflow_customers(name,created_by_email)
 values('Line reads customer','line-reads-manager@test.local') returning id into customer;
 perform pg_temp.line_reads_constraints('private.stockflow_economic_customer_identities');
 -- Unique company/source and company/customer; customer FK supplies the target's triple FK.
 insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
 values(company,'line-reads-customer',customer,'line-reads-manager@test.local');
 perform pg_temp.line_reads_constraints('private.stockflow_economic_targets');
 -- group iff installation is null; proposed enum; bounded strings; valid customer/identity FKs.
 insert into private.stockflow_economic_targets
  (kind,name,company_id,customer_id,customer_source_id,site_id,model_id,effective_from,approval,created_by)
 values('group','Line reads acquisition group',company,customer,'line-reads-customer',
  'line-reads-site','line-reads-model','2026-12-19','proposed','line-reads-manager@test.local') returning id into target;
 perform pg_temp.line_reads_constraints('private.stockflow_economic_acquisition_links');
 -- Target PK/FK, unique purchase-line FK and company/source/line tuple; required actor/reason.
 insert into private.stockflow_economic_acquisition_links
  (target_id,purchase_line_id,company_id,source_id,line_key,actor,reason)
 values(target,purchase,company,'purchase','1','line-reads-manager@test.local','Line reads acquisition fixture');
 perform pg_temp.line_reads_constraints('private.stockflow_economic_import_exceptions');
 -- Identity PK; reason/evidence NOT NULL; fixture source remains unresolved.
 insert into private.stockflow_economic_import_exceptions(company_id,source_id,reason,evidence)
 values(company,'line-reads-import','Line reads import fixture','{"sourceReference":"LINE-READS-IMPORT"}');

 raise notice 'Economics line reads phase: full-read parity, scope and filters';
 full_doc:=private.stockflow_economic_workspace_read('{management}',false);
 select coalesce(jsonb_agg(x),'[]'::jsonb) into expected
 from jsonb_array_elements(full_doc->'sourceLines') x where x->>'companyId'=company;
 result:=pg_temp.line_reads_call('get_economic_source_lines',jsonb_build_object('companyId',company));
 perform pg_temp.line_reads_assert((result->>'total')::integer=jsonb_array_length(expected) and (result->>'total')::integer=4,'company total');
 perform pg_temp.line_reads_assert(result->>'limit'='50' and result->>'offset'='0','source defaults');
 for row_doc in select value from jsonb_array_elements(result->'rows') loop
  perform pg_temp.line_reads_assert(row_doc=(select x from jsonb_array_elements(expected) x where x->>'id'=row_doc->>'id'),'exact source object parity');
  perform pg_temp.line_reads_assert(private.stockflow_economic_line_used((row_doc->>'id')::uuid)=(row_doc->>'usedByInstrument')::boolean,'used helper/full row parity for every candidate');
 end loop;
 perform pg_temp.line_reads_assert(private.stockflow_economic_line_used(purchase),'acquisition fixture is used');
 perform pg_temp.line_reads_assert(not private.stockflow_economic_line_used(spd),'sale fixture is unused');
 result:=pg_temp.line_reads_call('get_economic_source_lines',jsonb_build_object('ids',to_jsonb(excluded)));
 perform pg_temp.line_reads_assert(result->'rows'='[]'::jsonb and result->>'total'='0','excluded IDs cannot bypass scope');
 perform pg_temp.line_reads_assert(private.stockflow_economic_line_rows(excluded)='[]'::jsonb,'row helper scope');

 for fixture in select * from (values
  ('{"kind":"purchase"}'::jsonb,purchase),
  ('{"kind":"purchase_return"}'::jsonb,purchase_return),
  ('{"q":"spd-77"}'::jsonb,spd),
  ('{"q":"spd-product 7781"}'::jsonb,spd),
  ('{"q":"7781 spd-product"}'::jsonb,spd),
  ('{"q":"ser-9001"}'::jsonb,spd),
  ('{"q":"2026-12-20"}'::jsonb,spd),
  ('{"q":"speed supplies"}'::jsonb,purchase),
  ('{"q":"50%_"}'::jsonb,labelled),
  ('{"q":"50%"}'::jsonb,labelled),
  ('{"q":"0%_x"}'::jsonb,labelled),
  ('{"q":"%"}'::jsonb,labelled),
  ('{"productId":"purchase-product"}'::jsonb,purchase)
 ) f(filter,expected_id) loop
  result:=pg_temp.line_reads_call('get_economic_source_lines',fixture.filter||jsonb_build_object('companyId',company));
  perform pg_temp.line_reads_assert(result->>'total'='1' and result#>>'{rows,0,id}'=fixture.expected_id::text,'filter '||fixture.filter::text);
 end loop;
 result:=pg_temp.line_reads_call('get_economic_source_lines',jsonb_build_object('companyId',company,'q','no-such-word'));
 perform pg_temp.line_reads_assert(result->>'total'='0','word matching no searchable field');
 result:=pg_temp.line_reads_call('get_economic_source_lines',jsonb_build_object('companyId',company,'q','zzqqnomatch'));
 perform pg_temp.line_reads_assert(result->>'total'='0','unmatched word excludes fixtures with missing party names and null batch');
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

 raise notice 'Economics line reads phase: consumer filters, positive and negative';
 for fixture in select * from (values
  ('{"unit":"box"}'::jsonb,array[purchase]),
  ('{"unit":"pack"}'::jsonb,array[spd,latest,purchase_return]),
  ('{"unit":"BOX"}'::jsonb,array[]::uuid[]),
  ('{"quantityOne":true}'::jsonb,array[spd,latest,purchase_return]),
  ('{"quantityOne":false}'::jsonb,included),
  ('{"quantityOne":true,"productId":"purchase-product"}'::jsonb,array[]::uuid[]),
  ('{"minNetSalesPaise":"0"}'::jsonb,included),
  ('{"minNetSalesPaise":"100"}'::jsonb,array[spd,latest,purchase]),
  ('{"minNetSalesPaise":"250"}'::jsonb,array[purchase]),
  ('{"minNetSalesPaise":"251"}'::jsonb,array[]::uuid[]),
  ('{"minNetSalesPaise":"999999999999999999"}'::jsonb,array[]::uuid[]),
  ('{"dateFrom":"2026-12-21"}'::jsonb,array[latest]),
  ('{"dateFrom":"2026-12-22"}'::jsonb,array[]::uuid[]),
  ('{"dateTo":"2026-12-18"}'::jsonb,array[purchase_return]),
  ('{"dateTo":"2026-12-17"}'::jsonb,array[]::uuid[]),
  ('{"dateFrom":"2026-12-19","dateTo":"2026-12-19"}'::jsonb,array[purchase]),
  ('{"unusedOnly":true}'::jsonb,array[spd,latest,purchase_return]),
  ('{"unusedOnly":false}'::jsonb,included),
  ('{"unusedOnly":true,"productId":"purchase-product"}'::jsonb,array[]::uuid[]),
  (jsonb_build_object('unusedOnly',true,'ids',to_jsonb(array[purchase])),array[]::uuid[]),
  ('{"unit":"box","quantityOne":false,"minNetSalesPaise":"250","dateFrom":"2026-12-19","dateTo":"2026-12-19","unusedOnly":false}'::jsonb,array[purchase]),
  ('{"unit":"box","quantityOne":true,"minNetSalesPaise":"250","dateFrom":"2026-12-19","dateTo":"2026-12-19","unusedOnly":false}'::jsonb,array[]::uuid[])
 ) f(filter,expected_ids) loop
  result:=pg_temp.line_reads_call('get_economic_source_lines',fixture.filter||jsonb_build_object('companyId',company));
  select coalesce(jsonb_agg(x->>'id' order by x->>'id'),'[]'::jsonb) into ordered_ids
   from jsonb_array_elements(result->'rows') x;
  select coalesce(jsonb_agg(id::text order by id::text),'[]'::jsonb) into row_doc
   from unnest(fixture.expected_ids) a(id);
  perform pg_temp.line_reads_assert(ordered_ids=row_doc and (result->>'total')::integer=cardinality(fixture.expected_ids),'consumer filter '||fixture.filter::text);
 end loop;

 raise notice 'Economics line reads phase: deterministic source paging';
 n:=jsonb_array_length(expected);
 for i in 0..n-1 loop
  result:=pg_temp.line_reads_call('get_economic_source_lines',jsonb_build_object('companyId',company,'limit',1,'offset',i));
  perform pg_temp.line_reads_assert((result->>'total')::integer=n and result->>'limit'='1' and (result->>'offset')::integer=i and jsonb_array_length(result->'rows')=1,'page metadata');
  walked:=walked||(result->'rows');
 end loop;
 select jsonb_agg(to_jsonb(l.id) order by v.business_date desc,v.source_id,l.line_key,l.id) into ordered_ids
 from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where l.id=any(included);
 select jsonb_agg(x->'id' order by ord) into result from jsonb_array_elements(walked) with ordinality a(x,ord);
 perform pg_temp.line_reads_assert(result=ordered_ids,'documented paging order, each candidate once');
 result:=pg_temp.line_reads_call('get_economic_source_lines',jsonb_build_object('companyId',company,'offset',n));
 perform pg_temp.line_reads_assert(result->'rows'='[]'::jsonb and (result->>'total')::integer=n,'empty final page');

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

 raise notice 'Economics line reads phase: exception status filters keep global groups';
 foreach actor in array array['cost_unavailable','unattributed','import_rejected','line-reads-no-such-status'] loop
  select coalesce(jsonb_agg(x order by x->>'date' desc nulls last,x->>'sourceId',x->>'sourceLineId' nulls last,x::text),'[]'::jsonb)
   into expected from jsonb_array_elements(full_doc->'exceptions') x where x->>'status'=actor;
  n:=jsonb_array_length(expected); i:=0; exceptions_walked:='[]';
  loop
   result:=pg_temp.line_reads_call('get_economic_exceptions',jsonb_build_object('status',actor,'limit',2,'offset',i));
   perform pg_temp.line_reads_assert((result->>'total')::integer=n and result->'groups'=groups
    and result->>'limit'='2' and (result->>'offset')::integer=i,'filtered status total and global groups '||actor);
   perform pg_temp.line_reads_assert(not exists(select 1 from jsonb_array_elements(result->'rows') x where x->>'status' is distinct from actor),'only matching exception status');
   exceptions_walked:=exceptions_walked||(result->'rows'); i:=i+2;
   exit when i>=n;
  end loop;
  perform pg_temp.line_reads_assert(exceptions_walked=expected,'filtered status paging '||actor);
 end loop;

 raise notice 'Economics line reads phase: payload validation';
 for payload in select x from (values
  ('{"unknown":1}'::jsonb),('{"kind":"x"}'),('{"q":""}'),('{"q":"one two three four five six seven"}'),
  (jsonb_build_object('q',repeat('x',81))),('{"ids":[]}'),
  (jsonb_build_object('ids',to_jsonb(array_fill(spd,array[201])))),
  ('{"ids":["not-a-uuid"]}'),('{"limit":0}'),('{"limit":201}'),('{"offset":-1}'),
  ('{"companyId":""}'),('{"customerSourceId":null}'),('{"productId":12}'),
  (jsonb_build_object('companyId',repeat('x',241))),
  ('{"ids":[null]}'),('{"ids":"bad"}'),('{"limit":1.5}'),('{"offset":10001}'),
  ('{"q":null}'),('[]'),('null'),
  ('{"unit":""}'),('{"unit":null}'),('{"unit":2}'),(jsonb_build_object('unit',repeat('x',81))),
  ('{"quantityOne":"true"}'),('{"quantityOne":1}'),('{"quantityOne":null}'),
  ('{"unusedOnly":"false"}'),('{"unusedOnly":0}'),('{"unusedOnly":null}'),
  ('{"minNetSalesPaise":"abc"}'),('{"minNetSalesPaise":100}'),('{"minNetSalesPaise":null}'),
  ('{"minNetSalesPaise":""}'),('{"minNetSalesPaise":"-1"}'),('{"minNetSalesPaise":"1.5"}'),
  ('{"minNetSalesPaise":"1234567890123456789"}'),
  ('{"dateFrom":"2026-13-01"}'),('{"dateTo":"2026-02-30"}'),
  ('{"dateFrom":"2026-12-20","dateTo":"2026-12-19"}'),
  ('{"dateFrom":"2026-1-01"}'),('{"dateTo":"tomorrow"}'),
  ('{"dateFrom":null}'),('{"dateTo":20261219}')
 ) invalid(x) loop
  begin
   perform pg_temp.line_reads_call('get_economic_source_lines',payload);
   raise exception 'Invalid source payload accepted: %',payload;
  exception when sqlstate '22023' then null; end;
 end loop;
 for payload in select x from (values
  ('{"limit":501}'::jsonb),('{"unknown":1}'),('{"limit":0}'),('{"offset":-1}'),
  ('{"offset":100001}'),('{"limit":"2"}'),('{"offset":null}'),('[]'),
  ('{"status":""}'),('{"status":" "}'),('{"status":null}'),('{"status":true}'),
  (jsonb_build_object('status',repeat('x',61)))
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
  perform public.stockflow_economics_gateway('line-reads-key','line-reads-accounts@test.local',action,'{}');
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
 foreach signature in array array['private.stockflow_economic_line_rows(uuid[])','private.stockflow_economic_line_used(uuid)','private.stockflow_economic_source_lines_read(jsonb)','private.stockflow_economic_exceptions_read(jsonb)'] loop
  foreach db_role in array array['anon','authenticated','service_role'] loop
   perform pg_temp.line_reads_assert(not has_function_privilege(db_role,signature,'EXECUTE'),'private privilege '||signature||' '||db_role);
  end loop;
 end loop;
 perform pg_temp.line_reads_assert(has_function_privilege('service_role','public.stockflow_economics_gateway(text,text,text,jsonb)','EXECUTE'),'service gateway grant');
 raise notice 'Economics line reads phase: complete (rollback follows)';
end $test$;
rollback;

