begin;
create function pg_temp.assert(ok boolean,message text) returns void language plpgsql as $$
begin if ok is not true then raise exception '%',message;end if;end$$;

do $test$
declare definition text; old_definition text; row_value record; evidence_value jsonb; company text; fixture_count integer:=0;
 new_result jsonb; old_result jsonb; started timestamptz; elapsed_ms numeric; call_number integer;
begin
 -- E1: the stored date equals the parser for every shape, and bad dates never fail an insert.
 for evidence_value in select value from jsonb_array_elements(jsonb_build_array(
  '{}'::jsonb,
  '{"date":"2026-07-15"}'::jsonb,
  '{"date":"2026-13-45"}'::jsonb,
  '{"date":"15/07/2026"}'::jsonb,
  '{"date":null}'::jsonb,
  jsonb_build_object('note',repeat('n',50000),'date','2026-08-01'))) loop
  insert into private.stockflow_economic_import_exceptions(company_id,reason,evidence,recorded_at)
  values('cd-e1','e1 shape',evidence_value,clock_timestamp());
 end loop;
 perform pg_temp.assert((select count(*) from private.stockflow_economic_import_exceptions where company_id='cd-e1')=6,'E1 expected six rows');
 perform pg_temp.assert(not exists(select 1 from private.stockflow_economic_import_exceptions e
  where e.company_id='cd-e1' and e.evidence_sales_date is distinct from private.stockflow_sales_exception_date(e.evidence)),'E1 stored date differs from parser');
 perform pg_temp.assert((select evidence_sales_date from private.stockflow_economic_import_exceptions where company_id='cd-e1' and evidence->>'date'='2026-07-15')='2026-07-15','E1 valid date not stored');
 perform pg_temp.assert((select count(*) from private.stockflow_economic_import_exceptions where company_id='cd-e1' and evidence_sales_date is null)=4,'E1 expected four undated rows');
 -- E2: the function reads the stored column twice and no longer calls the parser.
 definition:=pg_get_functiondef('private.stockflow_sales_coverage_status(text,date,date)'::regprocedure);
 perform pg_temp.assert(position('stockflow_sales_exception_date(' in definition)=0,'E2 parser call remains');
 perform pg_temp.assert((length(definition)-length(replace(definition,'e.evidence_sales_date','')))/length('e.evidence_sales_date')=2,'E2 expected two stored-date reads');
 -- E3: equivalence with the previous definition, rebuilt under a temporary name.
 old_definition:=replace(replace(replace(definition,chr(13),''),'e.evidence_sales_date','private.stockflow_sales_exception_date(e.evidence)'),
  'FUNCTION private.stockflow_sales_coverage_status(','FUNCTION pg_temp.old_coverage_status(');
 perform pg_temp.assert(position('pg_temp.old_coverage_status(' in old_definition)>0,'E3 rename failed');
 execute old_definition;
 foreach company in array array['cd-inside','cd-outside','cd-none','cd-invalid','cd-mixed'] loop
  insert into private.stockflow_economic_source_coverage(company_id,window_from,window_to,source_version)
  values(company,'2026-07-01','2026-10-01','2026-10-01T00:00:00Z');
 end loop;
 insert into private.stockflow_economic_import_exceptions(company_id,source_id,reason,evidence,recorded_at) values
  ('cd-inside','a','inside window','{"date":"2026-08-15"}',clock_timestamp()),
  ('cd-outside','a','outside window','{"date":"2026-06-30"}',clock_timestamp()),
  ('cd-none','a','no date','{}',clock_timestamp()),
  ('cd-invalid','a','invalid date','{"date":"2026-99-99"}',clock_timestamp()),
  ('cd-mixed','a','inside edge','{"date":"2026-07-01"}',clock_timestamp()),
  ('cd-mixed','b','after edge','{"date":"2026-10-01"}',clock_timestamp()+interval '1 second'),
  ('cd-mixed','c','bad format','{"date":"15/07/2026"}',clock_timestamp()+interval '2 seconds'),
  ('cd-mixed','d','end edge','{"date":"2026-09-30"}',clock_timestamp()+interval '3 seconds');
 foreach company in array array['cd-inside','cd-outside','cd-none','cd-invalid','cd-mixed','cd-absent'] loop
  new_result:=private.stockflow_sales_coverage_status(company,'2026-07-01','2026-09-30');
  old_result:=pg_temp.old_coverage_status(company,'2026-07-01','2026-09-30');
  perform pg_temp.assert(new_result is not distinct from old_result,format('E3 results differ for %s: %s vs %s',company,new_result,old_result));
  fixture_count:=fixture_count+1;
 end loop;
 perform pg_temp.assert(fixture_count>=4,'E3 needs at least four cases');
 perform pg_temp.assert((private.stockflow_sales_coverage_status('cd-inside','2026-07-01','2026-09-30')->>'blockingCount')='1','E3 inside exception must block');
 perform pg_temp.assert((private.stockflow_sales_coverage_status('cd-outside','2026-07-01','2026-09-30')->>'blockingCount')='0','E3 outside exception must not block');
 perform pg_temp.assert((private.stockflow_sales_coverage_status('cd-none','2026-07-01','2026-09-30')->>'blockingCount')='1','E3 undated exception must block');
 perform pg_temp.assert((private.stockflow_sales_coverage_status('cd-invalid','2026-07-01','2026-09-30')->>'blockingCount')='1','E3 invalid date must block');
 perform pg_temp.assert((private.stockflow_sales_coverage_status('cd-mixed','2026-07-01','2026-09-30')->>'blockingCount')='3','E3 mixed window count');
 -- E4: scale. 2,000 large exceptions must not make coverage status slow.
 insert into private.stockflow_economic_import_exceptions(company_id,source_id,reason,evidence,recorded_at)
 select 'cd-scale',n::text,'scale',jsonb_build_object('note',(select string_agg(md5(n::text||g::text),'') from generate_series(1,250) g),
  'date',to_char(date '2026-06-01'+(n%120),'YYYY-MM-DD')),clock_timestamp()
 from generate_series(1,2000) n;
 started:=clock_timestamp();
 for call_number in 1..20 loop
  perform private.stockflow_sales_coverage_status('cd-scale','2026-07-01','2026-09-30');
 end loop;
 elapsed_ms:=extract(epoch from clock_timestamp()-started)*1000;
 raise notice 'E4 coverage status 20 calls over 2000 exceptions: % ms',round(elapsed_ms,1);
 perform pg_temp.assert(elapsed_ms<2000,format('E4 too slow: %s ms',round(elapsed_ms,1)));
 raise notice 'PASS coverage exception date E1-E4';
end$test$;
rollback;
