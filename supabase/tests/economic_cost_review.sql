-- Disposable replay only; all fixtures and gateway changes roll back.
begin;
set local statement_timeout='120s';
set local lock_timeout='10s';
create function pg_temp.cr_assert(ok boolean,label text) returns void language plpgsql as $$
begin
 if ok is distinct from true then raise exception 'Economics cost review: %',label; end if;
end $$;
create function pg_temp.cr_constraints(relation regclass) returns void language plpgsql as $$
declare c record;
begin
 for c in select conname,pg_get_constraintdef(oid) definition from pg_constraint where conrelid=relation order by conname loop
  raise notice 'Fixture constraint %.%: %',relation,c.conname,c.definition;
 end loop;
end $$;
create function pg_temp.cr_call(action text,payload jsonb default '{}'::jsonb) returns jsonb language sql as $$
 select public.stockflow_economics_gateway('cr-key','cr-manager@test.local',action,payload)
$$;
update private.stockflow_gateway_config set secret_sha256=encode(extensions.digest('cr-key','sha256'),'hex') where name='orders';
select pg_temp.cr_constraints('public.stockflow_members');
-- Valid role/roles; active status; unique normalized emails.
insert into public.stockflow_members(email,role,roles,status) values
 ('cr-manager@test.local','management',array['management'],'active'),
 ('cr-admin@test.local','administrator',array['administrator'],'active'),
 ('cr-accounts@test.local','accounts',array['accounts'],'active'),
 ('cr-sales@test.local','sales',array['sales'],'active'),
 ('cr-ops@test.local','operations',array['operations'],'active');
do $test$
declare
 company_a text:='cr-a-'||extensions.gen_random_uuid()::text;
 company_b text:='cr-b-'||extensions.gen_random_uuid()::text;
 run uuid; customer uuid; target uuid; voucher uuid; line_id uuid; fixture record;
 s1 uuid; s2 uuid; credit uuid; p1 uuid; p2 uuid;
 result jsonb; review jsonb; full_doc jsonb; refs_payload jsonb; payload jsonb; row_doc jsonb; expected jsonb;
 actor text; action text; signature text; db_role text; keys text[]; expected_keys text[];
begin
 raise notice 'Economics cost review phase: constraint-checked fixtures';
 select id into run from private.stockflow_economic_runs where active;
 if run is null then
  perform pg_temp.cr_constraints('private.stockflow_economic_runs');
  -- Unique active=true; non-null actor; UUID generated PK; engine default economics-v1.
  insert into private.stockflow_economic_runs(active,actor) values(true,'cr-test') returning id into run;
 end if;
 perform pg_temp.cr_constraints('private.stockflow_customers');
 -- Name 2..160; required creator; generated UUID PK.
 insert into private.stockflow_customers(name,created_by_email) values('Cost review customer','cr-manager@test.local') returning id into customer;
 perform pg_temp.cr_constraints('private.stockflow_economic_customer_identities');
 -- Unique company/source and company/customer; customer FK.
 insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
 values(company_a,'C1',customer,'cr-manager@test.local');
 perform pg_temp.cr_constraints('private.stockflow_economic_targets');
 -- group iff installation null; proposed approval; bounded strings; customer and triple identity FKs.
 insert into private.stockflow_economic_targets(kind,name,company_id,customer_id,customer_source_id,site_id,model_id,effective_from,approval,created_by)
 values('group','Cost review group',company_a,customer,'C1','cr-site','cr-model','2026-03-01','proposed','cr-manager@test.local') returning id into target;
 for fixture in select * from (values
  (company_a,'S1',0,'sale',false,'2026-03-10'::date,'C1','nos',2,'B1','cost_unavailable'),
  (company_a,'S2',0,'sale',false,'2026-03-20'::date,'C1','nos',1,'B1','verified'),
  (company_a,'S3',0,'sale',true,'2026-03-11'::date,'C1','nos',1,'B1','cost_unavailable'),
  (company_a,'P1',0,'purchase',false,'2026-03-01'::date,null,'nos',1,'B1',null),
  (company_a,'P1',1,'purchase',false,'2026-03-01'::date,null,'nos',1,'B1',null),
  (company_a,'P2',0,'purchase',false,'2026-03-05'::date,null,'nos',1,'B2',null),
  (company_a,'P3',0,'purchase',false,'2026-03-15'::date,null,'nos',1,'B1',null),
  (company_a,'P4',0,'purchase',false,'2026-03-01'::date,null,'box',1,'B1',null),
  (company_b,'P5',0,'purchase',false,'2026-03-01'::date,null,'nos',1,'B1',null),
  (company_a,'credit',0,'credit',false,'2026-03-25'::date,'C1','nos',1,null,null),
  (company_a,'C2-sale',0,'sale',false,'2026-03-26'::date,'C2','nos',1,null,null)
 ) f(company,source_id,revision,kind,cancelled,business_date,customer_source_id,unit,quantity,batch,status) loop
  perform pg_temp.cr_constraints('private.stockflow_economic_source_vouchers');
  -- Unique company/source/revision; revision 0/1 >=0; sale/purchase/credit enum; default INR; required date/evidence.
  insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,kind,cancelled,evidence)
  values(fixture.company,fixture.source_id,fixture.revision,fixture.business_date,fixture.customer_source_id,fixture.kind,fixture.cancelled,
   case when fixture.source_id='credit' then '{}'::jsonb else jsonb_build_object('sourceReference','  CR-'||fixture.source_id||'  ') end) returning id into voucher;
  perform pg_temp.cr_constraints('private.stockflow_economic_source_lines');
  -- Voucher FK; unique line key 1; cr-p1 length 1..240; nos/box length 1..80; required numeric/evidence values.
  insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,batch_id,evidence)
  values(voucher,'1','cr-p1',fixture.quantity,fixture.unit,100,fixture.batch,'{}') returning id into line_id;
  if fixture.source_id='S1' then s1:=line_id;
  elsif fixture.source_id='S2' then s2:=line_id;
  elsif fixture.source_id='credit' then credit:=line_id;
  elsif fixture.source_id='P1' and fixture.revision=1 then p1:=line_id;
  elsif fixture.source_id='P2' then p2:=line_id; end if;
  if fixture.status is not null then
   perform pg_temp.cr_constraints('private.stockflow_economic_results');
   -- Run/line/target FKs; share 10000 in 1..10000; required status/reason; cost and GP null together.
   insert into private.stockflow_economic_results(run_id,source_line_id,target_id,status,reason,share_bps,quantity,revenue_paise,cost_paise,gp_paise)
   values(run,line_id,target,fixture.status,'Cost review fixture',10000,fixture.quantity,100,
    case when fixture.status='verified' then 50 end,case when fixture.status='verified' then 50 end);
  end if;
 end loop;
 raise notice 'Economics cost review phase: scope, parity, batches and row shape';
 review:=pg_temp.cr_call('get_economic_cost_review');
 perform pg_temp.cr_assert(review->>'salesTotal'='1' and jsonb_array_length(review->'sales')=1 and review#>>'{sales,0,id}'=s1::text,'only S1 pending');
 perform pg_temp.cr_assert(review->>'purchasesTotal'='2' and
  (select jsonb_agg(x->>'id' order by ord) from jsonb_array_elements(review->'purchases') with ordinality a(x,ord))=to_jsonb(array[p1::text,p2::text]),'P1 latest then P2, every batch');
 full_doc:=private.stockflow_economic_workspace_read('{management}',false);
 perform pg_temp.cr_assert((review->>'salesTotal')::bigint=(full_doc->>'todoCount')::bigint-
  (select count(*) from private.stockflow_economic_import_exceptions e where private.stockflow_economic_import_exception_open(e.id)),'todoCount sales parity');
 perform pg_temp.cr_assert(not exists(select 1 from jsonb_array_elements(full_doc->'sourceLines') x
  where x->>'kind'='purchase' and x->>'companyId'=company_a and x->>'productId'='cr-p1' and x->>'unit'='nos'
   and (x->>'date')::date<='2026-03-10'::date and not exists(select 1 from jsonb_array_elements(review->'purchases') y where y->>'id'=x->>'id')),'sourceLines purchase superset');
 select array_agg(k order by k) into expected_keys from jsonb_object_keys(private.stockflow_economic_line_rows(array[s1])->0) k;
 perform pg_temp.cr_assert(expected_keys @> array['voucherNumber','batchId','usedByInstrument'],'required row keys');
 for row_doc in select x from jsonb_array_elements((review->'sales')||(review->'purchases')) x loop
  select array_agg(k order by k) into keys from jsonb_object_keys(row_doc) k;
  perform pg_temp.cr_assert(keys=expected_keys,'exact line_rows shape');
 end loop;
 raise notice 'Economics cost review phase: line refs';
 refs_payload:=jsonb_build_object('companyId',company_a,'customerSourceId','C1');
 result:=pg_temp.cr_call('get_economic_line_refs',refs_payload);
 expected:=jsonb_build_array(jsonb_build_object('id',credit,'kind','credit','voucherNumber',null),
  jsonb_build_object('id',s2,'kind','sale','voucherNumber','CR-S2'),jsonb_build_object('id',s1,'kind','sale','voucherNumber','CR-S1'));
 perform pg_temp.cr_assert(result->'rows'=expected and result->>'total'='3' and result->>'limit'='5000','refs scope, exact shape, trimmed/null number and descending date');
 raise notice 'Economics cost review phase: invalid payloads';
 foreach action in array array['get_economic_cost_review','get_economic_line_refs'] loop
  for payload in select x from (values ('{"x":1}'::jsonb),('[]'),('null'),('{}'),
   ('{"companyId":"A"}'),('{"companyId":"","customerSourceId":"C1"}'),
   (jsonb_build_object('companyId',repeat('x',241),'customerSourceId','C1')),
   ('{"companyId":1,"customerSourceId":"C1"}'),('{"companyId":"A","customerSourceId":"C1","extra":1}'),
   ('{"companyId":"A","customerSourceId":""}'),('{"companyId":"A","customerSourceId":1}'),
   (jsonb_build_object('companyId','A','customerSourceId',repeat('x',241)))) invalid(x) loop
   if action='get_economic_cost_review' and payload='{}'::jsonb then continue; end if;
   begin
    perform pg_temp.cr_call(action,payload);
    raise exception 'Invalid payload accepted: % %',action,payload;
   exception when sqlstate '22023' then
    perform pg_temp.cr_assert(sqlerrm=case when action='get_economic_cost_review' then 'Invalid cost review payload' else 'Invalid line refs payload' end,'validation message');
   end;
  end loop;
  raise notice 'Economics cost review phase: access for %',action;
  foreach actor in array array['manager','admin','accounts'] loop
   perform public.stockflow_economics_gateway('cr-key','cr-'||actor||'@test.local',action,case when action='get_economic_cost_review' then '{}'::jsonb else refs_payload end);
  end loop;
  foreach actor in array array['sales','ops'] loop
   begin
    perform public.stockflow_economics_gateway('cr-key','cr-'||actor||'@test.local',action,'{"bad":1}');
    raise exception 'Restricted role accepted';
   exception when sqlstate '42501' then
    perform pg_temp.cr_assert(sqlerrm='Economics evidence is restricted','role before payload');
   end;
  end loop;
  begin
   perform public.stockflow_economics_gateway('wrong-key','cr-sales@test.local',action,'{"bad":1}');
   raise exception 'Wrong key accepted';
  exception when sqlstate '42501' then
   perform pg_temp.cr_assert(sqlerrm='Unauthorized gateway','key first');
  end;
 end loop;
 raise notice 'Economics cost review phase: settings, privileges and routing';
 perform pg_temp.cr_assert((select 'statement_timeout=20s'=any(proconfig) from pg_proc where oid='public.stockflow_economics_gateway(text,text,text,jsonb)'::regprocedure),'gateway timeout');
 foreach signature in array array['public.stockflow_economics_gateway(text,text,text,jsonb)','public.stockflow_economics_gateway_before_cost_review(text,text,text,jsonb)'] loop
  foreach db_role in array array['anon','authenticated'] loop
   perform pg_temp.cr_assert(not has_function_privilege(db_role,signature,'EXECUTE'),'gateway privilege '||db_role);
  end loop;
  perform pg_temp.cr_assert(not exists(select 1 from pg_proc pr cross join lateral aclexplode(coalesce(pr.proacl,acldefault('f',pr.proowner))) acl
   where pr.oid=signature::regprocedure and acl.grantee=0 and acl.privilege_type='EXECUTE'),'no public gateway grant');
 end loop;
 foreach signature in array array['private.stockflow_economic_cost_review_read(jsonb)','private.stockflow_economic_line_refs_read(jsonb)'] loop
  foreach db_role in array array['anon','authenticated','service_role'] loop
   perform pg_temp.cr_assert(not has_function_privilege(db_role,signature,'EXECUTE'),'private privilege '||db_role);
  end loop;
 end loop;
 perform pg_temp.cr_assert(has_function_privilege('service_role','public.stockflow_economics_gateway(text,text,text,jsonb)','EXECUTE'),'service gateway grant');
 result:=pg_temp.cr_call('get_economic_products',jsonb_build_object('companyId',company_a));
 perform pg_temp.cr_assert(result->>'total'='1','products still routed');
 result:=pg_temp.cr_call('get_economic_source_lines',refs_payload);
 perform pg_temp.cr_assert(result->>'total'='3','source lines still routed');
 result:=pg_temp.cr_call('get_instrument_economics','{"view":"summary"}');
 perform pg_temp.cr_assert(result->>'readView'='summary','summary still routed');
 raise notice 'Economics cost review phase: no active run';
 update private.stockflow_economic_runs set active=false where id=run;
 result:=pg_temp.cr_call('get_economic_cost_review');
 perform pg_temp.cr_assert(result='{"sales":[],"salesTotal":0,"purchases":[],"purchasesTotal":0}'::jsonb,'empty review without run');
 result:=pg_temp.cr_call('get_economic_line_refs',refs_payload);
 perform pg_temp.cr_assert(result='{"rows":[],"total":0,"limit":5000}'::jsonb,'empty refs without run');
 raise notice 'Economics cost review phase: complete (rollback follows)';
end $test$;
rollback;
