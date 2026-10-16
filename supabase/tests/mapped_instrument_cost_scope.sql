-- Cost work follows verified mappings without losing earlier depletion history.
begin;
insert into public.stockflow_snapshots(id,company,fetched_at,payload)
 values('suprabha','SUPRABHA DISTRIBUTORS',now()::text,'{"catalog":[]}'::jsonb) on conflict(id) do nothing;
insert into private.stockflow_economic_mappings(company_id,model_id,product_id,effect,effective_from,reason,verified_by)
 values('cost-scope-company','scope-model','r','include','2026-07-23','Verified individual reagent','test');
do $fixture$
declare catalog jsonb; catalog_id uuid; doc jsonb;
begin
 catalog:='{"groups":[{"id":"g","name":"Mapped group","parentId":null},{"id":"h","name":"Child group","parentId":"g"},{"id":"z","name":"Other group","parentId":null}],"products":[{"id":"g-product","name":"Historical group item","unit":"pack","groupId":"h"},{"id":"f-product","name":"Future group item","unit":"pack","groupId":"z"}]}'::jsonb;
 perform private.stockflow_economic_validate_item_catalog(catalog);
 insert into private.stockflow_economic_item_catalogs(company_id,source_version,observed_at,content)
  values('cost-scope-company','2026-07-01T00:00:00Z','2026-07-01T00:00:00Z',catalog) returning id into catalog_id;
 insert into private.stockflow_economic_item_group_mappings(company_id,model_id,group_id,catalog_id,effect,effective_from,reason,verified_by)
  values('cost-scope-company','scope-model','g',catalog_id,'include','2026-07-23','Verified group and descendants','test');
 -- Moving a product later must not discard its historical mapped membership.
 -- A future group member also needs its earlier unrelated-customer depletion.
 catalog:=jsonb_set(jsonb_set(catalog,'{products,0,groupId}','"z"'),'{products,1,groupId}','"g"');
 insert into private.stockflow_economic_item_catalogs(company_id,source_version,observed_at,content)
  values('cost-scope-company','2026-07-25T00:00:00Z','2026-07-25T00:00:00Z',catalog);
 select jsonb_build_object('schemaVersion',1,'companyId','cost-scope-company','sourceVersion','scope-source-1','completeWindow',false,
  'vouchers',jsonb_agg(jsonb_build_object('sourceId',s.id,'revision','1','date',date '2026-07-01'+s.day,
   'kind',s.kind,'amountStatus','verified','cancelled',false,'customerSourceId',case when s.id like '%early' then 'earlier-other-customer' else 'scope-customer' end,
   'voucherType',case when s.kind='purchase_return' then 'Debit Note' else s.kind end,
   'classificationPolicy',case when s.kind='purchase_return' then 'native_debit_note_v1' else 'native_economic_v1' end,
   'nativeTradeSide',case when s.kind='purchase_return' then 'purchase' else null end,
   'lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId',s.product,'quantity',s.qty,'unit','pack','batchId','B','netSalesPaise',s.amount))))) into doc
 from(values
  ('r-p','purchase','r','5','500',0),('r-early','sale','r','2','600',1),('r-late','sale','r','2','600',23),
  ('u-p','purchase','u','5','500',0),('u-sale','sale','u','5','1000',1),
  ('n-p','purchase','n','3','300',0),('n-early','sale','n','1','300',1),('n-return','purchase_return','n','-2','-200',2),('n-late','sale','n','1','300',3),
  ('g-p','purchase','g-product','4','400',0),('g-early','sale','g-product','1','300',1),('g-late','sale','g-product','2','600',23),
  ('f-p','purchase','f-product','2','200',0),('f-early','sale','f-product','1','300',1),('f-late','sale','f-product','1','300',25)
 )s(id,kind,product,qty,amount,day);
 update public.stockflow_snapshots set payload=jsonb_build_object('catalog','[]'::jsonb,'economicEvidence',doc) where id='suprabha';
 -- Identical product IDs at another company do not inherit this scope.
 doc:=jsonb_build_object('schemaVersion',1,'companyId','other-cost-company','sourceVersion','other-scope-1','completeWindow',false,'vouchers',
  jsonb_build_array(jsonb_build_object('sourceId','other-r-p','revision','1','date','2026-07-01','kind','purchase','amountStatus','verified','lines',
   jsonb_build_array(jsonb_build_object('lineKey','1','productId','r','quantity','2','unit','pack','netSalesPaise','200'))),
  jsonb_build_object('sourceId','other-r-sale','revision','1','date','2026-07-02','kind','sale','amountStatus','verified','customerSourceId','other-customer','lines',
   jsonb_build_array(jsonb_build_object('lineKey','1','productId','r','quantity','1','unit','pack','netSalesPaise','300')))));
 update public.stockflow_snapshots set payload=jsonb_build_object('catalog','[]'::jsonb,'economicEvidence',doc) where id='suprabha';
end$fixture$;
create function pg_temp.scope_cost(p_source text) returns bigint language sql stable
set search_path=pg_catalog,private as $$
 select coalesce(sum(a.cost_paise),0)::bigint from private.stockflow_economic_auto_cost_links a
 join private.stockflow_economic_source_lines l on l.id=a.sale_line_id
 join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id
 where a.run_id=(select id from private.stockflow_economic_runs where active) and v.source_id=p_source
$$;
do $assert$
begin
 if (select count(*) from private.stockflow_economic_source_vouchers where company_id in('cost-scope-company','other-cost-company'))<>17 then raise exception 'Cost scope discarded source evidence';end if;
 if pg_temp.scope_cost('r-early')<>200 or pg_temp.scope_cost('r-late')<>200 then raise exception 'Direct mapped cost lost earlier customer consumption';end if;
 if pg_temp.scope_cost('g-early')<>100 or pg_temp.scope_cost('g-late')<>200 then raise exception 'Historical descendant membership lost depletion';end if;
 if pg_temp.scope_cost('f-early')<>100 or pg_temp.scope_cost('f-late')<>100 then raise exception 'Future group member reused earlier consumption';end if;
 if pg_temp.scope_cost('u-sale')<>0 or pg_temp.scope_cost('other-r-sale')<>0 then raise exception 'Unmapped/company-unrelated item was costed';end if;
 if pg_temp.scope_cost('n-early')<>100 or pg_temp.scope_cost('n-return')<>200 or pg_temp.scope_cost('n-late')<>0 then raise exception 'Native supplier return lost signed stock depletion';end if;
 if exists(select 1 from private.stockflow_economic_import_exceptions where company_id in('cost-scope-company','other-cost-company')) then raise exception 'Valid scope fixture rejected';end if;
end$assert$;
-- A later direct mapping rebuilds the preserved source history automatically.
insert into private.stockflow_economic_mappings(company_id,model_id,product_id,effect,effective_from,reason,verified_by)
 values('cost-scope-company','scope-model','u','include','2026-08-01','New verified individual item','test');
select private.stockflow_rebuild_instrument_economics('new-mapped-scope-fixture');
do $assert$ begin
 if pg_temp.scope_cost('u-sale')<>500 or pg_temp.scope_cost('other-r-sale')<>0 then raise exception 'New mapping failed to recover scoped depletion history';end if;
end$assert$;
rollback;
