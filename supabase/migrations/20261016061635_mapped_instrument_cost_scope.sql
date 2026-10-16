begin;
-- Cost only products that can affect mapped instruments, retaining all earlier
-- customer consumption and every native supplier-return stock dependency.
do $guard$
begin
 if encode(extensions.digest(regexp_replace(replace(pg_get_functiondef('private.stockflow_rebuild_instrument_economics(text)'::regprocedure),E'\r',''),'^[[:space:]]+|[[:space:]]+$','','g'),'sha256'),'hex')<>'25a71063e204107a0c521e4ffe106f09be5daa4929dc62ef541b5c4b81c7f3d0' then
  raise exception 'Mapped cost scope requires reviewed rebuild definition';
 end if;
end$guard$;

do $scope$
declare definition text; pair record; occurrences integer;
begin
 select pg_get_functiondef('private.stockflow_rebuild_instrument_economics(text)'::regprocedure) into definition;
 for pair in select * from (values
  ('recovery_origin date;','recovery_origin date; cost_products jsonb;'),
  (' insert into private.stockflow_economic_runs(actor)',
   $replacement$ -- Include all historical mapped memberships. Earlier sales at every customer
 -- still consume stock for these products. Native supplier returns always keep
 -- their complete depletion history, including products without a placement.
 select coalesce(jsonb_object_agg(company_id,products),'{}'::jsonb) into cost_products
 from (select company_id,jsonb_object_agg(product_id,true) products from (
  select company_id,product_id from private.stockflow_economic_mappings where effect='include'
  union
  select m.company_id,p.product_id from private.stockflow_economic_item_group_mappings m
   join private.stockflow_economic_item_catalogs c on c.company_id=m.company_id
   cross join lateral private.stockflow_economic_group_products(c.content,m.group_id) p(product_id)
   where m.effect='include'
  union
  select v.company_id,l.product_id from private.stockflow_economic_source_lines l
   join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where v.kind='purchase_return'
 ) relevant group by company_id) scoped;
 insert into private.stockflow_economic_runs(actor)$replacement$),
  ($q$if row.kind='sale' and private.stockflow_economic_purchase_return_blocked$q$,
   $q$if row.kind='sale' and coalesce((cost_products->row.company_id)?row.product_id,false) and private.stockflow_economic_purchase_return_blocked$q$),
  ($q$if row.kind='sale' and cost is null and row.quantity>0$q$,
   $q$if row.kind='sale' and coalesce((cost_products->row.company_id)?row.product_id,false) and cost is null and row.quantity>0$q$)
 ) patches(old_value,new_value) loop
  occurrences:=(length(definition)-length(replace(definition,pair.old_value,'')))/length(pair.old_value);
  if occurrences<>1 then raise exception 'Expected one mapped costing seam, found %',occurrences;end if;
  definition:=replace(definition,pair.old_value,pair.new_value);
 end loop;
 execute definition;
end$scope$;

revoke all on function private.stockflow_rebuild_instrument_economics(text) from public,anon,authenticated;
commit;
