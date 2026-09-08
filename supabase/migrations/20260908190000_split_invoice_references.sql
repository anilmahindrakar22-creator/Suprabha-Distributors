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

create table private.stockflow_order_tally_invoices (
  voucher_reference text primary key check (char_length(btrim(voucher_reference)) between 1 and 80),
  order_id uuid not null references private.stockflow_orders(id) on delete restrict,
  linked_at timestamptz not null default now()
);
alter table private.stockflow_order_tally_invoices enable row level security;
revoke all on private.stockflow_order_tally_invoices from public, anon, authenticated;
create trigger stockflow_order_tally_invoices_no_delete before delete on private.stockflow_order_tally_invoices
for each row execute function private.prevent_business_delete();

insert into private.stockflow_order_tally_invoices(voucher_reference,order_id)
select btrim(reference), orders.id
from private.stockflow_orders orders
cross join lateral regexp_split_to_table(orders.tally_invoice_number, ',') reference
where orders.tally_invoice_number is not null;

create or replace function private.stockflow_link_order_tally_invoices()
returns trigger language plpgsql security definer
set search_path = pg_catalog, private as $$
declare v_reference text;
begin
  if new.tally_invoice_number is null or (tg_op = 'UPDATE' and new.tally_invoice_number is not distinct from old.tally_invoice_number) then return new; end if;
  for v_reference in select btrim(value) from regexp_split_to_table(new.tally_invoice_number, ',') value loop
    insert into private.stockflow_order_tally_invoices(voucher_reference,order_id)
    values(v_reference,new.id)
    on conflict(voucher_reference) do update set order_id=excluded.order_id
      where stockflow_order_tally_invoices.order_id=excluded.order_id;
    if not found then raise exception 'Tally invoice is already linked to another order' using errcode='23505'; end if;
  end loop;
  return new;
end $$;
revoke all on function private.stockflow_link_order_tally_invoices() from public, anon, authenticated;

create trigger stockflow_orders_link_tally_invoices
after insert or update of tally_invoice_number on private.stockflow_orders
for each row execute function private.stockflow_link_order_tally_invoices();
