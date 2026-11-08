begin;

insert into public.stockflow_snapshots(id,company,fetched_at,payload)
 values('suprabha','SUPRABHA DISTRIBUTORS',now()::text,'{"catalog":[]}'::jsonb) on conflict(id) do nothing;

do $test$
declare company text:='omission-scope-company'; observed_at timestamptz:=clock_timestamp();
 doc jsonb; s1 jsonb; s2 jsonb; r1 jsonb; definition text; metadata record; omission_count bigint;
 omission_reason text:='Complete window omitted known vouchers; supply cancellation revisions';
begin
 s1:='{"sourceId":"S1","revision":"1","date":"2026-10-15","kind":"sale","amountStatus":"verified","lines":[{"lineKey":"1","productId":"omission-product","quantity":"1","unit":"pack","netSalesPaise":"10000"}]}'::jsonb;
 s2:=s1||'{"sourceId":"S2"}'::jsonb;
 r1:='{"sourceId":"R1","revision":"1","date":"2026-10-15","kind":"non_economic","voucherType":"Receipt","classificationPolicy":"explicit_non_economic_v1","exclusionReason":"Accounting receipt","amountStatus":"verified","lines":[]}'::jsonb;
 doc:=jsonb_build_object('schemaVersion',1,'companyId',company,'sourceVersion',observed_at::text,
  'purpose','sales_coverage','completeWindow',true,'windowFrom','2026-10-01','windowTo','2026-11-01',
  'vouchers',jsonb_build_array(s1,r1));
 update public.stockflow_snapshots set payload=jsonb_build_object('catalog','[]'::jsonb,'economicEvidence',doc) where id='suprabha';
 if not exists(select 1 from private.stockflow_economic_source_coverage where company_id=company and source_version=doc->>'sourceVersion')
  or exists(select 1 from private.stockflow_economic_import_exceptions where company_id=company) then
  raise exception 'E1 seed did not certify sale and receipt';end if;
 if (select count(*) from private.stockflow_economic_source_vouchers where company_id=company and source_id in ('S1','R1'))<>2 then
  raise exception 'E1 seed did not import sale and receipt';end if;

 select count(*) into omission_count from private.stockflow_economic_import_exceptions where company_id=company and reason=omission_reason;
 doc:=(doc-'purpose')||jsonb_build_object('sourceVersion',(observed_at+interval '1 minute')::text,
  'windowFrom','2026-10-02','vouchers',jsonb_build_array(s1));
 update public.stockflow_snapshots set payload=jsonb_build_object('catalog','[]'::jsonb,'economicEvidence',doc) where id='suprabha';
 if not exists(select 1 from private.stockflow_economic_source_coverage where company_id=company and source_version=doc->>'sourceVersion')
  or (select count(*) from private.stockflow_economic_import_exceptions where company_id=company and reason=omission_reason)<>omission_count then
  raise exception 'E1 regular upload did not certify without receipt';end if;

 doc:=doc||jsonb_build_object('sourceVersion',(observed_at+interval '2 minutes')::text,
  'windowFrom','2026-10-03','vouchers',jsonb_build_array(s2));
 update public.stockflow_snapshots set payload=jsonb_build_object('catalog','[]'::jsonb,'economicEvidence',doc) where id='suprabha';
 if not exists(select 1 from private.stockflow_economic_import_exceptions where company_id=company and reason=omission_reason
  and evidence->>'sourceVersion'=doc->>'sourceVersion' and evidence->'missingSourceIds' @> '["S1"]'::jsonb
  and not (evidence->'missingSourceIds' @> '["R1"]'::jsonb)) then
  raise exception 'E2 regular omission must list sale but not receipt';end if;
 if exists(select 1 from private.stockflow_economic_source_coverage where company_id=company and source_version=doc->>'sourceVersion') then
  raise exception 'E2 missing sale acquired coverage';end if;

 doc:=doc||jsonb_build_object('sourceVersion',(observed_at+interval '3 minutes')::text,
  'purpose','sales_coverage','windowFrom','2026-10-04','vouchers',jsonb_build_array(s1,s2));
 update public.stockflow_snapshots set payload=jsonb_build_object('catalog','[]'::jsonb,'economicEvidence',doc) where id='suprabha';
 if not exists(select 1 from private.stockflow_economic_import_exceptions where company_id=company and reason=omission_reason
  and evidence->>'sourceVersion'=doc->>'sourceVersion' and evidence->'missingSourceIds'='["R1"]'::jsonb) then
  raise exception 'E3 sales coverage omission must list receipt';end if;
 if exists(select 1 from private.stockflow_economic_source_coverage where company_id=company and source_version=doc->>'sourceVersion') then
  raise exception 'E3 missing receipt acquired coverage';end if;

 definition:=pg_get_functiondef('private.stockflow_import_economic_vouchers()'::regprocedure);
 if (length(definition)-length(replace(definition,$anchor$doc->>'purpose'='sales_coverage'$anchor$,'')))/length($anchor$doc->>'purpose'='sales_coverage'$anchor$)<>2 then
  raise exception 'E4 expected two sales coverage scope references';end if;
 if (length(definition)-length(replace(definition,'economicSyncDomain','')))/length('economicSyncDomain')<>3 then
  raise exception 'E4 expected three sync domain references in importer';end if;
 select p.prosecdef,p.proconfig into strict metadata from pg_proc p
 where p.oid='private.stockflow_import_economic_vouchers()'::regprocedure;
 if metadata.prosecdef is distinct from true or metadata.proconfig is distinct from array['search_path=pg_catalog, private, public, extensions']::text[] then
  raise exception 'E4 importer security definer or search_path changed';end if;
 raise notice 'PASS economic omission scope E1-E4';
end $test$;

rollback;
