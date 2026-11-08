begin;
set local lock_timeout='60s';
set local statement_timeout='300s';
load 'auto_explain';
set local auto_explain.log_min_duration='30s';
set local auto_explain.log_nested_statements=on;

create temporary table gp_fixtures (
 voucher_id uuid default gen_random_uuid(),line_id uuid default gen_random_uuid(),
 source_id text,revision bigint default 1,business_date date default '2026-01-01',
 kind text,product_id text,quantity numeric,net_paise bigint,batch_id text,
 cancelled boolean default false,unit text default 'pack',
 original_voucher text,original_company text,
 expected_status text,expected_cost bigint
) on commit drop;

insert into gp_fixtures(source_id,business_date,kind,product_id,quantity,net_paise,batch_id,expected_status,expected_cost) values
 ('fifo-p1','2026-01-01','purchase','fifo',10,100000,null,null,null),
 ('fifo-p2','2026-01-02','purchase','fifo',10,120000,null,null,null),
 ('fifo-s1','2026-01-03','sale','fifo',15,300000,null,'costed',160000),
 ('fifo-s2','2026-01-04','sale','fifo',5,100000,null,'costed',60000),
 ('batch-p1','2026-01-01','purchase','batch',5,5000,'A',null,null),
 ('batch-p2','2026-01-02','purchase','batch',5,10000,'B',null,null),
 ('batch-s1','2026-01-03','sale','batch',4,16000,'B','costed',8000),
 ('batch-s2','2026-01-04','sale','batch',3,12000,'B','costed',3000),
 ('batch-s3','2026-01-05','sale','batch',3,12000,null,'costed',4000),
 ('old-p','2024-12-31','purchase','old',10,10000,null,null,null),
 ('old-s','2026-01-01','sale','old',1,2000,null,'cost_unavailable',null),
 ('boundary-p','2025-01-01','purchase','boundary',1,1000,null,null,null),
 ('boundary-s','2026-01-01','sale','boundary',1,2000,null,'costed',1000),
 ('future-p','2026-01-02','purchase','future',1,1000,null,null,null),
 ('future-s','2026-01-01','sale','future',1,2000,null,'cost_unavailable',null),
 ('aging-p1','2025-01-01','purchase','aging',5,5000,'A',null,null),
 ('aging-p2','2025-07-01','purchase','aging',5,10000,'B',null,null),
 ('aging-s1','2025-07-02','sale','aging',2,8000,'A','costed',2000),
 ('aging-s2','2026-01-02','sale','aging',3,12000,'A','costed',6000),
 ('aging-s3','2026-01-03','sale','aging',2,8000,'B','costed',4000),
 ('short-p','2026-01-01','purchase','short',5,5000,null,null,null),
 ('short-s1','2026-01-02','sale','short',6,12000,null,'cost_unavailable',null),
 ('short-s2','2026-01-03','sale','short',5,10000,null,'costed',5000),
 ('capital-p','2026-01-01','purchase','capital',1,900000,null,null,null),
 ('capital-stock-p','2026-01-01','purchase','capital',1,800000,null,null,null),
 ('capital-s','2026-01-02','sale','capital',1,1200000,null,'instrument_billing',null),
 ('round-p','2026-01-01','purchase','round',3,100,null,null,null),
 ('round-s1','2026-01-02','sale','round',1,100,null,'costed',33),
 ('round-s2','2026-01-02','sale','round',1,100,null,'costed',34),
 ('round-s3','2026-01-02','sale','round',1,100,null,'costed',33),
 ('zero-p','2026-01-01','purchase','zero',1,0,null,null,null),
 ('zero-s','2026-01-02','sale','zero',1,100,null,'costed',0),
 ('negative-p','2026-01-01','purchase','negative',1,-100,null,null,null),
 ('negative-s','2026-01-02','sale','negative',1,100,null,'cost_unavailable',null),
 ('zero-qty-s','2026-01-02','sale','zero',0,100,null,null,null),
 ('ignored','2026-01-02','non_economic','ignored',1,100,null,null,null),
 ('purchase-return','2026-01-02','purchase_return','fifo',-100,-100,null,null,null),
 ('credit','2026-01-02','credit','fifo',0,-100,null,null,null);

insert into gp_fixtures(source_id,revision,business_date,kind,product_id,quantity,net_paise,cancelled,expected_status,expected_cost) values
 ('revision-p',1,'2026-01-01','purchase','revision',100,100000,false,null,null),
 ('revision-p',2,'2026-01-01','purchase','revision',2,2000,false,null,null),
 ('revision-s',1,'2026-01-02','sale','revision',100,200000,false,null,null),
 ('revision-s',2,'2026-01-02','sale','revision',1,2000,false,'costed',1000),
 ('cancelled-s',1,'2026-01-02','sale','revision',1,2000,false,null,null),
 ('cancelled-s',2,'2026-01-02','sale','revision',1,2000,true,null,null),
 ('revision-next',1,'2026-01-03','sale','revision',1,2000,false,'costed',1000);

insert into gp_fixtures(source_id,business_date,kind,product_id,quantity,net_paise,original_voucher,original_company,expected_status,expected_cost) values
 ('return-linked','2026-02-01','return','fifo',-3,-60000,'fifo-s1',null,'costed',-32000),
 ('return-positive-revenue','2026-02-01','return','fifo',1,1000,'fifo-s2','company-gp-test','costed',-12000),
 ('return-missing','2026-02-01','return','fifo',-1,-1000,'missing',null,'cost_unavailable',null),
 ('return-cross-company','2026-02-01','return','fifo',-1,-500,'fifo-s1','another-company','cost_unavailable',null),
 ('return-uncosted','2026-02-01','return','old',-1,-1000,'old-s',null,'cost_unavailable',null),
 ('sale-after-return','2026-02-02','sale','fifo',1,20000,null,null,'cost_unavailable',null);

-- Same product in another unit cannot consume pack layers.
insert into gp_fixtures(source_id,business_date,kind,product_id,quantity,net_paise,unit,expected_status)
 values('unit-s','2026-01-02','sale','fifo',1,2000,'box','cost_unavailable');

insert into private.stockflow_economic_source_vouchers(id,company_id,source_id,source_revision,business_date,customer_source_id,kind,cancelled,evidence,imported_at)
 select voucher_id,'company-gp-test',source_id,revision,business_date,'gp-lab',kind,cancelled,'{}',clock_timestamp() from gp_fixtures;
insert into private.stockflow_economic_source_lines(id,voucher_id,line_key,product_id,quantity,unit,net_sales_paise,batch_id,original_company_id,original_voucher_id,original_line_key,evidence)
 select line_id,voucher_id,'1',product_id,quantity,unit,net_paise,batch_id,original_company,original_voucher,
  case when original_voucher is not null then '1' end,'{}' from gp_fixtures;

insert into private.stockflow_customers(id,name,tally_key,created_by_email)
 values('ca000000-0000-4000-8000-000000000001','Company GP lab','company-gp-lab','test');
insert into private.stockflow_economic_customer_identities(company_id,source_id,customer_id,verified_by)
 values('company-gp-test','gp-lab','ca000000-0000-4000-8000-000000000001','test');
insert into private.stockflow_economic_targets(id,kind,name,company_id,customer_id,customer_source_id,site_id,model_id,effective_from,created_by)
 values('ca000000-0000-4000-8000-000000000002','group','Company GP instrument','company-gp-test',
  'ca000000-0000-4000-8000-000000000001','gp-lab','gp-site','gp-model','2026-01-01','test');
insert into private.stockflow_economic_acquisition_links(target_id,purchase_line_id,company_id,source_id,line_key,actor,reason)
 select 'ca000000-0000-4000-8000-000000000002',line_id,'company-gp-test',source_id,'1','test','Instrument capital fixture'
 from gp_fixtures where source_id='capital-p';

insert into private.stockflow_economic_item_catalogs(company_id,source_version,observed_at,content) values
 ('company-gp-test','old','2026-01-01','{"groups":[{"id":"old","name":"Old principal","parentId":null}],"products":[{"id":"fifo","groupId":"old"}]}'),
 ('company-gp-test','latest','2026-02-01','{"groups":[{"id":"principal","name":"Principal","parentId":null},{"id":"lab-items","name":"Lab items","parentId":"principal"}],"products":[{"id":"fifo","groupId":"lab-items"},{"id":"batch","groupId":"principal"},{"id":"zero","groupId":null}]}');

do $test$
declare run uuid; second_run uuid; third_run uuid; summary jsonb; january jsonb; fixture record;
 before_auto bigint; before_results bigint; before_runs bigint;
 expected_revenue numeric; expected_costed numeric; expected_instrument numeric; expected_gp numeric;
 observed timestamptz; volume_run uuid; elapsed integer; volume_started timestamptz;
begin
 raise notice 'phase start %',clock_timestamp();
 select count(*) into before_auto from private.stockflow_economic_auto_cost_links;
 select count(*) into before_results from private.stockflow_economic_results;
 select count(*) into before_runs from private.stockflow_economic_runs;
 run:=private.stockflow_company_gp_refresh('company-gp-test');
 raise notice 'phase first refresh done %',clock_timestamp();
 if run is null then raise exception 'G1 refresh returned no run';end if;

 -- G1-G7, G11-G12 check exact costs, exclusions, revisions and stored return signs.
 for fixture in select * from gp_fixtures loop
  if fixture.expected_status is null then
   if exists(select 1 from private.stockflow_company_gp_lines where run_id=run and source_line_id=fixture.line_id) then
    raise exception 'G5/G6 unexpected output for % revision %',fixture.source_id,fixture.revision;
   end if;
  elsif not exists(select 1 from private.stockflow_company_gp_lines where run_id=run and source_line_id=fixture.line_id
   and status=fixture.expected_status and cost_paise is not distinct from fixture.expected_cost
   and revenue_paise=fixture.net_paise and gp_paise is not distinct from fixture.net_paise-fixture.expected_cost) then
   raise exception 'G1-G7/G11-G12 incorrect cost/status/revenue for %',fixture.source_id;
  end if;
 end loop;
 if (select sum(cost_paise) from private.stockflow_company_gp_lines where run_id=run and product_id='round')<>100 then
  raise exception 'G11 fully consumed layer does not reconcile';end if;
 if (select line_count from private.stockflow_company_gp_runs where id=run)<>(select count(*) from gp_fixtures where expected_status is not null) then
  raise exception 'G5 line count includes old revisions or cancelled/ignored lines';end if;
 if (select count(*) from private.stockflow_economic_auto_cost_links)<>before_auto
  or (select count(*) from private.stockflow_economic_results)<>before_results
  or (select count(*) from private.stockflow_economic_runs)<>before_runs then
  raise exception 'G8 Economics state changed';end if;
 raise notice 'phase fixture checks done %',clock_timestamp();

 -- G9 imports advance the watermark, and the third successful refresh prunes only the oldest run.
 if private.stockflow_company_gp_refresh('company-gp-test') is distinct from run then
  raise exception 'G9 unchanged import did not skip';end if;
 select max(imported_at)+interval '1 second' into observed from private.stockflow_economic_source_vouchers where company_id='company-gp-test';
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,kind,evidence,imported_at)
 values('company-gp-test','new-import-1',1,'2026-02-03','non_economic','{}',observed);
 second_run:=private.stockflow_company_gp_refresh('company-gp-test');
 if second_run is null or second_run=run then raise exception 'G9 new import did not refresh';end if;
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,kind,evidence,imported_at)
 values('company-gp-test','new-import-2',1,'2026-02-04','non_economic','{}',observed+interval '1 second');
 third_run:=private.stockflow_company_gp_refresh('company-gp-test');
 if third_run is null or third_run in (run,second_run)
  or (select count(*) from private.stockflow_company_gp_runs where company_id='company-gp-test')<>2
  or exists(select 1 from private.stockflow_company_gp_runs where id=run)
  or exists(select 1 from private.stockflow_company_gp_lines where run_id=run)
  or not exists(select 1 from private.stockflow_company_gp_runs where id=second_run and status='complete') then
  raise exception 'G9 retention failed';end if;
 raise notice 'phase g9 done %',clock_timestamp();

 -- G10 null roles also fail closed.
 begin
  perform private.stockflow_company_gp_summary(array['accounts'],'company-gp-test',null,null);
  raise exception 'G10 accounts read purchase-derived cost';
 exception when insufficient_privilege then null;end;
 begin
  perform private.stockflow_company_gp_summary(array['operations'],'company-gp-test',null,null);
  raise exception 'G10 operations read purchase-derived cost';
 exception when insufficient_privilege then null;end;
 begin
  perform private.stockflow_company_gp_summary(null,'company-gp-test',null,null);
  raise exception 'G10 null roles read purchase-derived cost';
 exception when insufficient_privilege then null;end;
 summary:=private.stockflow_company_gp_summary(array['management'],'company-gp-test',null,null);
 select sum(net_paise),sum(net_paise) filter(where expected_status='costed'),
  sum(net_paise) filter(where expected_status='instrument_billing'),sum(net_paise-expected_cost)
 into expected_revenue,expected_costed,expected_instrument,expected_gp
 from gp_fixtures where expected_status is not null;
 if summary->>'runId' is distinct from third_run::text or summary->>'policyVersion'<>'company_gp_v1'
  or (summary->'coverage'->>'revenuePaise')::numeric is distinct from expected_revenue
  or (summary->'coverage'->>'costedRevenuePaise')::numeric is distinct from expected_costed
  or (summary->'coverage'->>'instrumentBillingRevenuePaise')::numeric is distinct from expected_instrument
  or (summary->'coverage'->>'costedPct')::numeric is distinct from 100.0*expected_costed/(expected_revenue-expected_instrument)
  or jsonb_typeof(summary->'coverage'->'revenuePaise')<>'number' then
  raise exception 'G10/G12 management coverage differs from fixture expectations';end if;
 if (select sum((m->>'gpPaise')::numeric) from jsonb_array_elements(summary->'months') m) is distinct from expected_gp
  or (summary->'customers'->0->>'gpPaise')::numeric is distinct from expected_gp then
  raise exception 'G10 GP includes uncosted revenue';end if;
 if not exists(select 1 from jsonb_array_elements(summary->'groups') g where g->>'groupId'='principal' and g->>'groupName'='Principal'
   and (g->>'revenuePaise')::numeric=(select sum(net_paise) from gp_fixtures where expected_status is not null and product_id in ('fifo','batch')))
  or not exists(select 1 from jsonb_array_elements(summary->'groups') g where g->>'groupName'='(no group)' and g->>'revenuePaise'='100')
  or not exists(select 1 from jsonb_array_elements(summary->'groups') g where g->>'groupName'='(not in catalog)')
  or exists(select 1 from jsonb_array_elements(summary->'groups') g where g->>'groupId'='old') then
  raise exception 'G10 latest catalog/root group rollup failed';end if;
 january:=private.stockflow_company_gp_summary(array['administrator'],'company-gp-test','2026-01-01','2026-02-01');
 if jsonb_array_length(january->'months')<>1 or january->'months'->0->>'month'<>'2026-01'
  or (january->'coverage'->>'revenuePaise')::numeric is distinct from
   (select sum(net_paise) from gp_fixtures where expected_status is not null and business_date>='2026-01-01' and business_date<'2026-02-01') then
  raise exception 'G10 half-open date window failed';end if;
 if private.stockflow_company_gp_summary(array['management'],'missing-company',null,null)->'coverage'->>'revenuePaise'<>'0' then
  raise exception 'G10 empty company coverage failed';end if;
 raise notice 'phase summary done %',clock_timestamp();

 -- G13 exercises 300 product queues with 5,000 layers and 20,000 sales.
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,kind,evidence)
 select 'company-gp-volume','purchase-'||n,1,date '2026-01-01'+((n-1)/300),'volume-lab','purchase','{}'
 from generate_series(1,5000) n;
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,kind,evidence)
 select 'company-gp-volume','sale-'||n,1,date '2026-03-01'+((n-1)/300),'volume-lab','sale','{}'
 from generate_series(1,20000) n;
 insert into private.stockflow_economic_source_lines(voucher_id,line_key,product_id,quantity,unit,net_sales_paise,batch_id,evidence)
 select id,'1','product-'||((split_part(source_id,'-',2)::integer-1)%300),
  case when kind='purchase' then 5 else 1 end,'pack',case when kind='purchase' then 500 else 200 end,
  'batch-'||((split_part(source_id,'-',2)::integer-1)/300%3),'{}'
 from private.stockflow_economic_source_vouchers where company_id='company-gp-volume';
 raise notice 'phase volume inserts done %',clock_timestamp();
 volume_started:=clock_timestamp();
 volume_run:=private.stockflow_company_gp_refresh('company-gp-volume');
 raise notice 'phase volume refresh done %',clock_timestamp();
 elapsed:=round(extract(epoch from clock_timestamp()-volume_started)*1000)::integer;
 raise notice 'G13 company GP duration_ms=% (run duration_ms=%)',elapsed,
  (select duration_ms from private.stockflow_company_gp_runs where id=volume_run);
 if elapsed>20000 then raise exception 'G13 refresh exceeded 20000 ms (% ms)',elapsed;end if;
 if not exists(select 1 from private.stockflow_company_gp_runs where id=volume_run and status='complete' and line_count=20000)
  or (select count(*) from private.stockflow_company_gp_lines where run_id=volume_run and status='costed' and cost_paise=100)<>20000
  or (select sum(gp_paise) from private.stockflow_company_gp_lines where run_id=volume_run)<>2000000 then
  raise exception 'G13 volume refresh incomplete or incorrect';end if;
 if (select count(*) from private.stockflow_economic_auto_cost_links)<>before_auto
  or (select count(*) from private.stockflow_economic_results)<>before_results
  or (select count(*) from private.stockflow_economic_runs)<>before_runs then
  raise exception 'G8 repeated/volume refresh changed Economics state';end if;
 raise notice 'PASS company gp model G1-G13';
end $test$;

rollback;
