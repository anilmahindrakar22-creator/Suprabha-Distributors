alter table private.stockflow_orders
  add constraint stockflow_orders_tally_invoice_references_bounded
  check (
    tally_invoice_number is null or (
      char_length(tally_invoice_number) between 1 and 160
      and char_length(tally_invoice_number) - char_length(replace(tally_invoice_number, ',', '')) <= 4
      and tally_invoice_number ~ '^[[:space:]]*[^,[:space:]][^,]*(,[[:space:]]*[^,[:space:]][^,]*){0,4}$'
    )
  );

comment on constraint stockflow_orders_tally_invoice_references_bounded on private.stockflow_orders is
  'Allows one or up to five comma-separated Tally sales voucher references for split billing.';
