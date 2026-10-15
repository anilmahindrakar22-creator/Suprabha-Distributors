begin;
do $$
declare workspace jsonb; problem jsonb;
begin
 insert into private.stockflow_economic_import_exceptions(company_id,source_id,reason,evidence)
 values('import-problem-details-company','import-problem-details-voucher',
  'Incomplete voucher identity, lines or net economic values',
  '{"sourceReference":"6466","voucherType":"Sales","date":"2026-10-10","error":"Canonical customer GUID unavailable in the master export.","kind":"sale"}'),
  ('import-problem-details-company','import-problem-details-missing','Missing evidence','{}');
 workspace:=private.stockflow_economic_workspace(array['accounts']);
 select value into problem from jsonb_array_elements(workspace->'exceptions')
 where value->>'sourceId'='import-problem-details-voucher';
 if problem is null or not (problem @> '{"voucherNumber":"6466","voucherType":"Sales","voucherDate":"2026-10-10","detail":"Canonical customer GUID unavailable in the master export.","kind":"sale"}') then
  raise exception 'Missing connector invoice details: %',problem;
 end if;
 select value into problem from jsonb_array_elements(workspace->'exceptions')
 where value->>'sourceId'='import-problem-details-missing';
 if problem is null or not (problem @> '{"voucherNumber":null,"voucherType":null,"voucherDate":null,"detail":null,"kind":null}') then
  raise exception 'Absent connector evidence must produce five null keys: %',problem;
 end if;
 if problem->>'reason'<>'Missing evidence' or problem->>'status'<>'import_rejected' then
  raise exception 'Existing exception fields changed';
 end if;
end$$;
rollback;
