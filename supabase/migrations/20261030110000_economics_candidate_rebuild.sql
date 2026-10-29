begin;

-- Final predecessor: 20261016061635_mapped_instrument_cost_scope.sql.
-- Preserve the deployed body, including its total-source guard, for acceptance.
-- Rollback is a rename swap: rename the live function to a spare name, then
-- rename stockflow_rebuild_instrument_economics_full_scan to the live name.
-- Restore the live function's prior ACL when swapping; the reference is private.
do $reference$
declare definition text; anchor text := 'private.stockflow_rebuild_instrument_economics(p_actor text)';
begin
 definition:=pg_get_functiondef('private.stockflow_rebuild_instrument_economics(text)'::regprocedure);
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
  raise exception 'Expected exactly one rebuild signature for reference copy';
 end if;
 execute replace(definition,anchor,'private.stockflow_rebuild_instrument_economics_full_scan(p_actor text)');
end$reference$;
revoke all on function private.stockflow_rebuild_instrument_economics_full_scan(text) from public,anon,authenticated,service_role;

-- One definition of candidates; the caller supplies its existing cost_products.
-- All predicates intentionally include historical/unapproved human evidence.
create function private.stockflow_economic_rebuild_candidates(p_cost_products jsonb)
returns table(line_id uuid) language sql stable set search_path=pg_catalog,private as $$
 select l.id
 from private.stockflow_economic_source_lines l
 join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id
 where v.kind<>'purchase' and not v.cancelled and not exists(select 1 from private.stockflow_economic_source_vouchers newer where newer.company_id=v.company_id and newer.source_id=v.source_id and newer.source_revision>v.source_revision)
 and (
  v.kind<>'sale'
  or exists(select 1 from private.stockflow_economic_targets t
   where t.kind='placement' and t.company_id=v.company_id and t.customer_source_id=v.customer_source_id)
  or exists(select 1 from private.stockflow_economic_instrument_billings b
   where b.company_id=v.company_id and b.source_id=v.source_id and b.line_key=l.line_key)
  or coalesce((p_cost_products->v.company_id)?l.product_id,false)
  or exists(select 1 from private.stockflow_economic_line_reviews r where r.source_line_id=l.id)
  or exists(select 1 from private.stockflow_economic_cost_verifications c where c.sale_line_id=l.id)
 )
$$;
revoke all on function private.stockflow_economic_rebuild_candidates(jsonb) from public,anon,authenticated,service_role;

do $patch$
declare definition text; pair record; occurrences integer;
begin
 definition:=pg_get_functiondef('private.stockflow_rebuild_instrument_economics(text)'::regprocedure);
 for pair in select * from (values
  ($old$cost_products jsonb;$old$,
   $new$cost_products jsonb; rebuild_candidate_ids uuid[];$new$),
  ($old$if (select count(*) from private.stockflow_economic_source_lines)>10000 then raise exception 'Economic rebuild exceeds V1 limit; narrow source window' using errcode='54000';end if;$old$,
   ''),
  ($old$ insert into private.stockflow_economic_runs(actor)$old$,
   $new$ -- Function-local storage is fresh on every call, including within one transaction.
 select coalesce(array_agg(line_id),array[]::uuid[]) into rebuild_candidate_ids
 from private.stockflow_economic_rebuild_candidates(cost_products);
 if cardinality(rebuild_candidate_ids)>10000 then raise exception 'Economic rebuild candidate lines exceed V1 limit' using errcode='54000';end if;
 insert into private.stockflow_economic_runs(actor)$new$),
  ($old$ for row in$old$,
   $new$ insert into private.stockflow_economic_results(run_id,source_line_id,status,reason,share_bps,quantity,revenue_paise)
 select run,l.id,'unattributed','no_verified_compatible_placement',10000,l.quantity,l.net_sales_paise
 from private.stockflow_economic_source_lines l join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id
 where v.kind<>'purchase' and not v.cancelled and not exists(select 1 from private.stockflow_economic_source_vouchers newer where newer.company_id=v.company_id and newer.source_id=v.source_id and newer.source_revision>v.source_revision)
  and not (l.id=any(rebuild_candidate_ids));
 for row in$new$),
  ($old$  where v.kind<>'purchase' and not v.cancelled and not exists(select 1 from private.stockflow_economic_source_vouchers newer where newer.company_id=v.company_id and newer.source_id=v.source_id and newer.source_revision>v.source_revision)$old$,
   $new$  where v.kind<>'purchase' and not v.cancelled and not exists(select 1 from private.stockflow_economic_source_vouchers newer where newer.company_id=v.company_id and newer.source_id=v.source_id and newer.source_revision>v.source_revision)
   and l.id=any(rebuild_candidate_ids)$new$)
 ) patches(old_value,new_value) loop
  occurrences:=(length(definition)-length(replace(definition,pair.old_value,'')))/length(pair.old_value);
  if occurrences<>1 then raise exception 'Expected exactly one candidate rebuild anchor %, found %',pair.old_value,occurrences;end if;
  definition:=replace(definition,pair.old_value,pair.new_value);
 end loop;
 execute definition;
end$patch$;
revoke all on function private.stockflow_rebuild_instrument_economics(text) from public,anon,authenticated;
commit;
