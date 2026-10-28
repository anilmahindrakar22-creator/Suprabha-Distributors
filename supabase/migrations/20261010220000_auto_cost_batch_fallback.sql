begin;

-- Owner policy (10 Oct 2026): when a sale's batch number does not match Tally
-- purchases that can cover it, cost the sale by FIFO across all batches of the
-- item. A sale spanning several purchases gets their weighted average cost.
-- An exact batch match that covers the whole sale is still used first.
-- Insufficient total quantity, or no purchase on or before the sale date,
-- still leaves cost unavailable.
create or replace function private.stockflow_economic_auto_cost(p_run uuid,p_sale uuid) returns bigint language plpgsql
set search_path=pg_catalog,private,public,extensions as $$
declare sale record; p record; need numeric; available numeric; take numeric; piece bigint; total bigint:=0; batch text;
begin
 select l.id,l.product_id,l.unit,l.quantity,l.batch_id,v.company_id,v.business_date into sale
 from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id
 where l.id=p_sale and v.kind='sale' and not v.cancelled;
 if not found or sale.quantity<=0 then return null;end if;
 need:=sale.quantity;
 batch:=sale.batch_id;
 select coalesce(sum(greatest(c.quantity-c.used_qty,0)),0) into available
 from private.stockflow_economic_auto_cost_candidates(p_run,sale.company_id,sale.product_id,sale.unit,batch,sale.business_date) c;
 if available<need and batch is not null then
  batch:=null;
  select coalesce(sum(greatest(c.quantity-c.used_qty,0)),0) into available
  from private.stockflow_economic_auto_cost_candidates(p_run,sale.company_id,sale.product_id,sale.unit,null,sale.business_date) c;
 end if;
 if available<need then return null;end if;
 for p in select * from private.stockflow_economic_auto_cost_candidates(p_run,sale.company_id,sale.product_id,sale.unit,batch,sale.business_date) c where c.quantity>c.used_qty order by c.ordinal loop
  exit when need<=0;
  take:=least(need,p.quantity-p.used_qty);
  piece:=greatest(round(p.net_paise::numeric*(take+p.used_qty)/p.quantity)-p.used_cost,0)::bigint;
  insert into private.stockflow_economic_auto_cost_links(run_id,sale_line_id,purchase_line_id,quantity,cost_paise) values(p_run,p_sale,p.purchase_line_id,take,piece);
  total:=total+piece;need:=need-take;
 end loop;
 return total;
end$$;
revoke all on function private.stockflow_economic_auto_cost(uuid,uuid) from public,anon,authenticated;

commit;
