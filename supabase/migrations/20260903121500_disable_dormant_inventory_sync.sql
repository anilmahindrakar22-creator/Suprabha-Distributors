-- Tally Prime is the sole inventory authority. The dormant experimental product
-- projection must not run during stock snapshot uploads.
drop trigger if exists stockflow_sync_inventory_products on public.stockflow_snapshots;
