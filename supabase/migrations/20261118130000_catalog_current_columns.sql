-- Item catalog freshness was detoasting every import exception's evidence on each call
-- (about 106 ms per call, 259 calls per production rebuild). Stored copies of the three
-- evidence fields it reads keep the check off the large jsonb. Same expressions, so the
-- result is unchanged.
do $guard$
declare definition text;
begin
 definition:=regexp_replace(pg_get_functiondef('private.stockflow_economic_item_catalog_current(text)'::regprocedure),'\s+',' ','g');
 if position('e.'||$old$evidence->>'kind'='item_group_catalog'$old$ in definition)=0
  or position('e.'||$old$evidence->>'source'='connector_sync'$old$ in definition)=0 then
  raise exception 'Unexpected item catalog freshness definition';
 end if;
end $guard$;

alter table private.stockflow_economic_import_exceptions
 add column evidence_source text generated always as (evidence->>'source') stored,
 add column evidence_kind text generated always as (evidence->>'kind') stored,
 add column evidence_observed_at text generated always as (evidence->>'observedAt') stored;

create index stockflow_economic_import_exceptions_catalog_freshness_idx
 on private.stockflow_economic_import_exceptions(company_id,recorded_at)
 where evidence_source='connector_sync' or evidence_kind='item_group_catalog';

create or replace function private.stockflow_economic_item_catalog_current(p_company text) returns boolean
language sql stable set search_path=pg_catalog,private as $$
 select exists(select 1 from private.stockflow_economic_item_catalogs c where c.company_id=p_company
  and not exists(select 1 from private.stockflow_economic_item_catalogs n where n.company_id=c.company_id and n.observed_at>c.observed_at)
  and not exists(select 1 from private.stockflow_economic_import_exceptions e where (e.company_id=p_company or e.company_id is null)
   and e.recorded_at>=c.imported_at
   and ((e.evidence_kind='item_group_catalog' and coalesce(e.evidence_observed_at::timestamptz>=c.observed_at,true))
    or e.evidence_source='connector_sync')))
$$;
