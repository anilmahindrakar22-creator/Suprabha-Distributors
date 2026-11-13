-- Economics coverage across adjoining windows.
--
-- Before: a target was "covered" only when ONE fresh coverage row (imported in the last
-- 48 hours) spanned its whole period. The regular window starts three months back, so any
-- placement older than that (e.g. SYS 240 at MS Palya and Yelahanka, from 23 Jul 2026)
-- showed "Data incomplete" for ever, hiding its real health.
--
-- After (rule needs owner sign-off before production):
-- * Current segment, unchanged: the newest fresh row reaching the period end keeps every
--   existing check: imported within 48 hours, no voucher imported after it or after the
--   run, no exception (dated or undated) recorded after it.
-- * Earlier days the current row does not reach: each day must be covered by an older
--   coverage row (the newest one covering that day, imported no later than the current
--   row). That day is still confirmed only if no voucher dated that day and no exception
--   dated that day arrived after that row's import. Past rows have no 48-hour limit.
-- * Undated exceptions count only against the current row (as today).
-- Trade-off: a later edit in Tally to a past month is not seen until that month is
-- re-read; today such months simply fail closed.
begin;

do $guard$
begin
 if md5(replace((select prosrc from pg_proc where oid='private.stockflow_economic_covered(text,date,date,uuid)'::regprocedure),chr(13),''))
  <>'881ddf7bb2190e1fa10adcda9069bad9' then
  raise exception 'Unexpected stockflow_economic_covered definition';
 end if;
end $guard$;

create or replace function private.stockflow_economic_covered(p_company text, p_from date, p_to date, p_run uuid)
 returns boolean language sql stable set search_path to 'pg_catalog','private' as $function$
 select p_run is not null and p_to>p_from and exists(select 1 from private.stockflow_economic_source_coverage cov
  join private.stockflow_economic_runs g on g.id=p_run where cov.company_id=p_company and cov.window_to>=p_to and cov.imported_at>now()-interval '48 hours'
  and not exists(select 1 from private.stockflow_economic_source_vouchers v where v.company_id=p_company and (v.imported_at>cov.imported_at or v.imported_at>g.created_at))
  and not exists(select 1 from private.stockflow_economic_import_exceptions e where (e.company_id=p_company or e.company_id is null) and e.recorded_at>cov.imported_at)
  and (cov.window_from<=p_from or not exists(
   select 1 from generate_series(p_from,cov.window_from-1,interval '1 day') day_value(d)
   where not exists(
    select 1 from (select past.imported_at from private.stockflow_economic_source_coverage past
     where past.company_id=p_company and past.window_from<=day_value.d::date and past.window_to>day_value.d::date
      and past.imported_at<=cov.imported_at
     order by past.imported_at desc,past.source_version desc,past.id desc limit 1) chosen
    where not exists(select 1 from private.stockflow_economic_source_vouchers v
      where v.company_id=p_company and v.business_date=day_value.d::date and v.imported_at>chosen.imported_at)
     and not exists(select 1 from private.stockflow_economic_import_exceptions e
      where (e.company_id=p_company or e.company_id is null) and e.evidence_sales_date=day_value.d::date and e.recorded_at>chosen.imported_at)))))
$function$;

revoke all on function private.stockflow_economic_covered(text,date,date,uuid) from public,anon,authenticated,service_role;
commit;
