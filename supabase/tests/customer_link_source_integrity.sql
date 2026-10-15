begin;
insert into public.stockflow_snapshots(id,company,fetched_at,payload)
 values('suprabha','SUPRABHA TEST',now()::text,'{}') on conflict(id) do nothing;
create function private.stockflow_test_link_source(p_company text,p_version text,p_ledgers jsonb) returns void
language sql set search_path=pg_catalog,private,public as $$
 update public.stockflow_snapshots set payload=jsonb_build_object('economicEvidence',jsonb_build_object(
  'schemaVersion','1','companyId',p_company,'sourceVersion',p_version,'completeWindow',true,
  'windowFrom','2026-10-01','windowTo','2026-11-01','vouchers','[]'::jsonb,'customerLedgers',p_ledgers)) where id='suprabha';
$$;
do $test$
declare v_rows jsonb:='[{"guid":"source-one","name":"Source one"}]';v_before bigint;
begin
 perform private.stockflow_test_link_source('link-source-reuse','2026-10-15T12:00:00Z',v_rows);
 select count(*) into v_before from private.stockflow_economic_import_exceptions where company_id='link-source-reuse';
 perform private.stockflow_test_link_source('link-source-reuse','2026-10-15T12:00:00Z',v_rows||'[{"guid":"injected","name":"Injected customer"}]');
 if exists(select 1 from private.stockflow_economic_ledger_masters where company_id='link-source-reuse' and guid='injected') then
  raise exception 'REGRESSION: accepted ledger version admitted new content';end if;
 if private.stockflow_current_ledger_generation('link-source-reuse') is not null
  or (select count(*) from private.stockflow_economic_import_exceptions where company_id='link-source-reuse')<>v_before+1 then
  raise exception 'Changed version must require source review';end if;

 perform private.stockflow_test_link_source('link-source-time','2026-10-15T12:00:00Z',v_rows);
 perform private.stockflow_test_link_source('link-source-time','2026-10-14T12:00:00Z','[{"guid":"old","name":"Old list"}]');
 if private.stockflow_current_ledger_generation('link-source-time') is distinct from '2026-10-15T12:00:00Z' then
  raise exception 'Older export became the current ledger list';end if;
 -- Different timezone notation is ordered by its actual observation instant.
 perform private.stockflow_test_link_source('link-source-time','2026-10-15T09:00:00-05:00','[{"guid":"new","name":"New list"}]');
 if private.stockflow_current_ledger_generation('link-source-time') is distinct from '2026-10-15T09:00:00-05:00' then
  raise exception 'Observation instant was not used';end if;

 perform private.stockflow_test_link_source('link-source-identical','2026-10-15T12:00:00Z',v_rows);
 perform private.stockflow_test_link_source('link-source-identical','2026-10-16T12:00:00Z',v_rows);
 if private.stockflow_current_ledger_generation('link-source-identical') is distinct from '2026-10-16T12:00:00Z'
  or (select count(*) from private.stockflow_economic_ledger_masters where company_id='link-source-identical')<>1 then
  raise exception 'Identical list must advance evidence version without duplicating master rows';end if;

 perform private.stockflow_test_link_source('link-source-empty','2026-10-15T12:00:00Z',v_rows);
 perform private.stockflow_test_link_source('link-source-empty','2026-10-16T12:00:00Z','[]');
 if private.stockflow_current_ledger_generation('link-source-empty') is distinct from '2026-10-16T12:00:00Z' then
  raise exception 'Empty accepted ledger list fell back to old suggestions';end if;

 perform private.stockflow_test_link_source('link-source-invalid','2026-10-15T12:00:00Z',v_rows);
 perform private.stockflow_test_link_source('link-source-invalid','2026-10-16T12:00:00Z','[{}]');
 if private.stockflow_current_ledger_generation('link-source-invalid') is not null then
  raise exception 'Invalid latest ledger list fell back to old suggestions';end if;
end$test$;
rollback;
