-- Disposable replay only. Every fixture and rebuild is rolled back.
begin;
create temp table candidate_fixture_lines(source text primary key, id uuid not null) on commit drop;
create function pg_temp.candidate_fixture_line(p_source text,p_kind text,p_product text,p_customer text,
 p_day date,p_quantity numeric,p_amount bigint,p_original text default null,p_revision bigint default 1,p_cancelled boolean default false)
returns uuid language plpgsql as $$
declare voucher uuid; line uuid;
begin
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,site_id,kind,cancelled,evidence)
 values('candidate-test',p_source,p_revision,p_day,p_customer,'site',p_kind,p_cancelled,'{}') returning id into voucher;
 insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,original_company_id,original_voucher_id,original_line_key,evidence)
 values(voucher,'1',p_product,p_quantity,'pack',p_amount,case when p_original is not null then 'candidate-test' end,p_original,case when p_original is not null then '1' end,'{}') returning id into line;
 insert into candidate_fixture_lines values(p_source||':'||p_revision,line);
 return line;
end$$;

insert into private.stockflow_economic_policy_versions(actor,reason,automatic_purchase_cost,automatic_approval)
 values('candidate-test','Candidate parity fixture',true,false);
insert into private.stockflow_customers(id,name,tally_key,created_by_email)
 values('ca000000-0000-4000-8000-000000000001','Candidate customer','candidate-customer','candidate-test');
insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
 values('candidate-test','placed','ca000000-0000-4000-8000-000000000001','candidate-test');
insert into private.stockflow_orders(id,order_number,customer_id,customer_name,source,status,created_by_email,updated_by_email,idempotency_key)
 values('ca000000-0000-4000-8000-000000000002','CANDIDATE-TEST','ca000000-0000-4000-8000-000000000001','Candidate customer','phone','delivered','candidate-test','candidate-test','candidate-fixture');
insert into private.stockflow_equipment_installations(id,order_id,tally_key,item_name,status,scheduled_date,serial_number,created_by_email,completed_at)
 select ('ca000000-0000-4000-8000-00000000000'||i)::uuid,'ca000000-0000-4000-8000-000000000002','candidate-instrument-'||i,'Candidate instrument '||i,'completed',
 private.stockflow_economic_business_date()-90,'CANDIDATE-'||i,'candidate-test',now()-interval '90 days' from generate_series(3,4) i;

do $fixture$
declare d date:=(date_trunc('month',private.stockflow_economic_business_date())-interval '1 month')::date;
 p1 uuid:='ca000000-0000-4000-8000-000000000011'; p2 uuid:='ca000000-0000-4000-8000-000000000012';
 g uuid:='ca000000-0000-4000-8000-000000000013'; s record; verification uuid; catalog uuid;
begin
 insert into private.stockflow_economic_targets(id,kind,name,company_id,customer_id,customer_source_id,site_id,model_id,installation_id,effective_from,approval,created_by)
 values(p1,'placement','Candidate first','candidate-test','ca000000-0000-4000-8000-000000000001','placed','site','model-1','ca000000-0000-4000-8000-000000000003',d-1,'approved','candidate-test'),
 (p2,'placement','Candidate second','candidate-test','ca000000-0000-4000-8000-000000000001','placed','site','model-2','ca000000-0000-4000-8000-000000000004',d-1,'approved','candidate-test'),
 (g,'group','Candidate group','candidate-test','ca000000-0000-4000-8000-000000000001','placed','site','group',null,d-1,'approved','candidate-test');
 insert into private.stockflow_economic_group_members(group_id,placement_id,effective_from) values(g,p1,d-1);
 insert into private.stockflow_economic_mappings(company_id,model_id,product_id,target_id,effect,effective_from,reason,verified_by)
 values('candidate-test','model-1','fifo',p1,'include',d-1,'FIFO reagent','candidate-test'),
 ('candidate-test','model-1','split',p1,'include',d-1,'Shared reagent','candidate-test'),
 ('candidate-test','model-2','split',p2,'include',d-1,'Shared reagent','candidate-test');
 insert into private.stockflow_economic_allocations(company_id,customer_source_id,site_id,product_id,effective_from,shares,reason,verified_by)
 values('candidate-test','placed','site','split',d-1,jsonb_build_array(jsonb_build_object('targetId',p1,'basisPoints',3333),jsonb_build_object('targetId',p2,'basisPoints',6667)),'Split with signed rounding','candidate-test');
 insert into private.stockflow_economic_item_catalogs(company_id,source_version,observed_at,content)
 values('candidate-test','fixture',d-1,jsonb_build_object('groups',jsonb_build_array(jsonb_build_object('id','cg','name','Candidate group')),
 'products',jsonb_build_array(jsonb_build_object('id','group-only','name','Group reagent','unit','pack','groupId','cg')))) returning id into catalog;
 insert into private.stockflow_economic_item_group_mappings(company_id,model_id,group_id,target_id,catalog_id,effect,effective_from,reason,verified_by)
 values('candidate-test','model-1','cg',p1,catalog,'include',d-1,'Group-only product dependency','candidate-test');
 for s in select * from (values
  ('instrument-p1','purchase','instrument-1',null,-2,1::numeric,20000,null),
  ('instrument-p2','purchase','instrument-2',null,-2,1,25000,null),
  ('instrument-sale','sale','instrument-1','placed',0,1,10000,null),
  ('instrument-return','return','instrument-1','placed',15,-0.5,-4000,'instrument-sale'),
  ('instrument-credit','credit','instrument-1','placed',16,0,-1000,'instrument-sale'),
  ('fifo-p1','purchase','fifo',null,1,2,200,null),
  ('fifo-p2','purchase','fifo',null,2,10,3000,null),
  ('fifo-early','sale','fifo','unplaced',3,2,1000,null),
  ('fifo-late','sale','fifo','placed',4,1,1000,null),
  ('foc','sale','fifo','placed',5,1,0,null),
  ('manual','sale','fifo','placed',6,1,1200,null),
  ('split-p','purchase','split',null,1,10,1001,null),
  ('split-sale','sale','split','placed',7,3,10001,null),
  ('split-return','return','split','placed',8,-1,-3000,'split-sale'),
  ('split-credit','credit','split','placed',9,0,-100,'split-sale'),
  ('supplier-p','purchase','supplier-only',null,1,3,600,null),
  ('supplier-return','purchase_return','supplier-only',null,2,-1,-200,null),
  ('supplier-consumption','sale','supplier-only','unplaced',3,1,400,null),
  ('group-p','purchase','group-only',null,1,3,750,null),
  ('group-early','sale','group-only','unplaced',2,1,500,null),
  ('group-sale','sale','group-only','placed',3,1,500,null),
  ('review-only','sale','unmapped','unplaced',4,1,0,null),
  ('verification-only','sale','unmapped','unplaced',4,1,50,null),
  ('unmapped-placed','sale','unmapped','placed',4,1,50,null)
 ) x(source,kind,product,customer,day,qty,amount,original) loop
  perform pg_temp.candidate_fixture_line(s.source,s.kind,s.product,s.customer,d+s.day,s.qty,s.amount,s.original);
 end loop;
 insert into private.stockflow_economic_acquisition_links(target_id,purchase_line_id,company_id,source_id,line_key,actor,reason)
 select p1,id,'candidate-test','instrument-p1','1','candidate-test','Verified purchase' from candidate_fixture_lines where source='instrument-p1:1'
 union all select p2,id,'candidate-test','instrument-p2','1','candidate-test','Verified purchase' from candidate_fixture_lines where source='instrument-p2:1';
 insert into private.stockflow_economic_instrument_billings(target_id,source_line_id,company_id,source_id,line_key,actor,reason)
 select p1,id,'candidate-test','instrument-sale','1','candidate-test','Verified billing' from candidate_fixture_lines where source='instrument-sale:1';
 insert into private.stockflow_economic_events(target_id,kind,amount_paise,effective_date,request_id,actor,reason)
 values(p1,'capital',20000,d-2,'candidate-capital-1','candidate-test','Acquisition'),(p2,'capital',25000,d-2,'candidate-capital-2','candidate-test','Acquisition');
 insert into private.stockflow_economic_line_reviews(source_line_id,foc_reason,reason,actor)
 select id,'training','Reviewed FOC','candidate-test' from candidate_fixture_lines where source in ('foc:1','review-only:1');
 insert into private.stockflow_economic_cost_verifications(sale_line_id,evidence_reference,actor)
 select id,'Verified manual cost','candidate-test' from candidate_fixture_lines where source='manual:1' returning id into verification;
 insert into private.stockflow_economic_cost_links(sale_line_id,purchase_line_id,verification_id,quantity,cost_paise,evidence_reference,verified_by)
 select sale_line.id,purchase_line.id,verification,1,300,'Manual purchase evidence','candidate-test'
 from candidate_fixture_lines sale_line,candidate_fixture_lines purchase_line where sale_line.source='manual:1' and purchase_line.source='fifo-p2:1';
 insert into private.stockflow_economic_cost_verifications(sale_line_id,evidence_reference,actor)
 select id,'Review without available purchase','candidate-test' from candidate_fixture_lines where source='verification-only:1';
 perform pg_temp.candidate_fixture_line('superseded','sale','unmapped','unplaced',d+10,1,100);
 perform pg_temp.candidate_fixture_line('superseded','sale','unmapped','unplaced',d+10,1,200,null,2);
 perform pg_temp.candidate_fixture_line('cancelled','sale','fifo','placed',d+10,1,100);
 perform pg_temp.candidate_fixture_line('cancelled','sale','fifo','placed',d+10,1,100,null,2,true);
 for s in select generate_series(1,100) n loop
  perform pg_temp.candidate_fixture_line('unmapped-'||s.n,'sale','unmapped','unplaced',d+11,1,101);
 end loop;
 insert into private.stockflow_economic_source_coverage(company_id,window_from,window_to,source_version)
 values('candidate-test',d-2,(d+interval '1 month')::date,'fixture');
end$fixture$;

-- BEGIN SHARED PARITY HELPERS (also embedded in the standalone acceptance script).
create function pg_temp.candidate_snapshot(p_run uuid) returns jsonb language plpgsql as $$
declare snapshot jsonb;
begin
 if (select id from private.stockflow_economic_runs where active) is distinct from p_run then
  raise exception 'Snapshot must be taken immediately after its rebuild';
 end if;
 select jsonb_build_object(
  'run',p_run,
  'results',coalesce((select jsonb_agg(to_jsonb(x) order by x.source_line_id,x.target_id nulls first) from (
   select source_line_id,target_id,status,reason,share_bps,quantity,revenue_paise,cost_paise,gp_paise,recovery_origin_date
   from private.stockflow_economic_results where run_id=p_run
  ) x),'[]'::jsonb),
  'links',coalesce((select jsonb_agg(to_jsonb(x) order by x.sale_line_id,x.purchase_line_id) from (
   select sale_line_id,purchase_line_id,quantity,cost_paise from private.stockflow_economic_auto_cost_links where run_id=p_run
  ) x),'[]'::jsonb),
  'events',coalesce((select jsonb_agg(to_jsonb(x) order by x.target_id,x.kind,x.amount_paise,x.effective_date) from (
   select e.target_id,e.kind,e.amount_paise,e.effective_date from private.stockflow_economic_events e
   join private.stockflow_economic_results r on r.id=e.source_result_id
   where r.run_id=p_run and e.kind in ('gp','contribution') and e.reverses_id is null
  ) x),'[]'::jsonb),
  'summary',private.stockflow_economic_workspace_read(array['management'],true),
  'full',private.stockflow_economic_workspace_read(array['management'],false)
 ) into snapshot;
 return snapshot;
end$$;
-- Deliberately strip ONLY run IDs and timestamps, as required by acceptance.
-- Keep generated result/event IDs, ledger history, business dates, array order,
-- amounts and reasons intact. A literal full-read comparison can therefore
-- expose differences inherent even in two unchanged rebuilds; do not hide them.
create function pg_temp.candidate_read_bytes(p_value jsonb) returns jsonb language plpgsql immutable as $$
declare result jsonb;
begin
 if jsonb_typeof(p_value)='object' then
  select coalesce(jsonb_object_agg(key,pg_temp.candidate_read_bytes(value)),'{}'::jsonb) into result
  from jsonb_each(p_value)
  where key not in ('generation','generationId','run_id','runId','lastRebuiltAt','sourceImportedAt',
   'created_at','createdAt','recorded_at','recordedAt','imported_at','importedAt','observed_at','observedAt','updated_at','updatedAt');
  return result;
 elsif jsonb_typeof(p_value)='array' then
  select coalesce(jsonb_agg(pg_temp.candidate_read_bytes(value) order by ordinality),'[]'::jsonb) into result
  from jsonb_array_elements(p_value) with ordinality;
  return result;
 end if;
 return p_value;
end$$;
-- A5 normalisation (conductor decision, 30 Oct 2026): the full read's ledger
-- accumulates history across runs. Compare only the live postings: drop reversal
-- rows and the rows they reverse, strip generated identifiers and the run actor,
-- and sort. Amounts, dates, targets, kinds and reasons are still compared exactly.
create function pg_temp.candidate_strip(p jsonb) returns jsonb language sql immutable as $$
 select p-'id'-'request_id'-'requestId'-'source_result_id'-'sourceResultId'-'reverses_id'-'reversesId'-'actor'-'resultId'
$$;
create function pg_temp.candidate_full_read(p jsonb) returns jsonb language sql immutable as $$
 select pg_temp.candidate_read_bytes(p)
  || jsonb_build_object('ledger',coalesce((select jsonb_agg(pg_temp.candidate_strip(e) order by pg_temp.candidate_strip(e)::text)
     from jsonb_array_elements(p->'ledger') e
     where e->>'kind'<>'reversal'
      and not exists(select 1 from jsonb_array_elements(p->'ledger') r where r->>'kind'='reversal' and r->>'reverses_id'=e->>'id')),'[]'::jsonb))
  || jsonb_build_object('attributionLines',coalesce((select jsonb_agg(pg_temp.candidate_strip(pg_temp.candidate_read_bytes(a)) order by pg_temp.candidate_strip(pg_temp.candidate_read_bytes(a))::text)
     from jsonb_array_elements(p->'attributionLines') a),'[]'::jsonb))
$$;
-- END SHARED PARITY HELPERS

create temp table candidate_snapshots(label text primary key, snapshot jsonb not null) on commit drop;
do $parity$
declare old_run uuid; new_run uuid; old_snapshot jsonb; new_snapshot jsonb; part text; item record;
 baseline_cost bigint; without_early_cost bigint; probe_run uuid; denied_role text;
begin
 old_run:=private.stockflow_rebuild_instrument_economics_full_scan('candidate-parity');
 old_snapshot:=pg_temp.candidate_snapshot(old_run);
 insert into candidate_snapshots values('full_scan',old_snapshot);
 new_run:=private.stockflow_rebuild_instrument_economics('candidate-parity');
 new_snapshot:=pg_temp.candidate_snapshot(new_run);
 insert into candidate_snapshots values('candidate',new_snapshot);
 -- A1: every listed result field, including NULLs and reason bytes, by source line/target.
 if (old_snapshot->'results')::text is distinct from (new_snapshot->'results')::text then raise exception 'A1 result byte parity failed';end if;
 -- A2: automatic stock reservations, including unattributed earlier consumption.
 if (old_snapshot->'links')::text is distinct from (new_snapshot->'links')::text then raise exception 'A2 automatic cost link byte parity failed';end if;
 -- A3: per-run GP/contribution event multisets, excluding reversals.
 if (old_snapshot->'events')::text is distinct from (new_snapshot->'events')::text then raise exception 'A3 event byte parity failed';end if;
 -- A4/A5 are checked from these immediate snapshots after the scale checks.
 -- A6: conservation on BOTH runs: same base set, no missing/extra line, no
 -- duplicate target, and either exactly one NULL target or only target rows.
 for item in select * from candidate_snapshots loop
  if exists(
   with base as (
    select l.id,l.quantity,l.net_sales_paise,v.kind from private.stockflow_economic_source_lines l
    join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id
    where v.kind<>'purchase' and not v.cancelled and not exists(select 1 from private.stockflow_economic_source_vouchers newer where newer.company_id=v.company_id and newer.source_id=v.source_id and newer.source_revision>v.source_revision)
   ), actual as (
    select source_line_id,count(*) n,count(target_id) targets,count(distinct target_id) distinct_targets,
     sum(share_bps) bps,sum(quantity) qty,sum(revenue_paise) revenue
    from private.stockflow_economic_results where run_id=(item.snapshot->>'run')::uuid group by source_line_id
   ) select 1 from base b full join actual a on a.source_line_id=b.id
   where b.id is null or a.source_line_id is null
    or not ((a.n=1 and a.targets=0) or (a.n=a.targets and a.n=a.distinct_targets))
    or a.bps<>10000 or a.qty is distinct from b.quantity
    or a.revenue is distinct from (case when b.kind='purchase_return' then 0 else b.net_sales_paise end)
  ) then raise exception 'A6 conservation or disjoint insert/loop failure: %',item.label;end if;
 end loop;
 -- A7: fixture is non-vacuous: split, grouped attribution, billing adjustments,
 -- FOC reason, supplier return and manual verification all reach their paths.
 if (select count(*) from private.stockflow_economic_results r join candidate_fixture_lines f on f.id=r.source_line_id where r.run_id=new_run and f.source='split-sale:1' and r.target_id is not null)<>2
  or not exists(select 1 from private.stockflow_economic_results r join candidate_fixture_lines f on f.id=r.source_line_id where r.run_id=new_run and f.source='fifo-late:1' and r.target_id='ca000000-0000-4000-8000-000000000013')
  or (select count(*) from private.stockflow_economic_results r join candidate_fixture_lines f on f.id=r.source_line_id where r.run_id=new_run and f.source in ('instrument-sale:1','instrument-return:1','instrument-credit:1') and r.status='instrument_billing')<>3
  or not exists(select 1 from private.stockflow_economic_results r join candidate_fixture_lines f on f.id=r.source_line_id where r.run_id=new_run and f.source='foc:1' and r.reason='FOC: training' and r.status='verified')
  or not exists(select 1 from private.stockflow_economic_results r join candidate_fixture_lines f on f.id=r.source_line_id where r.run_id=new_run and f.source='supplier-return:1' and r.reason='recorded_purchase_return')
  or not exists(select 1 from private.stockflow_economic_results r join candidate_fixture_lines f on f.id=r.source_line_id where r.run_id=new_run and f.source='manual:1' and r.cost_paise=300 and r.reason='Verified attribution and purchase evidence')
 then raise exception 'A7 fixture failed to exercise the required financial paths';end if;
 -- A8: all five rules retain their dependencies, including unmapped reviews.
 if exists(select 1 from candidate_fixture_lines f where f.source in ('fifo-early:1','group-early:1','supplier-consumption:1','review-only:1','verification-only:1','unmapped-placed:1','instrument-return:1')
  and not exists(select 1 from private.stockflow_economic_rebuild_candidates('{"candidate-test":{"fifo":true,"split":true,"group-only":true,"supplier-only":true}}') c where c.line_id=f.id))
  or exists(select 1 from private.stockflow_economic_rebuild_candidates('{}') c join candidate_fixture_lines f on f.id=c.line_id where f.source in ('superseded:1','cancelled:1','cancelled:2','unmapped-1:1'))
 then raise exception 'A8 candidate rules or base revision filter failed';end if;
 -- A9: both runs cost the placement sale at 300 after the unplaced sale.
 for item in select * from candidate_snapshots loop
  select r.cost_paise into baseline_cost from private.stockflow_economic_results r join candidate_fixture_lines f on f.id=r.source_line_id
   where r.run_id=(item.snapshot->>'run')::uuid and f.source='fifo-late:1';
  if baseline_cost is distinct from 300::bigint then raise exception 'A9 earlier customer did not deplete FIFO: %',item.label;end if;
 end loop;
 -- A10: counterfactual cancellation of just the earlier sale changes cost to 100.
 -- The exception subtransaction restores the exact fixture and active generation.
 begin
  insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,site_id,kind,cancelled,evidence)
  select company_id,source_id,2,business_date,customer_source_id,site_id,kind,true,evidence
  from private.stockflow_economic_source_vouchers where company_id='candidate-test' and source_id='fifo-early' and source_revision=1;
  probe_run:=private.stockflow_rebuild_instrument_economics('candidate-counterfactual');
  select r.cost_paise into without_early_cost from private.stockflow_economic_results r join candidate_fixture_lines f on f.id=r.source_line_id
   where r.run_id=probe_run and f.source='fifo-late:1';
  if without_early_cost is distinct from 100::bigint or without_early_cost is not distinct from baseline_cost then raise exception 'A10 earlier sale did not affect later FIFO cost';end if;
  raise exception using errcode='ZC001',message='rollback counterfactual';
 exception when sqlstate 'ZC001' then null;
 end;
 -- A11: neither helper is exposed to any API role (PUBLIC checked via ACL).
 foreach denied_role in array array['anon','authenticated','service_role'] loop
  if has_function_privilege(denied_role,'private.stockflow_rebuild_instrument_economics_full_scan(text)','execute')
   or has_function_privilege(denied_role,'private.stockflow_economic_rebuild_candidates(jsonb)','execute') then raise exception 'A11 helper exposed to %',denied_role;end if;
 end loop;
 if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  where p.oid in ('private.stockflow_rebuild_instrument_economics_full_scan(text)'::regprocedure,'private.stockflow_economic_rebuild_candidates(jsonb)'::regprocedure)
   and a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'A11 helper exposed to PUBLIC';end if;
end$parity$;

do $scale$
declare started timestamptz; duration interval; scale_run uuid; rejected boolean:=false; candidate_total bigint; prior_run uuid;
begin
 -- 10,100 extra lines share a voucher; line keys remain canonical and unique.
 with voucher as (
  insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,kind,evidence)
  values('candidate-test','scale-sales',1,private.stockflow_economic_business_date()-1,'scale-unplaced','sale','{}') returning id
 ) insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,evidence)
 select v.id,n::text,case when n<=10001 then 'scale-unmapped' else 'scale-other' end,1,'pack',101,'{}' from voucher v cross join generate_series(1,10100) n;
 select count(*) into candidate_total from private.stockflow_economic_rebuild_candidates('{"candidate-test":{"fifo":true,"split":true,"group-only":true,"supplier-only":true}}');
 -- A12: scale really exceeds the old cap with fewer than 500 candidates.
 if (select count(*) from private.stockflow_economic_source_lines)<=10000 or candidate_total>=500 then raise exception 'A12 scale fixture bounds invalid';end if;
 started:=clock_timestamp();
 scale_run:=private.stockflow_rebuild_instrument_economics('candidate-scale');
 duration:=clock_timestamp()-started;
 raise notice 'Candidate rebuild: 10,100 additional non-candidates, % candidates, duration %',candidate_total,duration;
 -- A13: success includes exactly one complete unattributed result per scale line.
 if (select count(*) from private.stockflow_economic_results r join private.stockflow_economic_source_lines l on l.id=r.source_line_id
  join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where r.run_id=scale_run and v.company_id='candidate-test' and v.source_id='scale-sales'
   and r.target_id is null and r.status='unattributed' and r.reason='no_verified_compatible_placement' and r.share_bps=10000
   and r.quantity=1 and r.revenue_paise=101 and r.cost_paise is null and r.gp_paise is null and r.recovery_origin_date is null)<>10100
  or exists(select 1 from private.stockflow_economic_results where run_id=scale_run group by source_line_id,target_id having count(*)>1)
 then raise exception 'A13 scale rows missing, duplicated or changed';end if;
 begin
  perform private.stockflow_rebuild_instrument_economics_full_scan('candidate-scale-reference');
 exception when sqlstate '54000' then rejected:=true;
 end;
 -- A14: old guard still rejects the SAME source data.
 if not rejected then raise exception 'A14 full scan did not raise 54000';end if;
 prior_run:=(select id from private.stockflow_economic_runs where active);
 -- This mapping exists only in the test transaction. Exactly 10,001 synthetic
 -- lines become candidates; the other 99 remain outside the loop.
 insert into private.stockflow_economic_mappings(company_id,model_id,product_id,effect,effective_from,reason,verified_by)
 values('candidate-test','scale-model','scale-unmapped','include',private.stockflow_economic_business_date()-2,'Temporary scale candidate mapping','candidate-test');
 -- A15: independently prove the guard input has 10,001 synthetic candidates.
 if (select count(*) from private.stockflow_economic_rebuild_candidates('{"candidate-test":{"scale-unmapped":true}}') c
  join private.stockflow_economic_source_lines l on l.id=c.line_id where l.product_id='scale-unmapped')<>10001 then raise exception 'A15 synthetic candidate count invalid';end if;
 rejected:=false;
 begin
  perform private.stockflow_rebuild_instrument_economics('candidate-guard');
 exception when sqlstate '54000' then
  if sqlerrm<>'Economic rebuild candidate lines exceed V1 limit' then raise;end if;
  rejected:=true;
 end;
 -- A16: new guard has the specified SQLSTATE/message and preserves publication.
 if not rejected or (select id from private.stockflow_economic_runs where active) is distinct from prior_run then raise exception 'A16 candidate guard failed or changed active run';end if;
end$scale$;

do $reads$
declare old_snapshot jsonb; new_snapshot jsonb;
begin
 select snapshot into old_snapshot from candidate_snapshots where label='full_scan';
 select snapshot into new_snapshot from candidate_snapshots where label='candidate';
 -- A4: summary read, stripping only run IDs and timestamps.
 if pg_temp.candidate_read_bytes(old_snapshot->'summary')::text is distinct from pg_temp.candidate_read_bytes(new_snapshot->'summary')::text then raise exception 'A4 summary read byte parity failed';end if;
 -- A5: full read; live postings and attribution lines compared exactly after the normalisation above.
 if pg_temp.candidate_full_read(old_snapshot->'full')::text is distinct from pg_temp.candidate_full_read(new_snapshot->'full')::text then raise exception 'A5 full read parity failed (live postings and attribution lines)';end if;
end$reads$;

rollback;
