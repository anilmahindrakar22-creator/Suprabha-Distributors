-- Disposable replay only. Every fixture, run and pruning operation is rolled back.
begin;

insert into private.stockflow_customers(id,name,tally_key,created_by_email)
 values('cb000000-0000-4000-8000-000000000001','Pruning customer','prune-customer','prune-test');
insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
 values('prune-test','placed','cb000000-0000-4000-8000-000000000001','prune-test');
insert into private.stockflow_orders(id,order_number,customer_id,customer_name,source,status,created_by_email,updated_by_email,idempotency_key)
 values('cb000000-0000-4000-8000-000000000002','PRUNE-TEST','cb000000-0000-4000-8000-000000000001','Pruning customer','phone','delivered','prune-test','prune-test','prune-fixture');
insert into private.stockflow_equipment_installations(id,order_id,tally_key,item_name,status,scheduled_date,serial_number,created_by_email,completed_at)
 values('cb000000-0000-4000-8000-000000000003','cb000000-0000-4000-8000-000000000002','prune-instrument','Pruning instrument','completed',
 private.stockflow_economic_business_date()-90,'PRUNE-1','prune-test',now()-interval '90 days');
insert into private.stockflow_economic_targets(id,kind,name,company_id,customer_id,customer_source_id,site_id,model_id,installation_id,effective_from,approval,created_by)
 values('cb000000-0000-4000-8000-000000000004','placement','Pruning placement','prune-test','cb000000-0000-4000-8000-000000000001',
 'placed','site','prune-model','cb000000-0000-4000-8000-000000000003',private.stockflow_economic_business_date()-90,'approved','prune-test');
insert into private.stockflow_economic_mappings(company_id,model_id,product_id,target_id,effect,effective_from,reason,verified_by)
 values('prune-test','prune-model','reagent','cb000000-0000-4000-8000-000000000004','include',private.stockflow_economic_business_date()-90,'Pruning reagent','prune-test');
with voucher as (
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,site_id,kind,evidence)
 values('prune-test','sales',1,private.stockflow_economic_business_date()-1,'placed','site','sale','{}') returning id
)
insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
 select v.id,n::text,case when n=1 then 'reagent' else 'unmapped-'||n end,1,'pack',100,'{}'
 from voucher v cross join generate_series(1,4) n;

create temp table prune_runs(ordinal integer primary key,id uuid not null,before_count integer not null) on commit drop;

do $test$
declare run uuid; referenced_result uuid; i integer; item record; kept integer; deleted integer;
 summary_before text; full_before text; audit_before jsonb; denied_role text;
begin
 for i in 1..6 loop
  -- Defer just the first eligible run at rebuild 5, so the direct-call read
  -- comparison below exercises a nonzero deletion. Rebuild 6 prunes run 2 itself.
  if i=5 then
   update private.stockflow_economic_runs set results_pruned_at=now() where id=(select id from prune_runs where ordinal=1);
  end if;
  run:=private.stockflow_rebuild_instrument_economics('prune-test');
  -- now() is constant in this transaction; give fixture runs deterministic ages
  -- rather than relying on random UUID order for the created_at tie-breaker.
  update private.stockflow_economic_runs set created_at=now()+i*interval '1 second' where id=run;
  insert into prune_runs select i,run,count(*) from private.stockflow_economic_results where run_id=run;
  if (select before_count from prune_runs where ordinal=i)<>4 then raise exception 'P0 expected four fixture results';end if;
  if i=1 then
   select r.id into strict referenced_result from private.stockflow_economic_results r
   join private.stockflow_economic_source_lines l on l.id=r.source_line_id where r.run_id=run and l.line_key='1';
   -- No purchase evidence: no automatic GP posting. Retain exactly this one row.
   insert into private.stockflow_economic_events(target_id,kind,amount_paise,effective_date,source_result_id,request_id,actor,reason)
   values('cb000000-0000-4000-8000-000000000004','capital',0,private.stockflow_economic_business_date()-1,
    referenced_result,'prune-reference','prune-test','Pruning evidence retention');
  elsif i=5 then
   update private.stockflow_economic_runs set results_pruned_at=null where id=(select id from prune_runs where ordinal=1);
   summary_before:=private.stockflow_economic_workspace_read(array['management'],true)::text;
   full_before:=private.stockflow_economic_workspace_read(array['management'],false)::text;
   deleted:=private.stockflow_prune_economic_results();
   if deleted<>3 then raise exception 'P1 direct prune did not delete exactly three unreferenced rows';end if;
   if summary_before is distinct from private.stockflow_economic_workspace_read(array['management'],true)::text then raise exception 'P2 summary read changed after pruning';end if;
   if full_before is distinct from private.stockflow_economic_workspace_read(array['management'],false)::text then raise exception 'P3 full read changed after pruning';end if;
  end if;
 end loop;
 -- Check complete counts and recorded deletions, using each run's original count.
 for item in select f.*,r.active,r.results_pruned_at,r.results_pruned_rows from prune_runs f
  join private.stockflow_economic_runs r on r.id=f.id order by f.ordinal loop
  select count(*) into kept from private.stockflow_economic_results where run_id=item.id;
  if item.ordinal>=3 then
   if kept<>item.before_count or item.results_pruned_at is not null or item.results_pruned_rows is not null then raise exception 'P4 active/recent inactive results changed: %',item.ordinal;end if;
  else
   if kept<>(case when item.ordinal=1 then 1 else 0 end) then raise exception 'P5 old run retained other than event evidence: %',item.ordinal;end if;
   if item.results_pruned_at is null or item.results_pruned_rows is distinct from item.before_count-kept then raise exception 'P6 prune audit count mismatch: %',item.ordinal;end if;
  end if;
  if item.active is distinct from (item.ordinal=6) then raise exception 'P7 unexpected active run: %',item.ordinal;end if;
 end loop;
 if not exists(select 1 from private.stockflow_economic_results where id=referenced_result)
  or not exists(select 1 from private.stockflow_economic_events where request_id='prune-reference' and source_result_id=referenced_result)
 then raise exception 'P8 ledger evidence was not retained';end if;
 select jsonb_agg(to_jsonb(r) order by r.id) into audit_before from private.stockflow_economic_runs r;
 if private.stockflow_prune_economic_results()<>0 then raise exception 'P9 repeated prune deleted rows';end if;
 if audit_before is distinct from (select jsonb_agg(to_jsonb(r) order by r.id) from private.stockflow_economic_runs r) then raise exception 'P10 repeated prune processed an audited run again';end if;
 foreach denied_role in array array['anon','authenticated','service_role'] loop
  if has_function_privilege(denied_role,'private.stockflow_prune_economic_results()','execute') then raise exception 'P11 prune exposed to %',denied_role;end if;
 end loop;
 raise notice 'PASS economic result pruning';
end$test$;
rollback;
