begin;
create index if not exists stockflow_economic_source_vouchers_company_date_imported
  on private.stockflow_economic_source_vouchers (company_id, business_date, imported_at);
create index if not exists stockflow_economic_source_vouchers_company_imported
  on private.stockflow_economic_source_vouchers (company_id, imported_at);
create index if not exists stockflow_economic_import_exceptions_sales_date_recorded
  on private.stockflow_economic_import_exceptions (evidence_sales_date, recorded_at);
commit;
