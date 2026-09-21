create table private.stockflow_pricing_import_runs (
  id bigint generated always as identity primary key,
  source_version text not null,
  sales_received integer not null check (sales_received >= 0),
  sales_accepted integer not null check (sales_accepted >= 0),
  sales_duplicates integer not null check (sales_duplicates >= 0),
  sales_unmatched_customers integer not null check (sales_unmatched_customers >= 0),
  sales_rejected integer not null check (sales_rejected >= 0),
  purchase_received integer not null check (purchase_received >= 0),
  purchase_accepted integer not null check (purchase_accepted >= 0),
  purchase_duplicates integer not null check (purchase_duplicates >= 0),
  purchase_rejected integer not null check (purchase_rejected >= 0),
  rejection_summary jsonb not null,
  imported_at timestamptz not null default clock_timestamp(),
  check (jsonb_typeof(rejection_summary) = 'object')
);

alter table private.stockflow_pricing_import_runs enable row level security;
create index stockflow_pricing_import_runs_recent_idx
  on private.stockflow_pricing_import_runs(imported_at desc);
create trigger stockflow_pricing_import_runs_immutable
  before update on private.stockflow_pricing_import_runs
  for each row execute function private.prevent_immutable_pricing_update();
create trigger stockflow_pricing_import_runs_no_delete
  before delete on private.stockflow_pricing_import_runs
  for each row execute function private.prevent_business_delete();

create or replace function private.stockflow_import_tally_pricing_evidence()
returns trigger language plpgsql set search_path=pg_catalog,private as $$
declare
  entry jsonb; customer private.stockflow_customers%rowtype; affected integer;
  sales_received integer:=0; sales_accepted integer:=0; sales_duplicates integer:=0;
  sales_unmatched integer:=0; sales_rejected integer:=0;
  purchase_received integer:=0; purchase_accepted integer:=0;
  purchase_duplicates integer:=0; purchase_rejected integer:=0;
begin
  if new.id<>'suprabha' or jsonb_typeof(new.payload->'pricingHistory')<>'object' then return new; end if;
  if jsonb_typeof(new.payload->'pricingHistory'->'sales')='array' then
    sales_received:=jsonb_array_length(new.payload->'pricingHistory'->'sales');
    if sales_received>5000 then raise exception 'Pricing sales evidence exceeds the safe import limit' using errcode='54000'; end if;
    for entry in select value from jsonb_array_elements(new.payload->'pricingHistory'->'sales') loop
      customer:=null;
      select * into customer from private.stockflow_customers
        where active and tally_key=nullif(btrim(entry->>'customerTallyKey'),'') limit 1;
      if customer.id is null then sales_unmatched:=sales_unmatched+1; continue; end if;
      begin
        insert into private.stockflow_tally_sales_prices(customer_id,tally_item_key,invoice_rate,invoice_date,invoice_reference,source_id,source_version,exceptional,exception_type)
        values(customer.id,btrim(entry->>'tallyItemKey'),(entry->>'rate')::numeric,(entry->>'invoiceDate')::date,btrim(entry->>'invoiceReference'),btrim(entry->>'sourceId'),btrim(entry->>'sourceVersion'),coalesce((entry->>'exceptional')::boolean,false),nullif(entry->>'exceptionType',''))
        on conflict(source_id,source_version) do nothing;
        get diagnostics affected=row_count;
        if affected=1 then sales_accepted:=sales_accepted+1; else sales_duplicates:=sales_duplicates+1; end if;
      exception when data_exception or check_violation or not_null_violation then
        sales_rejected:=sales_rejected+1;
      end;
    end loop;
  end if;
  if jsonb_typeof(new.payload->'pricingHistory'->'purchaseCosts')='array' then
    purchase_received:=jsonb_array_length(new.payload->'pricingHistory'->'purchaseCosts');
    if purchase_received>5000 then raise exception 'Purchase-cost evidence exceeds the safe import limit' using errcode='54000'; end if;
    for entry in select value from jsonb_array_elements(new.payload->'pricingHistory'->'purchaseCosts') loop
      begin
        insert into private.stockflow_tally_purchase_costs(tally_item_key,cost_amount,cost_kind,effective_at,source_reference,source_id,source_version)
        values(btrim(entry->>'tallyItemKey'),(entry->>'amount')::numeric,coalesce(nullif(entry->>'kind',''),'purchase_price'),(entry->>'effectiveAt')::date,btrim(entry->>'sourceReference'),btrim(entry->>'sourceId'),btrim(entry->>'sourceVersion'))
        on conflict(source_id,source_version) do nothing;
        get diagnostics affected=row_count;
        if affected=1 then purchase_accepted:=purchase_accepted+1; else purchase_duplicates:=purchase_duplicates+1; end if;
      exception when data_exception or check_violation or not_null_violation then
        purchase_rejected:=purchase_rejected+1;
      end;
    end loop;
  end if;
  insert into private.stockflow_pricing_import_runs(
    source_version,sales_received,sales_accepted,sales_duplicates,sales_unmatched_customers,sales_rejected,
    purchase_received,purchase_accepted,purchase_duplicates,purchase_rejected,rejection_summary
  ) values (
    coalesce(nullif(new.payload->>'fetchedAtIso',''),nullif(new.payload->>'fetchedAt',''),'unknown'),
    sales_received,sales_accepted,sales_duplicates,sales_unmatched,sales_rejected,
    purchase_received,purchase_accepted,purchase_duplicates,purchase_rejected,
    jsonb_build_object('invalid_sales',sales_rejected,'unmatched_customer',sales_unmatched,'invalid_purchase_cost',purchase_rejected)
  );
  new.payload:=new.payload-'pricingHistory';
  return new;
end $$;

revoke all on function private.stockflow_import_tally_pricing_evidence() from public,anon,authenticated;
