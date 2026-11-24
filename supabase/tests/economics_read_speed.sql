-- Disposable replay only: fixture writes and every comparison roll back.
begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

create function pg_temp.speed_assert(ok boolean,label text) returns void language plpgsql as $$
begin
 if ok is distinct from true then raise exception 'Economics speed: %',label;end if;
end$$;
create function pg_temp.speed_canonical(doc jsonb) returns jsonb language sql immutable as $$
 select case when jsonb_typeof(doc->'sourceLines')='array'
  then jsonb_set(doc,'{sourceLines}',coalesce((select jsonb_agg(e order by e->>'id',e::text) from jsonb_array_elements(doc->'sourceLines') e),'[]'::jsonb))
  else doc end
$$;

create function pg_temp.speed_parity(actual jsonb,expected jsonb,label text) returns void language plpgsql as $$
declare differing_key text;
begin
 -- sourceLines is aggregated without ORDER BY in both bodies: compare it as a multiset.
 if pg_temp.speed_canonical(actual) is distinct from pg_temp.speed_canonical(expected) then
  select k into differing_key from (
   select jsonb_object_keys(actual) k union select jsonb_object_keys(expected)
  ) keys where pg_temp.speed_canonical(actual)->k is distinct from pg_temp.speed_canonical(expected)->k order by k limit 1;
  raise exception 'Economics speed parity %: first differing top-level key %',label,coalesce(differing_key,'<whole value>');
 end if;
 perform pg_temp.speed_assert(jsonb_array_length(coalesce(actual->'sourceLines','[]'::jsonb))=jsonb_array_length(coalesce(expected->'sourceLines','[]'::jsonb)),label||' sourceLines count');
end$$;

do $test$
declare
 period_from date:=(date_trunc('month',private.stockflow_economic_business_date())-interval '1 month')::date;
 period_to date:=date_trunc('month',private.stockflow_economic_business_date())::date;
 d date; run uuid; inactive_run uuid; policy private.stockflow_economic_policy_versions%rowtype;
 customer uuid:=extensions.gen_random_uuid(); order_id uuid:=extensions.gen_random_uuid();
 installation1 uuid:=extensions.gen_random_uuid(); installation2 uuid:=extensions.gen_random_uuid();
 p1 uuid:=extensions.gen_random_uuid(); p2 uuid:=extensions.gen_random_uuid(); g uuid:=extensions.gen_random_uuid();
 token text:=extensions.gen_random_uuid()::text;
 company text; voucher uuid; line_id uuid; result_id uuid;
 a uuid; b uuid; c uuid; old_result uuid; gp_event uuid; s record;
 roles text[]; role_set text; mode text; new_doc jsonb; old_doc jsonb; target_doc jsonb;
 set_count bigint; helper_count bigint; differences bigint; group_gp numeric;
 test_role text; sig text; started timestamptz; elapsed_old interval; elapsed_new interval;
begin
 raise notice 'Economics speed phase: constraint-checked fixtures';
 d:=period_from+10; company:='speed-'||token;
 select id into run from private.stockflow_economic_runs where active;
 -- Foundation: runs active/actor NOT NULL; partial unique(active) permits one active run.
 if run is null then
  insert into private.stockflow_economic_runs(active,actor) values(true,'speed-test') returning id into run;
 end if;
 insert into private.stockflow_economic_runs(active,actor) values(false,'speed-test') returning id into inactive_run;
 select * into strict policy from private.stockflow_economic_policy_versions order by recorded_at desc,id desc limit 1;
 -- Customer name length 2..160; generated PK and company-scoped identity are unique.
 insert into private.stockflow_customers(id,name,created_by_email) values(customer,'Speed lab customer','speed-test');
 -- Foundation identity PK(company_id,source_id), unique(company_id,customer_id), triple FK source.
 insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
 values(company,'speed-customer',customer,'speed-test');
 -- Order source/status checks and status FK: phone/delivered; customer name 2..160.
 -- unique(created_by_email,idempotency_key) uses the generated token.
 insert into private.stockflow_orders(id,customer_id,customer_name,source,status,created_by_email,updated_by_email,idempotency_key)
 values(order_id,customer,'Speed lab customer','phone','delivered','speed-test','speed-test',token);
 -- Installation origin: non-null order, null historical origin columns.
 -- completed status and serial length 2..100; register trigger creates distinct instrument IDs.
 insert into private.stockflow_equipment_installations(id,order_id,tally_key,item_name,status,scheduled_date,serial_number,created_by_email,completed_at)
 values(installation1,order_id,'speed-instrument-a','Speed instrument A','completed',d-30,'SPA'||token,'speed-test',now()-interval '90 days'),
       (installation2,order_id,'speed-instrument-b','Speed instrument B','completed',d-30,'SPB'||token,'speed-test',now()-interval '90 days');
 -- Target kind/approval enum, name 2..200, company/source/site/model 1..240.
 -- placement iff installation present; distinct installations satisfy the exclusion.
 -- Distinct names include a token so existing replay data cannot create a tie.
 insert into private.stockflow_economic_targets(id,kind,name,company_id,customer_id,customer_source_id,site_id,model_id,installation_id,effective_from,approval,created_by)
 values(p1,'placement','Speed lab A '||token,company,customer,'speed-customer','speed-site','speed-model',installation1,d-30,'approved','speed-test'),
       (p2,'placement','Speed lab B '||token,company,customer,'speed-customer','speed-site','speed-model',installation2,d-30,'approved','speed-test'),
       (g,'group','Speed lab G '||token,company,customer,'speed-customer','speed-site','speed-group',null,d,'approved','speed-test');
 -- Member IDs differ; no existing membership for this generated placement; null end is valid.
 insert into private.stockflow_economic_group_members(group_id,placement_id,effective_from) values(g,p1,d);
 for s in select * from (values
  ('a',11,100,0,100,'verified',false,false),
  ('b',12,200,0,200,'verified',false,false),
  ('c',9,300,0,300,'verified',false,false),
  ('d',13,400,null,null,'cost_unavailable',false,false),
  ('p2',14,500,0,500,'verified',true,false),
  ('billing',15,600,0,600,'instrument_billing',false,false),
  ('old',11,700,0,700,'verified',false,true)
 ) fixture(label,day,revenue,cost,gp,status,second_target,old_run) loop
  -- Voucher revision >=0; sale enum; non-null evidence; unique company/source/revision.
  insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,site_id,kind,evidence)
  values(company,'speed-'||s.label,1,period_from+s.day,'speed-customer','speed-site','sale','{}') returning id into voucher;
  -- Line product length 1..240, unit 1..80; unique voucher/line_key; required numeric values.
  insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
  values(voucher,'1','speed-reagent',1,'pack',s.revenue,'{}') returning id into line_id;
  -- Results share 1..10000; cost/gp are either both null or both non-null.
  -- Status/reason are NOT NULL text (no enum CHECK); all FKs point to this fixture.
  insert into private.stockflow_economic_results(run_id,source_line_id,target_id,status,reason,share_bps,quantity,revenue_paise,cost_paise,gp_paise,recovery_origin_date)
  values(case when s.old_run then inactive_run else run end,line_id,case when s.second_target then p2 else p1 end,
   s.status,'Speed fixture',10000,1,s.revenue,s.cost,s.gp,
   case when s.label in ('a','billing','old') then d-1 when s.label='c' then d-2 else d end) returning id into result_id;
  case s.label when 'a' then a:=result_id;when 'b' then b:=result_id;when 'c' then c:=result_id;when 'old' then old_result:=result_id;else null;end case;
 end loop;
 -- Events target_id is NOT NULL in the shipped schema. Use P2 for a different
 -- direct owner while source-result ownership adds P1/G; no constraint is relaxed.
 -- gp enum, null reverses_id; unique request token; valid target/result FKs.
 -- First event tests direct/source deduplication (UNION rather than UNION ALL).
 insert into private.stockflow_economic_events(target_id,kind,amount_paise,effective_date,source_result_id,request_id,actor,reason)
 values(p1,'gp',30,period_from+16,a,token||':direct','speed-test','Speed direct GP'),
       (p2,'gp',90,period_from+16,old_result,token||':old','speed-test','Speed prior run GP');
 insert into private.stockflow_economic_events(target_id,kind,amount_paise,effective_date,source_result_id,request_id,actor,reason)
 values(p2,'gp',60,period_from+16,a,token||':source','speed-test','Speed source GP') returning id into gp_event;
 -- reversal iff reverses_id non-null; unique reverses_id references the GP above.
 -- source_result_id omitted, so the trailing query must resolve the parent.
 insert into private.stockflow_economic_events(target_id,kind,amount_paise,effective_date,reverses_id,request_id,actor,reason)
 values(p2,'reversal',-60,period_from+17,gp_event,token||':reverse','speed-test','Speed GP reversal');

 raise notice 'Economics speed phase: ownership preconditions';
 perform pg_temp.speed_assert(private.stockflow_economic_result_owned(a,g)
  and not private.stockflow_economic_result_owned(b,g) and not private.stockflow_economic_result_owned(c,g),'group ownership boundaries');

 raise notice 'Economics speed phase: grouped trailing GP versus helper for every target';
 with window_events as(
select e.id,e.target_id,e.amount_paise,coalesce(e.source_result_id,(select parent.source_result_id from private.stockflow_economic_events parent where parent.id=e.reverses_id)) src
 from private.stockflow_economic_events e where (e.kind='gp' or (e.kind='reversal' and exists(select 1 from private.stockflow_economic_events original_event where original_event.id=e.reverses_id and original_event.kind='gp'))) and e.effective_date>=period_to-make_interval(months=>policy.forecast_window_months) and e.effective_date<period_to
 ), event_owners as(
select we.id event_id,we.target_id owner_id,we.amount_paise from window_events we where we.target_id is not null
union
select we.id,r.target_id,we.amount_paise from window_events we
 join private.stockflow_economic_results r on r.id=we.src
 join private.stockflow_economic_source_lines l on l.id=r.source_line_id
 join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where r.target_id is not null
union
select we.id,gm.group_id,we.amount_paise from window_events we
 join private.stockflow_economic_results r on r.id=we.src
 join private.stockflow_economic_source_lines l on l.id=r.source_line_id
 join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id
 join private.stockflow_economic_group_members gm on gm.placement_id=r.target_id
 join private.stockflow_economic_targets g on g.id=gm.group_id and g.approval='approved'
 where r.target_id is not null and gm.effective_from<=private.stockflow_economic_business_date()
 and r.recovery_origin_date<gm.effective_from and v.business_date>=gm.effective_from
 ), trailing_totals as(
select owner_id,sum(amount_paise)::numeric/policy.forecast_window_months trailing_gp from event_owners group by owner_id
 ), comparison as(
  select f.id,coalesce(tt.trailing_gp,0) set_gp,
   coalesce((select sum(e.amount_paise)::numeric/policy.forecast_window_months from private.stockflow_economic_events e where (e.target_id=f.id or private.stockflow_economic_result_owned(coalesce(e.source_result_id,(select parent.source_result_id from private.stockflow_economic_events parent where parent.id=e.reverses_id)),f.id)) and (e.kind='gp' or (e.kind='reversal' and exists(select 1 from private.stockflow_economic_events original_event where original_event.id=e.reverses_id and original_event.kind='gp'))) and e.effective_date>=period_to-make_interval(months=>policy.forecast_window_months) and e.effective_date<period_to),0) helper_gp
  from private.stockflow_economic_targets f left join trailing_totals tt on tt.owner_id=f.id
 )
 select count(*) filter(where set_gp is distinct from helper_gp),max(set_gp) filter(where id=g)
 into differences,group_gp from comparison;
 perform pg_temp.speed_assert(differences=0 and group_gp<>0,'trailing GP set parity and non-zero group');
 perform pg_temp.speed_assert(group_gp=120::numeric/policy.forecast_window_months,'hand-computed group trailing GP includes inactive run');

 raise notice 'Economics speed phase: ownership set versus helper for every active-result/target pair';
 with owned as(
select r.id result_id,r.target_id owner_id from private.stockflow_economic_results r
 join private.stockflow_economic_source_lines l on l.id=r.source_line_id
 join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id
 where r.run_id=run and r.status<>'instrument_billing' and r.target_id is not null
union
select r.id,gm.group_id from private.stockflow_economic_results r
 join private.stockflow_economic_source_lines l on l.id=r.source_line_id
 join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id
 join private.stockflow_economic_group_members gm on gm.placement_id=r.target_id
 join private.stockflow_economic_targets g on g.id=gm.group_id and g.approval='approved'
 where r.run_id=run and r.status<>'instrument_billing' and r.target_id is not null
 and gm.effective_from<=private.stockflow_economic_business_date()
 and r.recovery_origin_date<gm.effective_from and v.business_date>=gm.effective_from
 ), helper_owned as(
  select r.id result_id,t.id owner_id from private.stockflow_economic_results r cross join private.stockflow_economic_targets t
  where r.run_id=run and r.target_id is not null and r.status<>'instrument_billing'
   and private.stockflow_economic_result_owned(r.id,t.id)
 ), symmetric_difference as(
  (select * from owned except select * from helper_owned)
  union all
  (select * from helper_owned except select * from owned)
 )
 select (select count(*) from owned),(select count(*) from helper_owned),(select count(*) from symmetric_difference)
 into set_count,helper_count,differences;
 raise notice 'Ownership set %, helper %, symmetric difference %',set_count,helper_count,differences;
 perform pg_temp.speed_assert(set_count=helper_count and set_count>0 and differences=0,'ownership symmetric difference');

 raise notice 'Economics speed phase: summary/full/detail parity for five role sets';
 foreach role_set in array array['{management}','{administrator}','{sales}','{operations}','{management,sales}'] loop
  roles:=role_set::text[];
  foreach mode in array array['summary','full','detail'] loop
   if mode='detail' then
    new_doc:=private.stockflow_economic_workspace_detail(roles);
    old_doc:=private.stockflow_economic_workspace_detail_before_speed(roles);
   else
    new_doc:=private.stockflow_economic_workspace_read(roles,mode='summary');
    old_doc:=private.stockflow_economic_workspace_read_before_speed(roles,mode='summary');
   end if;
   perform pg_temp.speed_parity(new_doc,old_doc,role_set||' '||mode);
   -- Sales may hide targets. All other role sets must expose all fixture IDs.
   if roles<>array['sales']::text[] then
    perform pg_temp.speed_assert((select count(*)=3 from jsonb_array_elements(new_doc->'targets') t
     where t->>'id' in (p1::text,p2::text,g::text)),'fixture targets visible '||role_set||' '||mode);
   end if;
   select t into target_doc from jsonb_array_elements(new_doc->'targets') t where t->>'id'=g::text;
   if target_doc is not null then
    -- Only (a) is group-owned in the active monthly window: 100 paise.
    perform pg_temp.speed_assert((target_doc->>'revenuePaise')::numeric=100,'group monthly revenue '||role_set||' '||mode);
   end if;
   perform pg_temp.speed_assert(not exists(select 1 from jsonb_array_elements(new_doc->'targets') t
    where t->>'id'=p1::text and ((t->>'revenuePaise')::numeric<>1000 or (t->>'attributedLines')::bigint<>4
     or (t->>'missingCostLines')::bigint<>1)),'placement monthly totals exclude billing');
  end loop;
 end loop;

 raise notice 'Economics speed phase: owner-only privileges';
 foreach test_role in array array['anon','authenticated','service_role'] loop
  foreach sig in array array[
   'private.stockflow_economic_workspace_read(text[],boolean)',
   'private.stockflow_economic_workspace_read_before_speed(text[],boolean)',
   'private.stockflow_economic_workspace_detail(text[])',
   'private.stockflow_economic_workspace_detail_before_speed(text[])'
  ] loop
   perform pg_temp.speed_assert(not has_function_privilege(test_role,sig,'execute'),test_role||' execute '||sig);
  end loop;
 end loop;

 raise notice 'Economics speed phase: informational timings only';
 started:=clock_timestamp();perform private.stockflow_economic_workspace_read_before_speed(array['management'],true);elapsed_old:=clock_timestamp()-started;
 started:=clock_timestamp();perform private.stockflow_economic_workspace_read(array['management'],true);elapsed_new:=clock_timestamp()-started;
 raise notice 'Summary old %, new %',elapsed_old,elapsed_new;
 started:=clock_timestamp();perform private.stockflow_economic_workspace_detail_before_speed(array['management']);elapsed_old:=clock_timestamp()-started;
 started:=clock_timestamp();perform private.stockflow_economic_workspace_detail(array['management']);elapsed_new:=clock_timestamp()-started;
 raise notice 'Detail old %, new %',elapsed_old,elapsed_new;
 raise notice 'PASS economics read speed parity, ownership set and privileges';
end$test$;
rollback;
