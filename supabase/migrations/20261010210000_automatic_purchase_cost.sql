begin;

-- Owner policy (10 Oct 2026): reagent purchase cost is taken automatically from
-- imported Tally purchases. No per-sale input is required.
--   1. Same company, item and unit, purchased on or before the sale date.
--   2. A sale with a batch uses only purchases of that batch; a sale without a
--      batch uses any batch. Oldest purchase first (FIFO).
--   3. Purchase quantity is never used twice: current manual verifications are
--      reserved first, then each earlier sale in this rebuild.
--   4. Zero-value supplier purchases are genuine zero cost.
--   5. A sale that cannot be covered completely keeps cost unavailable.
-- A current manual verification still takes precedence. Allocations are a
-- per-run projection: each rebuild recalculates them and keeps old runs.
-- A policy version can switch automatic costing off. A version that leaves it
-- null keeps the latest explicit setting; with no explicit setting it is on.

alter table private.stockflow_economic_policy_versions add column automatic_purchase_cost boolean;

create table private.stockflow_economic_auto_cost_links (
 id uuid primary key default extensions.gen_random_uuid(),
 run_id uuid not null references private.stockflow_economic_runs(id),
 sale_line_id uuid not null references private.stockflow_economic_source_lines(id),
 purchase_line_id uuid not null references private.stockflow_economic_source_lines(id),
 quantity numeric(18,6) not null check(quantity>0),
 cost_paise bigint not null check(cost_paise>=0),
 unique(run_id,sale_line_id,purchase_line_id)
);
create index stockflow_economic_auto_cost_links_purchase on private.stockflow_economic_auto_cost_links(run_id,purchase_line_id);
alter table private.stockflow_economic_auto_cost_links enable row level security;
revoke all on private.stockflow_economic_auto_cost_links from public,anon,authenticated;
create trigger no_delete before delete on private.stockflow_economic_auto_cost_links for each row execute function private.prevent_business_delete();
create trigger immutable before update on private.stockflow_economic_auto_cost_links for each row execute function private.prevent_immutable_pricing_update();

create function private.stockflow_economic_auto_cost_candidates(p_run uuid,p_company text,p_product text,p_unit text,p_batch text,p_date date)
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
  and pl.quantity>0 and pl.net_sales_paise>=0 and pv.business_date<=p_date
  and (p_batch is null or pl.batch_id=p_batch)
  and not exists(select 1 from private.stockflow_economic_source_vouchers nv where nv.company_id=pv.company_id and nv.source_id=pv.source_id and nv.source_revision>pv.source_revision)
  and not exists(select 1 from private.stockflow_economic_acquisition_links a where a.company_id=pv.company_id and a.source_id=pv.source_id and a.line_key=pl.line_key)
$$;
revoke all on function private.stockflow_economic_auto_cost_candidates(uuid,text,text,text,text,date) from public,anon,authenticated;

create function private.stockflow_economic_auto_cost(p_run uuid,p_sale uuid) returns bigint language plpgsql
set search_path=pg_catalog,private,public,extensions as $$
declare sale record; p record; need numeric; available numeric; take numeric; piece bigint; total bigint:=0;
begin
 select l.id,l.product_id,l.unit,l.quantity,l.batch_id,v.company_id,v.business_date into sale
 from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id
 where l.id=p_sale and v.kind='sale' and not v.cancelled;
 if not found or sale.quantity<=0 then return null;end if;
 need:=sale.quantity;
 select coalesce(sum(greatest(c.quantity-c.used_qty,0)),0) into available
 from private.stockflow_economic_auto_cost_candidates(p_run,sale.company_id,sale.product_id,sale.unit,sale.batch_id,sale.business_date) c;
 if available<need then return null;end if;
 for p in select * from private.stockflow_economic_auto_cost_candidates(p_run,sale.company_id,sale.product_id,sale.unit,sale.batch_id,sale.business_date) c where c.quantity>c.used_qty order by c.ordinal loop
  exit when need<=0;
  take:=least(need,p.quantity-p.used_qty);
  piece:=greatest(round(p.net_paise::numeric*(take+p.used_qty)/p.quantity)-p.used_cost,0)::bigint;
  insert into private.stockflow_economic_auto_cost_links(run_id,sale_line_id,purchase_line_id,quantity,cost_paise) values(p_run,p_sale,p.purchase_line_id,take,piece);
  total:=total+piece;need:=need-take;
 end loop;
 return total;
end$$;
revoke all on function private.stockflow_economic_auto_cost(uuid,uuid) from public,anon,authenticated;

do $migration$
declare
  definition text;
  occurrences integer;
  insert_point constant text := '  if error_reason is not null or shares is null then';
  old_reason constant text := $q$'Verified attribution and purchase evidence'$q$;
  new_reason constant text := $q$case when exists(select 1 from private.stockflow_economic_auto_cost_links a where a.run_id=run and a.sale_line_id=row.id) then 'Automatic Tally purchase cost (batch, then oldest first)' else 'Verified attribution and purchase evidence' end$q$;
  old_evidence constant text := $q$'costEvidence',case when v.kind in ('return','credit')$q$;
  new_evidence constant text := $q$'costEvidence',case when exists(select 1 from private.stockflow_economic_auto_cost_links a where a.run_id=r.run_id and a.sale_line_id=r.source_line_id) then (select 'Auto from Tally purchase '||string_agg(coalesce(nullif(btrim(apv.evidence->>'sourceReference'),''),apv.source_id)||' line '||apl.line_key||' · '||trim_scale(a.quantity)::text||' units · ₹'||to_char(a.cost_paise/100.0,'FM999999999990.00'),'; ' order by apv.business_date,apv.source_id,apl.line_key) from private.stockflow_economic_auto_cost_links a join private.stockflow_economic_source_lines apl on apl.id=a.purchase_line_id join private.stockflow_economic_source_vouchers apv on apv.id=apl.voucher_id where a.run_id=r.run_id and a.sale_line_id=r.source_line_id) when v.kind in ('return','credit')$q$;
begin
  select pg_get_functiondef('private.stockflow_rebuild_instrument_economics(text)'::regprocedure) into definition;
  occurrences := (length(definition) - length(replace(definition, insert_point, ''))) / length(insert_point);
  if occurrences <> 1 then raise exception 'Expected one rebuild cost insertion point, found %', occurrences; end if;
  occurrences := (length(definition) - length(replace(definition, old_reason, ''))) / length(old_reason);
  if occurrences <> 1 then raise exception 'Expected one verified-cost reason, found %', occurrences; end if;
  definition := replace(definition, insert_point,
    E'  if row.kind=''sale'' and cost is null and row.quantity>0 and coalesce((select pv.automatic_purchase_cost from private.stockflow_economic_policy_versions pv where pv.automatic_purchase_cost is not null order by pv.recorded_at desc,pv.id desc limit 1),true) then cost:=private.stockflow_economic_auto_cost(run,row.id);end if;\n' || insert_point);
  execute replace(definition, old_reason, new_reason);

  select pg_get_functiondef('private.stockflow_economic_workspace(text[])'::regprocedure) into definition;
  occurrences := (length(definition) - length(replace(definition, old_evidence, ''))) / length(old_evidence);
  if occurrences <> 1 then raise exception 'Expected one attribution cost-evidence fragment, found %', occurrences; end if;
  execute replace(definition, old_evidence, new_evidence);
end
$migration$;

revoke all on function private.stockflow_rebuild_instrument_economics(text) from public,anon,authenticated;
revoke all on function private.stockflow_economic_workspace(text[]) from public,anon,authenticated;

commit;
