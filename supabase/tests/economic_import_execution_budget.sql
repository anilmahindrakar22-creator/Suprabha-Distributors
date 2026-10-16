-- Real service-role write boundary, generation idempotency and changed evidence.
begin;
grant select,insert,update on public.stockflow_snapshots to service_role;
create policy execution_budget_upload_test on public.stockflow_snapshots
 for all to service_role using(true) with check(true);
create temporary table execution_budget_fixture as select jsonb_build_object(
 'company','SUPRABHA DISTRIBUTORS','fetchedAtIso','2026-07-31T12:00:00Z',
 'rows','[]'::jsonb,'groups','[]'::jsonb,'economicEvidence',jsonb_build_object(
  'schemaVersion',1,'companyId','execution-budget-company','sourceVersion','2026-07-31T12:00:00Z',
  'completeWindow',false,'windowFrom','2026-07-01','windowTo','2026-08-01',
  'itemCatalog',jsonb_build_object('groups',jsonb_build_array(jsonb_build_object(
   'id','budget-group','name','Budget group','parentId',null)),
   'products',jsonb_build_array(jsonb_build_object('id','budget-product','name','Budget product','unit','Nos','groupId','budget-group'))),
  'vouchers',jsonb_build_array(
   jsonb_build_object('sourceId','budget-purchase','revision','1','date','2026-07-01','kind','purchase','cancelled',false,'amountStatus','verified',
    'lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','budget-product','quantity','10','unit','Nos','netSalesPaise','1000'))),
   jsonb_build_object('sourceId','budget-sale','revision','1','date','2026-07-02','kind','sale','customerSourceId','budget-customer','cancelled',false,'amountStatus','verified',
    'lines',jsonb_build_array(jsonb_build_object('lineKey','1','productId','budget-product','quantity','1','unit','Nos','netSalesPaise','200')))
  )
 )) payload;
grant select on execution_budget_fixture to service_role;
create temporary table execution_budget_before as select count(*) runs from private.stockflow_economic_runs;
set local role service_role;
select public.stockflow_sync_snapshot(payload) from execution_budget_fixture;
reset role;

do $test$
declare generation uuid; run_count integer; catalog_count integer; rejected integer; snapshot_hash text; definition text;
begin
 if has_function_privilege('anon','public.stockflow_sync_snapshot(jsonb)','EXECUTE')
  or has_function_privilege('authenticated','public.stockflow_sync_snapshot(jsonb)','EXECUTE')
  or not has_function_privilege('service_role','public.stockflow_sync_snapshot(jsonb)','EXECUTE') then
  raise exception 'Snapshot RPC access expanded';end if;
 if not exists(select 1 from pg_proc where oid='public.stockflow_sync_snapshot(jsonb)'::regprocedure and not prosecdef
  and proconfig@>array['statement_timeout=20s','search_path=pg_catalog, public']) then raise exception 'Snapshot budget/safe invoker metadata missing';end if;
 if not exists(select 1 from pg_proc where oid='public.stockflow_economics_gateway(text,text,text,jsonb)'::regprocedure
  and proconfig@>array['statement_timeout=20s']) then raise exception 'Economics command budget missing';end if;
 if (select count(*) from private.stockflow_economic_runs)<>(select runs+1 from execution_budget_before) then raise exception 'First import did not publish exactly once';end if;
 select id into generation from private.stockflow_economic_runs where active;
 if exists(select 1 from private.stockflow_economic_auto_cost_links a where a.run_id=generation) then raise exception 'Unmapped product triggered automatic costing';end if;
 select count(*) into run_count from private.stockflow_economic_runs;
 select count(*) into catalog_count from private.stockflow_economic_item_catalogs;

 -- A new observation version with identical catalog/source content is a no-op.
 update execution_budget_fixture set payload=jsonb_set(payload,'{economicEvidence,sourceVersion}','"2026-08-01T12:00:00Z"');
 perform public.stockflow_sync_snapshot(payload) from execution_budget_fixture;
 if (select count(*) from private.stockflow_economic_runs)<>run_count
  or (select count(*) from private.stockflow_economic_item_catalogs)<>catalog_count then raise exception 'Identical source/catalog rebuilt economic ledger';end if;

 -- A genuine catalog change must publish even without new voucher revisions.
 update execution_budget_fixture set payload=jsonb_set(jsonb_set(payload,'{economicEvidence,sourceVersion}','"2026-08-02T12:00:00Z"'),
  '{economicEvidence,itemCatalog,products,0,name}','"Renamed budget product"');
 perform public.stockflow_sync_snapshot(payload) from execution_budget_fixture;
 if (select count(*) from private.stockflow_economic_runs)<>run_count+1
  or (select count(*) from private.stockflow_economic_item_catalogs)<>catalog_count+1 then raise exception 'Changed catalog was not published';end if;

 -- Cancellation must restate the generation and release historical allocations.
 update execution_budget_fixture set payload=jsonb_set(payload,'{economicEvidence,vouchers,1}',
  (payload#>'{economicEvidence,vouchers,1}')||'{"revision":"2","cancelled":true,"lines":[]}'::jsonb);
 perform public.stockflow_sync_snapshot(payload) from execution_budget_fixture;
 if (select count(*) from private.stockflow_economic_runs)<>run_count+2 then raise exception 'Cancellation did not rebuild';end if;
 select id into generation from private.stockflow_economic_runs where active;
 if exists(select 1 from private.stockflow_economic_auto_cost_links where run_id=generation) then raise exception 'Cancelled sale still reserves stock';end if;

 -- Rejected evidence remains visible without publishing a false generation.
 select count(*) into rejected from private.stockflow_economic_import_exceptions;
 update execution_budget_fixture set payload=jsonb_set(payload,'{economicEvidence,vouchers,1,amountStatus}','"unverified"');
 perform public.stockflow_sync_snapshot(payload) from execution_budget_fixture;
 if (select count(*) from private.stockflow_economic_import_exceptions)<>rejected+1
  or (select count(*) from private.stockflow_economic_runs)<>run_count+2 then raise exception 'Rejected replay hid evidence or rebuilt';end if;

 select md5(payload::text) into snapshot_hash from public.stockflow_snapshots where id='suprabha';
 begin perform public.stockflow_sync_snapshot('{"company":"OTHER COMPANY","fetchedAt":"fake","rows":[],"groups":[]}'::jsonb);
  raise exception 'Wrong company accepted';exception when invalid_parameter_value then null;end;
 if (select md5(payload::text) from public.stockflow_snapshots where id='suprabha')<>snapshot_hash then raise exception 'Invalid RPC changed stored snapshot';end if;
end$test$;
rollback;
