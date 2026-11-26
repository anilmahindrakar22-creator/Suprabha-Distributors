begin;
set local statement_timeout='120s';
create function pg_temp.ed_assert(ok boolean,label text) returns void language plpgsql as $$
begin
 if ok is distinct from true then raise exception 'Economic delta: %',label;end if;
end $$;
create function pg_temp.ed_import(doc jsonb) returns void language sql as $$
 update public.stockflow_snapshots set payload=jsonb_build_object('catalog','[]'::jsonb,'economicEvidence',doc) where id='suprabha'
$$;
create function pg_temp.ed_doc(company text,version text,entries jsonb) returns jsonb language sql as $$
 select jsonb_build_object('schemaVersion',1,'companyId',company,'sourceVersion',version,'completeWindow',true,
  'windowFrom','2026-10-01','windowTo','2026-11-01','vouchers',entries)
$$;
create temp table ed_captured(id bigint generated always as identity,doc jsonb);
create function pg_temp.ed_capture() returns trigger language plpgsql as $$
begin
 insert into pg_temp.ed_captured(doc) values(new.payload->'economicEvidence');return new;
end $$;
create trigger stockflow_01_delta_test_capture before insert or update of payload on public.stockflow_snapshots
 for each row execute function pg_temp.ed_capture();
insert into public.stockflow_snapshots(id,company,fetched_at,payload)
 values('suprabha','TEST COMPANY',now()::text,'{"catalog":[]}'::jsonb) on conflict(id) do nothing;

do $test$
declare company text:='delta-company-'||extensions.gen_random_uuid()::text;
 rejected_company text:='delta-rejected-'||extensions.gen_random_uuid()::text;
 drift_company text:='delta-drift-'||extensions.gen_random_uuid()::text;
 timing_company text:='delta-timing-'||extensions.gen_random_uuid()::text;
 a jsonb; b jsonb; c jsonb; d jsonb; r jsonb; renamed jsonb; doc jsonb; before_doc jsonb;
 entries jsonb; changes jsonb; manifest jsonb; before_entries jsonb; before_version jsonb;
 prior_exceptions bigint; prior_coverage bigint; prior_vouchers bigint; started timestamptz; elapsed numeric; batch integer;
begin
 perform pg_temp.ed_assert((select tgname='stockflow_00_expand_economic_delta' from pg_trigger
  where tgrelid='public.stockflow_snapshots'::regclass and not tgisinternal and (tgtype::integer & 2)=2 order by tgname limit 1),'1 expansion trigger first');
 a:='{"sourceId":"A","revision":"1","date":"2026-10-15","kind":"sale","amountStatus":"verified","lines":[{"lineKey":"1","productId":"delta-product","quantity":"1","unit":"pack","netSalesPaise":"10000","label":"Original"}]}'::jsonb;
 b:=a||'{"sourceId":"B"}'::jsonb;c:=a||'{"sourceId":"C"}'::jsonb;d:=a||'{"sourceId":"D"}'::jsonb;
 doc:=pg_temp.ed_doc(company,'2026-11-26T01:00:00Z',jsonb_build_array(a,b,c));
 perform pg_temp.ed_import(doc);
 perform pg_temp.ed_assert((select count(*)=3 from private.stockflow_economic_source_vouchers where company_id=company),'2 full imports three');
 perform pg_temp.ed_assert((select count(*)=3 from private.stockflow_economic_received_entries where company_id=company),'2 received three');
 perform pg_temp.ed_assert(exists(select 1 from private.stockflow_economic_received_versions where company_id=company and source_version=doc->>'sourceVersion'),'2 full received version');
 perform pg_temp.ed_assert(exists(select 1 from private.stockflow_economic_source_coverage where company_id=company and source_version=doc->>'sourceVersion'),'2 full coverage');
 doc:=doc||jsonb_build_object('schemaVersion',2,'sourceVersion','2026-11-26T01:01:00Z','baseVersion',doc->>'sourceVersion',
  'manifest','[["A","1"],["B","1"],["C","1"],["D","1"]]'::jsonb,'vouchers',jsonb_build_array(d));
 perform pg_temp.ed_import(doc);
 perform pg_temp.ed_assert((select count(*)=4 from private.stockflow_economic_source_vouchers where company_id=company),'3 delta keeps three and imports D');
 perform pg_temp.ed_assert((select captured.doc->'vouchers'=jsonb_build_array(d) from pg_temp.ed_captured captured order by id desc limit 1),'3 identical received entries skipped');
 perform pg_temp.ed_assert(exists(select 1 from private.stockflow_economic_source_coverage where company_id=company and source_version=doc->>'sourceVersion'),'3 delta coverage');
 perform pg_temp.ed_assert(exists(select 1 from private.stockflow_economic_received_versions where company_id=company and source_version=doc->>'sourceVersion'),'3 delta received version');
 select jsonb_agg(to_jsonb(e) order by source_id) into before_entries from private.stockflow_economic_received_entries e where company_id=company;
 select to_jsonb(v) into before_version from private.stockflow_economic_received_versions v where company_id=company;
 select payload into before_doc from public.stockflow_snapshots where id='suprabha';
 select count(*) into prior_exceptions from private.stockflow_economic_import_exceptions where company_id=company;
 select count(*) into prior_coverage from private.stockflow_economic_source_coverage where company_id=company;
 select count(*) into prior_vouchers from private.stockflow_economic_source_vouchers where company_id=company;
 begin
  perform pg_temp.ed_import(doc||'{"baseVersion":"wrong"}'::jsonb);
  raise exception 'Wrong base accepted';
 exception when sqlstate '22023' then
  perform pg_temp.ed_assert(sqlerrm='Economic delta base mismatch; full upload required','4 wrong base error');
 end;
 perform pg_temp.ed_assert((select jsonb_agg(to_jsonb(e) order by source_id)=before_entries from private.stockflow_economic_received_entries e where company_id=company)
  and (select to_jsonb(v)=before_version from private.stockflow_economic_received_versions v where company_id=company)
  and (select payload=before_doc from public.stockflow_snapshots where id='suprabha')
  and (select count(*)=prior_exceptions from private.stockflow_economic_import_exceptions where company_id=company)
  and (select count(*)=prior_coverage from private.stockflow_economic_source_coverage where company_id=company)
  and (select count(*)=prior_vouchers from private.stockflow_economic_source_vouchers where company_id=company),'4 wrong base changes nothing');
 doc:=doc||jsonb_build_object('baseVersion',doc->>'sourceVersion','sourceVersion','2026-11-26T01:02:00Z','vouchers','[]'::jsonb);
 begin
  perform pg_temp.ed_import(doc||'{"manifest":[["A","99"]]}'::jsonb);
  raise exception 'Unknown revision accepted';
 exception when sqlstate '22023' then
  perform pg_temp.ed_assert(sqlerrm='Economic delta manifest mismatch; full upload required','5 unknown manifest revision error');
 end;
 doc:=doc||'{"manifest":[["A","1"],["C","1"],["D","1"]]}'::jsonb;
 perform pg_temp.ed_import(doc);
 perform pg_temp.ed_assert(exists(select 1 from private.stockflow_economic_import_exceptions where company_id=company
  and reason='Complete window omitted known vouchers; supply cancellation revisions' and evidence->>'sourceVersion'=doc->>'sourceVersion'),'6 omission exception');
 perform pg_temp.ed_assert(not exists(select 1 from private.stockflow_economic_source_coverage where company_id=company and source_version=doc->>'sourceVersion'),'6 omission no coverage');
 c:=c||'{"revision":"2","cancelled":true}'::jsonb;
 doc:=doc||jsonb_build_object('baseVersion',doc->>'sourceVersion','sourceVersion','2026-11-26T01:03:00Z',
  'manifest','[["A","1"],["B","1"],["C","2"],["D","1"]]'::jsonb,'vouchers',jsonb_build_array(b,c));
 perform pg_temp.ed_import(doc);
 perform pg_temp.ed_assert(exists(select 1 from private.stockflow_economic_source_vouchers where company_id=company and source_id='C' and source_revision=2 and cancelled),'7 cancellation imported');
 r:=a||'{"sourceId":"R","amountStatus":"unverified"}'::jsonb;
 doc:=pg_temp.ed_doc(rejected_company,'2026-11-26T02:00:00Z',jsonb_build_array(r));
 perform pg_temp.ed_import(doc);
 select count(*) into prior_exceptions from private.stockflow_economic_import_exceptions where company_id=rejected_company and source_id='R';
 perform pg_temp.ed_assert(prior_exceptions=1 and not exists(select 1 from private.stockflow_economic_source_coverage where company_id=rejected_company),'8 full rejection no coverage');
 doc:=doc||jsonb_build_object('schemaVersion','2','baseVersion',doc->>'sourceVersion','sourceVersion','2026-11-26T02:01:00Z',
  'manifest','[["R","1"]]'::jsonb,'vouchers','[]'::jsonb);
 perform pg_temp.ed_import(doc);
 perform pg_temp.ed_assert((select captured.doc->'vouchers'=jsonb_build_array(r) from pg_temp.ed_captured captured order by id desc limit 1)
  and (select count(*)=prior_exceptions and bool_and(private.stockflow_economic_import_exception_open(id)) from private.stockflow_economic_import_exceptions where company_id=rejected_company and source_id='R')
  and not exists(select 1 from private.stockflow_economic_source_coverage where company_id=rejected_company),'8 rejected received entry replayed without coverage');
 doc:=pg_temp.ed_doc(drift_company,'2026-11-26T03:00:00Z',jsonb_build_array(a));
 perform pg_temp.ed_import(doc);
 renamed:=jsonb_set(a,'{lines,0,label}','"Renamed"'::jsonb);
 doc:=doc||jsonb_build_object('sourceVersion','2026-11-26T03:01:00Z','vouchers',jsonb_build_array(renamed));
 perform pg_temp.ed_import(doc);
 doc:=doc||jsonb_build_object('schemaVersion',2,'baseVersion',doc->>'sourceVersion','sourceVersion','2026-11-26T03:02:00Z',
  'manifest','[["A","1"]]'::jsonb,'vouchers','[]'::jsonb);
 perform pg_temp.ed_import(doc);
 perform pg_temp.ed_assert((select captured.doc->'vouchers'=jsonb_build_array(renamed) from pg_temp.ed_captured captured order by id desc limit 1),'9 label drift reaches import');
 perform pg_temp.ed_assert(exists(select 1 from private.stockflow_economic_source_vouchers where company_id=drift_company and evidence=a)
  and exists(select 1 from private.stockflow_economic_source_coverage where company_id=drift_company and source_version=doc->>'sourceVersion'),'9 label drift preserves stored evidence and certifies');
 select jsonb_agg(a||jsonb_build_object('sourceId','cap-'||n) order by n) into entries from generate_series(1,2001) n;
 begin
  perform pg_temp.ed_import(pg_temp.ed_doc(company,'2026-11-26T04:00:00Z',entries)||'{"expandedDelta":true,"windowSourceIds":[]}'::jsonb);
  raise exception 'Spoofed cap accepted';
 exception when sqlstate '22023' then
  perform pg_temp.ed_assert(sqlerrm='Invalid or oversized economic evidence envelope','10 client internal cap override stripped');
 end;
 select jsonb_agg(to_jsonb(e) order by source_id) into before_entries from private.stockflow_economic_received_entries e where company_id=company;
 select to_jsonb(v) into before_version from private.stockflow_economic_received_versions v where company_id=company;
 perform pg_temp.ed_import(pg_temp.ed_doc(company,'2026-11-26T04:01:00Z',jsonb_build_array(a,b,c,d))||'{"purpose":"sales_coverage"}'::jsonb);
 perform pg_temp.ed_assert((select jsonb_agg(to_jsonb(e) order by source_id)=before_entries from private.stockflow_economic_received_entries e where company_id=company)
  and (select to_jsonb(v)=before_version from private.stockflow_economic_received_versions v where company_id=company),'11 sales coverage leaves received store alone');
 for batch in 0..2 loop
  select jsonb_agg(a||jsonb_build_object('sourceId','timing-'||n) order by n) into entries
   from generate_series(batch*2000+1,least((batch+1)*2000,5000)) n;
  perform pg_temp.ed_import(pg_temp.ed_doc(timing_company,'2026-11-26T05:00:00Z',entries)||'{"completeWindow":false}'::jsonb);
 end loop;
 perform pg_temp.ed_assert((select count(*)=5000 from private.stockflow_economic_source_vouchers where company_id=timing_company),'12 timing seed imports 5000');
 insert into private.stockflow_economic_received_entries(company_id,source_id,source_revision,entry)
  select company_id,source_id,source_revision,evidence from private.stockflow_economic_source_vouchers where company_id=timing_company;
 insert into private.stockflow_economic_received_versions(company_id,source_version,window_from,window_to)
  values(timing_company,'2026-11-26T05:00:00Z','2026-10-01','2026-11-01');
 select jsonb_agg(jsonb_build_array('timing-'||n,'1') order by n) into manifest from generate_series(1,5025) n;
 select jsonb_agg(a||jsonb_build_object('sourceId','timing-'||n) order by n) into changes from generate_series(5001,5025) n;
 doc:=pg_temp.ed_doc(timing_company,'2026-11-26T05:01:00Z',changes)||jsonb_build_object('schemaVersion',2,'baseVersion','2026-11-26T05:00:00Z','manifest',manifest);
 started:=clock_timestamp();
 perform pg_temp.ed_import(doc);
 elapsed:=extract(epoch from clock_timestamp()-started)*1000;
 raise notice 'economic delta 5000 manifest ms=%',elapsed;
 perform pg_temp.ed_assert(elapsed<20000,'12 timing below 20000 ms');
 perform pg_temp.ed_assert((select count(*)=5025 from private.stockflow_economic_source_vouchers where company_id=timing_company)
  and (select count(*)=25 from private.stockflow_economic_source_vouchers where company_id=timing_company and source_id in (select 'timing-'||n from generate_series(5001,5025) n))
  and exists(select 1 from private.stockflow_economic_source_coverage where company_id=timing_company and source_version=doc->>'sourceVersion'),'12 new vouchers stored with coverage');
end $test$;
rollback;
