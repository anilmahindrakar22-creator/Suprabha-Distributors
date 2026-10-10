begin;

-- Owner policy (10 Oct 2026): automatic reagent cost looks back one year.
-- Only purchases dated within one year before the sale (and not after it) are
-- candidates, for both the batch match and the FIFO fallback. The connector
-- sends 12 months of purchase history so these purchases are present.
create or replace function private.stockflow_economic_auto_cost_candidates(p_run uuid,p_company text,p_product text,p_unit text,p_batch text,p_date date)
returns table(purchase_line_id uuid,ordinal bigint,quantity numeric,net_paise bigint,used_qty numeric,used_cost numeric) language sql stable
set search_path=pg_catalog,private,public,extensions as $$
 select pl.id,row_number() over(order by pv.business_date,pv.source_id,pl.line_key,pl.id),pl.quantity,pl.net_sales_paise,
  coalesce(manual.qty,0)+coalesce(auto.qty,0),coalesce(manual.cost,0)+coalesce(auto.cost,0)
 from private.stockflow_economic_source_lines pl join private.stockflow_economic_source_vouchers pv on pv.id=pl.voucher_id
 left join lateral(select sum(cl.quantity) qty,sum(cl.cost_paise) cost from private.stockflow_economic_cost_links cl
  join private.stockflow_economic_source_lines sl on sl.id=cl.sale_line_id join private.stockflow_economic_source_vouchers sv on sv.id=sl.voucher_id
  where cl.purchase_line_id=pl.id and cl.verification_id=(select cv.id from private.stockflow_economic_cost_verifications cv where cv.sale_line_id=cl.sale_line_id order by cv.revision desc limit 1)
   and not sv.cancelled and not exists(select 1 from private.stockflow_economic_source_vouchers nv where nv.company_id=sv.company_id and nv.source_id=sv.source_id and nv.source_revision>sv.source_revision)) manual on true
 left join lateral(select sum(a.quantity) qty,sum(a.cost_paise) cost from private.stockflow_economic_auto_cost_links a where a.run_id=p_run and a.purchase_line_id=pl.id) auto on true
 where pv.kind='purchase' and not pv.cancelled and pv.company_id=p_company and pl.product_id=p_product and pl.unit=p_unit
  and pl.quantity>0 and pl.net_sales_paise>=0 and pv.business_date<=p_date and pv.business_date>=(p_date-interval '1 year')::date
  and (p_batch is null or pl.batch_id=p_batch)
  and not exists(select 1 from private.stockflow_economic_source_vouchers nv where nv.company_id=pv.company_id and nv.source_id=pv.source_id and nv.source_revision>pv.source_revision)
  and not exists(select 1 from private.stockflow_economic_acquisition_links a where a.company_id=pv.company_id and a.source_id=pv.source_id and a.line_key=pl.line_key)
$$;
revoke all on function private.stockflow_economic_auto_cost_candidates(uuid,text,text,text,text,date) from public,anon,authenticated;

commit;
