begin;
do $test$
declare index_definition text;
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
  raise notice 'PASS voucher lookup indexes';
end $test$;
rollback;
