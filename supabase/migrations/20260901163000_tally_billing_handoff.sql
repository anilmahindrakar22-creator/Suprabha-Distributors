create unique index if not exists stockflow_orders_tally_invoice_normalized_unique
  on private.stockflow_orders (lower(btrim(tally_invoice_number)))
  where tally_invoice_number is not null;
