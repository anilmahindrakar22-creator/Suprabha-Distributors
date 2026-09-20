-- Owner-approved policy: authorized pricing approvers may approve proposals
-- they created. Role authorization, optimistic locking, idempotency and audit
-- remain enforced by public.stockflow_pricing_gateway.
drop trigger if exists stockflow_independent_price_approval
  on private.stockflow_customer_product_prices;

drop function if exists private.stockflow_enforce_independent_price_approval();
