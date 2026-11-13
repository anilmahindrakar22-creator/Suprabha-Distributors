-- Sales coverage status parsed every import exception's evidence on each call: about 2,843
-- calls to stockflow_sales_exception_date() detoasted roughly 10 MB of jsonb, about 840 ms
-- of a 940 ms call. A stored copy of the parsed date keeps the check off the large jsonb.
-- Same parser, so the result is unchanged.
begin;

do $guard$
declare definition text; needle text := 'private.stockflow_sales_exception_date(e.evidence)';
begin
 definition:=replace(pg_get_functiondef('private.stockflow_sales_coverage_status(text,date,date)'::regprocedure),chr(13),'');
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>2 then
  raise exception 'Unexpected sales coverage exception-date definition';
 end if;
end $guard$;

-- The generated value uses the same immutable parser, so invalid dates become null rather
-- than failing inserts. If the parser function is ever replaced, this column must be
-- recomputed in the same migration.
alter table private.stockflow_economic_import_exceptions
 add column evidence_sales_date date generated always as (private.stockflow_sales_exception_date(evidence)) stored;

do $patch$
declare definition text; needle text := 'private.stockflow_sales_exception_date(e.evidence)';
begin
 definition:=replace(pg_get_functiondef('private.stockflow_sales_coverage_status(text,date,date)'::regprocedure),chr(13),'');
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>2 then
  raise exception 'Unexpected sales coverage exception-date definition';
 end if;
 definition:=replace(definition,needle,'e.evidence_sales_date');
 execute definition;
end $patch$;

-- create or replace keeps the ACL; re-apply the original revoke for this function.
revoke all on function private.stockflow_sales_coverage_status(text,date,date) from public,anon,authenticated;

commit;
