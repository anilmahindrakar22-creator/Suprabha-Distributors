create or replace function private.stockflow_enforce_independent_price_approval()
returns trigger
language plpgsql
set search_path = pg_catalog, private
as $$
begin
  if new.status = 'approved'
     and old.status is distinct from 'approved'
     and lower(btrim(coalesce(new.approved_by_email, ''))) = lower(btrim(new.created_by_email)) then
    raise exception 'Price approval requires an independent reviewer' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists stockflow_independent_price_approval on private.stockflow_customer_product_prices;
create trigger stockflow_independent_price_approval
before update of status, approved_by_email on private.stockflow_customer_product_prices
for each row execute function private.stockflow_enforce_independent_price_approval();

