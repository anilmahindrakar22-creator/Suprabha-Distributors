-- A previously approved snapshot remains immutable, but must be current when handed to billing.
create or replace function private.stockflow_require_current_pricing_evidence()
returns trigger language plpgsql set search_path=pg_catalog,private as $$
declare decision private.stockflow_order_pricing_decisions%rowtype; current_price jsonb;
begin
  if new.status is distinct from old.status and new.status in ('awaiting_tally_billing','billed_in_tally') then
    if new.pricing_state<>'approved' or new.pricing_snapshot_id is null then
      raise exception 'Pricing approval is required before billing' using errcode='22023';
    end if;
    lock table private.stockflow_tally_sales_prices,private.stockflow_tally_purchase_costs,private.stockflow_pricing_policies,private.stockflow_customer_product_prices,private.stockflow_standard_item_prices,private.stockflow_price_book_decisions in share mode;
    for decision in
      select d.* from private.stockflow_order_lines l
      join private.stockflow_order_pricing_decisions d on d.id=l.approved_pricing_decision_id
      where l.order_id=new.id
    loop
      current_price:=private.stockflow_resolve_pricing_line(decision.order_line_id,(now() at time zone 'Asia/Kolkata')::date);
      if decision.evidence_hash is distinct from current_price->>'evidenceHash' then
        raise exception 'Pricing evidence changed after approval; review pricing again before billing' using errcode='40001';
      end if;
    end loop;
  end if;
  return new;
end $$;
revoke all on function private.stockflow_require_current_pricing_evidence() from public,anon,authenticated;
create trigger stockflow_require_current_pricing_evidence before update of status on private.stockflow_orders
for each row execute function private.stockflow_require_current_pricing_evidence();
