begin;

create function pg_temp.s_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Economic covered segments assertion failed: %',label;end if;end$$;

-- Timeline relative to now(): vouchers T-12h, past window (May-Jul) T-10h, current window T-1h, run T.
create function pg_temp.s_cov(company text,f date,t date,imported timestamptz) returns void language sql as $$
 insert into private.stockflow_economic_source_coverage(company_id,window_from,window_to,source_version,imported_at)
 values(company,f,t,to_char(imported,'YYYY-MM-DD"T"HH24:MI:SS.US'),imported) $$;
create function pg_temp.s_voucher(company text,src text,d date,imported timestamptz) returns void language sql as $$
 insert into private.stockflow_economic_source_vouchers(company_id,source_id,source_revision,business_date,customer_source_id,kind,cancelled,evidence,imported_at)
 values(company,src,1,d,'lab',  'sale',false,'{}',imported) $$;
create function pg_temp.s_exception(company text,d date,recorded timestamptz) returns void language sql as $$
 insert into private.stockflow_economic_import_exceptions(company_id,reason,evidence,recorded_at)
 values(company,'test exception',case when d is null then '{}'::jsonb else jsonb_build_object('date',d::text) end,recorded) $$;
create function pg_temp.s_setup(company text,past_from date,past_to date,current_imported interval default interval '1 hour') returns void language plpgsql as $$
begin
 perform pg_temp.s_voucher(company,company||'-base','2026-09-01',now()-interval '12 hours');
 if past_from is not null then perform pg_temp.s_cov(company,past_from,past_to,now()-interval '10 hours'); end if;
 perform pg_temp.s_cov(company,'2026-08-01','2026-11-14',now()-current_imported);
end$$;

do $checks$
declare run uuid;
begin
 insert into private.stockflow_economic_runs(actor,created_at) values('covered-segments-test',now()) returning id into run;

 -- S1: a single current row that contains the window behaves as before.
 perform pg_temp.s_setup('cs-1',null,null);
 perform pg_temp.s_assert(private.stockflow_economic_covered('cs-1','2026-09-08','2026-11-14',run),'S1 single row');
 -- S2: a start before every row stays not covered.
 perform pg_temp.s_setup('cs-2',null,null);
 perform pg_temp.s_assert(not private.stockflow_economic_covered('cs-2','2026-07-23','2026-11-14',run),'S2 before earliest row');
 -- S3: a gap between the past row and the current row stays not covered.
 perform pg_temp.s_setup('cs-3','2026-05-01','2026-07-25');
 perform pg_temp.s_assert(not private.stockflow_economic_covered('cs-3','2026-07-23','2026-11-14',run),'S3 gap');
 -- S4: an adjoining past row covers the earlier days (the SYS 240 case).
 perform pg_temp.s_setup('cs-4','2026-05-01','2026-08-01');
 perform pg_temp.s_assert(private.stockflow_economic_covered('cs-4','2026-07-23','2026-11-14',run),'S4 adjoining rows');
 -- S5: an overlapping past row also covers.
 perform pg_temp.s_setup('cs-5','2026-05-01','2026-09-01');
 perform pg_temp.s_assert(private.stockflow_economic_covered('cs-5','2026-07-23','2026-11-14',run),'S5 overlapping rows');
 -- S6: a voucher dated inside the past segment, imported after that row, fails closed.
 perform pg_temp.s_setup('cs-6','2026-05-01','2026-08-01');
 perform pg_temp.s_voucher('cs-6','cs-6-late','2026-07-25',now()-interval '5 hours');
 perform pg_temp.s_assert(not private.stockflow_economic_covered('cs-6','2026-07-23','2026-11-14',run),'S6 late past voucher');
 -- S7: a voucher dated outside the past segment, imported after that row (but before the current row), does not block it.
 perform pg_temp.s_setup('cs-7','2026-05-01','2026-08-01');
 perform pg_temp.s_voucher('cs-7','cs-7-later','2026-09-10',now()-interval '5 hours');
 perform pg_temp.s_assert(private.stockflow_economic_covered('cs-7','2026-07-23','2026-11-14',run),'S7 later voucher outside past segment');
 -- S8: a dated exception inside the past segment, recorded after that row, fails closed.
 perform pg_temp.s_setup('cs-8','2026-05-01','2026-08-01');
 perform pg_temp.s_exception('cs-8','2026-07-28',now()-interval '5 hours');
 perform pg_temp.s_assert(not private.stockflow_economic_covered('cs-8','2026-07-23','2026-11-14',run),'S8 past dated exception');
 -- S9: a stale current row (over 48 hours) still fails closed, even with a past row.
 perform pg_temp.s_setup('cs-9','2026-05-01','2026-08-01',interval '50 hours');
 perform pg_temp.s_assert(not private.stockflow_economic_covered('cs-9','2026-07-23','2026-11-14',run),'S9 stale current row');
 -- S10: a voucher imported after the current row still fails closed.
 perform pg_temp.s_setup('cs-10','2026-05-01','2026-08-01');
 perform pg_temp.s_voucher('cs-10','cs-10-new','2026-11-12',now()-interval '30 minutes');
 perform pg_temp.s_assert(not private.stockflow_economic_covered('cs-10','2026-07-23','2026-11-14',run),'S10 voucher after current row');
 -- S11: any exception recorded after the current row (dated or not) still fails closed.
 perform pg_temp.s_setup('cs-11','2026-05-01','2026-08-01');
 perform pg_temp.s_exception('cs-11',null,now()-interval '30 minutes');
 perform pg_temp.s_assert(not private.stockflow_economic_covered('cs-11','2026-07-23','2026-11-14',run),'S11 exception after current row');
 -- S12: an undated exception recorded between the past and current rows counts only against the current row, which postdates it.
 perform pg_temp.s_setup('cs-12','2026-05-01','2026-08-01');
 perform pg_temp.s_exception('cs-12',null,now()-interval '5 hours');
 perform pg_temp.s_assert(private.stockflow_economic_covered('cs-12','2026-07-23','2026-11-14',run),'S12 undated exception before current row');
 -- S13: no run, or an empty period, is never covered.
 perform pg_temp.s_setup('cs-13','2026-05-01','2026-08-01');
 perform pg_temp.s_assert(not private.stockflow_economic_covered('cs-13','2026-07-23','2026-11-14',null),'S13 no run');
 perform pg_temp.s_assert(not private.stockflow_economic_covered('cs-13','2026-11-14','2026-11-14',run),'S13 empty period');
 -- S14: a past row imported after the current row is not used (the next current row must confirm it).
 perform pg_temp.s_voucher('cs-14','cs-14-base','2026-09-01',now()-interval '12 hours');
 perform pg_temp.s_cov('cs-14','2026-08-01','2026-11-14',now()-interval '3 hours');
 perform pg_temp.s_cov('cs-14','2026-05-01','2026-08-01',now()-interval '2 hours');
 perform pg_temp.s_assert(not private.stockflow_economic_covered('cs-14','2026-07-23','2026-11-14',run),'S14 past row newer than current row');
 raise notice 'PASS economic covered segments S1-S14';
end$checks$;

rollback;
