begin;

do $patch$
declare definition text; old_text text; new_text text;
begin
 definition:=replace(pg_get_functiondef('private.stockflow_import_economic_vouchers()'::regprocedure),chr(13),'');
 old_text:=$old$jsonb_build_object('source','connector_sync')$old$;
 new_text:=$new$jsonb_build_object('source','connector_sync')||case when new.payload->>'economicSyncDomain' in ('sales_coverage','instrument_economics') then jsonb_build_object('domain',new.payload->>'economicSyncDomain') else '{}'::jsonb end$new$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then
  raise exception 'Expected one connector sync evidence anchor';
 end if;
 definition:=replace(definition,old_text,new_text);
 old_text:=$old$new.payload:=new.payload-'economicSyncError';$old$;
 new_text:=$new$new.payload:=new.payload-'economicSyncError'-'economicSyncDomain';$new$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then
  raise exception 'Expected one connector sync payload cleanup anchor';
 end if;
 definition:=replace(definition,old_text,new_text);
 execute definition;
end $patch$;
revoke all on function private.stockflow_import_economic_vouchers() from public,anon,authenticated;

create or replace function private.stockflow_economic_item_catalog_current(p_company text) returns boolean
language sql stable set search_path=pg_catalog,private as $$
 select exists(select 1 from private.stockflow_economic_item_catalogs c where c.company_id=p_company
  and not exists(select 1 from private.stockflow_economic_item_catalogs n where n.company_id=c.company_id and n.observed_at>c.observed_at)
  and not exists(select 1 from private.stockflow_economic_import_exceptions e where (e.company_id=p_company or e.company_id is null)
   and e.recorded_at>=c.imported_at and ((e.evidence->>'kind'='item_group_catalog' and coalesce((e.evidence->>'observedAt')::timestamptz>=c.observed_at,true)) or (e.evidence->>'source'='connector_sync' and e.evidence->>'domain' is distinct from 'sales_coverage'))))
$$;
revoke all on function private.stockflow_economic_item_catalog_current(text) from public,anon,authenticated;

commit;
