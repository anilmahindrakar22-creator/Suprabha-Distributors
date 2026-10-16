begin;

-- Measured production-sized replay: repeated SQL planning dominated the first
-- economic import. Cache identical lookup plans; retain accounting/stock rules.
do $guard$
declare signature text; expected text; actual text;
begin
 for signature,expected in select * from (values
 ('private.stockflow_economic_auto_cost_candidates(uuid,text,text,text,text,date)','e15a63653c18b7460b198d7da096dd0b2dfc1a05fc5b5f4bc6032fdadb7e56e5'),
 ('private.stockflow_economic_purchase_return_blocked(uuid,text,text,text,date)','47e68a8237d772a9837f161fcef02bcd304f544700fc3075aca439143858abfa'),
 ('private.stockflow_import_economic_vouchers()','344ede6b12988a22b5ce1b9277a1a15d008257602616df14f97eb14eab86c3d6')
 ) reviewed(signature,expected) loop
  actual:=encode(extensions.digest(regexp_replace(replace(pg_get_functiondef(signature::regprocedure),E'\r',''),'^[[:space:]]+|[[:space:]]+$','','g'),'sha256'),'hex');
  if actual<>expected then raise exception 'Economic execution source guard failed: %',signature;end if;
 end loop;
end$guard$;

create index stockflow_economic_source_product_unit on private.stockflow_economic_source_lines(product_id,unit,voucher_id);
create index stockflow_economic_cost_by_sale on private.stockflow_economic_cost_links(sale_line_id,verification_id);
create index stockflow_economic_cost_by_purchase on private.stockflow_economic_cost_links(purchase_line_id,verification_id);
create index stockflow_economic_verification_latest on private.stockflow_economic_cost_verifications(sale_line_id,revision desc);
create index stockflow_economic_result_by_source on private.stockflow_economic_results(run_id,source_line_id);

create index stockflow_economic_return_shortage on private.stockflow_economic_results(run_id,source_line_id) where reason='purchase_return_stock_unavailable';

CREATE OR REPLACE FUNCTION private.stockflow_economic_auto_cost_candidates(p_run uuid, p_company text, p_product text, p_unit text, p_batch text, p_date date)
 RETURNS TABLE(purchase_line_id uuid, ordinal bigint, quantity numeric, net_paise bigint, used_qty numeric, used_cost numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'private', 'public', 'extensions'
AS $function$
begin
 return query select pl.id,row_number() over(order by pv.business_date,pv.source_id,pl.line_key,pl.id),pl.quantity,pl.net_sales_paise,
  coalesce(manual.qty,0)+coalesce(auto.qty,0),coalesce(manual.cost,0)+coalesce(auto.cost,0)
 from private.stockflow_economic_source_lines pl join private.stockflow_economic_source_vouchers pv on pv.id=pl.voucher_id
 left join lateral(select sum(cl.quantity) qty,sum(cl.cost_paise) cost from private.stockflow_economic_cost_links cl
  join private.stockflow_economic_source_lines sl on sl.id=cl.sale_line_id join private.stockflow_economic_source_vouchers sv on sv.id=sl.voucher_id
  where cl.purchase_line_id=pl.id and cl.verification_id=(select cv.id from private.stockflow_economic_cost_verifications cv where cv.sale_line_id=cl.sale_line_id order by cv.revision desc limit 1)
   and not sv.cancelled and not exists(select 1 from private.stockflow_economic_source_vouchers nv where nv.company_id=sv.company_id and nv.source_id=sv.source_id and nv.source_revision>sv.source_revision)) manual on true
 left join lateral(select sum(a.quantity) qty,sum(a.cost_paise) cost from private.stockflow_economic_auto_cost_links a where a.run_id=p_run and a.purchase_line_id=pl.id) auto on true
 where not private.stockflow_economic_purchase_return_blocked(p_run,p_company,p_product,p_unit,p_date)
  and pv.kind='purchase' and not pv.cancelled and pv.company_id=p_company and pl.product_id=p_product and pl.unit=p_unit
  and pl.quantity>0 and pl.net_sales_paise>=0 and pv.business_date<=p_date and pv.business_date>=(p_date-interval '1 year')::date
  and (p_batch is null or pl.batch_id=p_batch)
  and not exists(select 1 from private.stockflow_economic_source_vouchers nv where nv.company_id=pv.company_id and nv.source_id=pv.source_id and nv.source_revision>pv.source_revision)
  and not exists(select 1 from private.stockflow_economic_acquisition_links a where a.company_id=pv.company_id and a.source_id=pv.source_id and a.line_key=pl.line_key);
end
$function$;
create or replace function private.stockflow_economic_purchase_return_blocked(p_run uuid,p_company text,p_product text,p_unit text,p_date date) returns boolean language plpgsql stable set search_path=pg_catalog,private as $cached$ begin return exists(select 1 from private.stockflow_economic_results r join private.stockflow_economic_source_lines l on l.id=r.source_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where r.run_id=p_run and r.reason='purchase_return_stock_unavailable' and v.company_id=p_company and l.product_id=p_product and l.unit=p_unit and v.business_date<=p_date);end $cached$;

-- Generation publication is required only after admitted source or catalog changes.
-- Repeat uploads still validate identities, retain exceptions and check coverage.
do $upgrade$
declare definition text; old_value text; new_value text; occurrences integer; pair record;
begin
 select pg_get_functiondef('private.stockflow_import_economic_vouchers()'::regprocedure) into definition;
 for pair in select * from (values
  ('catalog_seen_at timestamptz;','catalog_seen_at timestamptz; catalog_changed boolean:=false; source_changed boolean:=false;'),
  ($q$values(doc->>'companyId',doc->>'sourceVersion',catalog_seen_at,doc->'itemCatalog');$q$,
   $q$values(doc->>'companyId',doc->>'sourceVersion',catalog_seen_at,doc->'itemCatalog');catalog_changed:=true;$q$),
  (E'   end loop;
  exception when data_exception',E'   end loop;
   source_changed:=true;
  exception when data_exception'),
  ($q$if exists(select 1 from private.stockflow_economic_source_vouchers where imported_at=now()) or doc->'itemCatalog' is not null then$q$,
   'if source_changed or catalog_changed then')
 ) patches(old_value,new_value) loop
  occurrences:=(length(definition)-length(replace(definition,pair.old_value,'')))/length(pair.old_value);
  if occurrences<>1 then raise exception 'Expected one economic no-change seam, found %',occurrences;end if;
  definition:=replace(definition,pair.old_value,pair.new_value);
 end loop;
 execute definition;
end$upgrade$;

-- PostgREST supports function-specific deadlines. Keep ordinary role/read limits.
-- Service-only ingestion preserves the existing single-row upsert and all triggers.
create function public.stockflow_sync_snapshot(p_payload jsonb) returns void
language plpgsql set search_path=pg_catalog,public set statement_timeout='20s' as $snapshot$
declare fetched text;
begin
 if jsonb_typeof(p_payload) is distinct from 'object'
  or upper(btrim(coalesce(p_payload->>'company','')))<>'SUPRABHA DISTRIBUTORS'
  or jsonb_typeof(p_payload->'rows') is distinct from 'array'
  or jsonb_typeof(p_payload->'groups') is distinct from 'array' then
  raise exception 'Invalid single-company snapshot' using errcode='22023';
 end if;
 fetched:=coalesce(nullif(p_payload->>'fetchedAtIso',''),nullif(p_payload->>'fetchedAt',''));
 if nullif(btrim(fetched),'') is null then raise exception 'Snapshot needs source extraction time' using errcode='22023';end if;
 insert into public.stockflow_snapshots(id,company,fetched_at,payload,updated_at)
 values('suprabha',p_payload->>'company',fetched,p_payload,clock_timestamp())
 on conflict(id) do update set company=excluded.company,fetched_at=excluded.fetched_at,
  payload=excluded.payload,updated_at=excluded.updated_at;
end$snapshot$;
revoke all on function public.stockflow_sync_snapshot(jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_sync_snapshot(jsonb) to service_role;
alter function public.stockflow_economics_gateway(text,text,text,jsonb) set statement_timeout='20s';
revoke all on function private.stockflow_economic_auto_cost_candidates(uuid,text,text,text,text,date),
 private.stockflow_economic_purchase_return_blocked(uuid,text,text,text,date),
 private.stockflow_import_economic_vouchers() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
