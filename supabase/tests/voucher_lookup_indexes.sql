begin;
do $test$
declare index_definition text; plan json;
begin
  select indexdef into index_definition from pg_indexes
    where schemaname='private' and indexname='stockflow_economic_source_vouchers_company_date_imported';
  if index_definition is null or position('(company_id, business_date, imported_at)' in index_definition)=0 then
    raise exception 'Missing or incorrect voucher company/date/imported index: %',index_definition;
  end if;
  select indexdef into index_definition from pg_indexes
    where schemaname='private' and indexname='stockflow_economic_source_vouchers_company_imported';
  if index_definition is null or position('(company_id, imported_at)' in index_definition)=0 then
    raise exception 'Missing or incorrect voucher company/imported index: %',index_definition;
  end if;
  select indexdef into index_definition from pg_indexes
    where schemaname='private' and indexname='stockflow_economic_import_exceptions_sales_date_recorded';
  if index_definition is null or position('(evidence_sales_date, recorded_at)' in index_definition)=0 then
    raise exception 'Missing or incorrect import exception sales-date/recorded index: %',index_definition;
  end if;
  perform set_config('enable_seqscan','off',true);
  execute $query$explain (format json)
    select 1 from private.stockflow_economic_source_vouchers
    where company_id='x' and business_date='2026-07-24'$query$ into plan;
  if plan::text not like '%stockflow_economic_source_vouchers_company_date_imported%' then
    raise exception 'Expected voucher lookup index in plan: %',plan;
  end if;
  raise notice 'PASS voucher lookup indexes';
end $test$;
rollback;
