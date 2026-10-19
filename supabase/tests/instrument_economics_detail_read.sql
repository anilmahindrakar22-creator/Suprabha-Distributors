-- Run against a migrated non-production database. Read-only checks; rolls back.
begin;
do $test$
declare
  full_read jsonb := private.stockflow_economic_workspace_read(array['management'], false);
  detail jsonb := private.stockflow_economic_workspace_detail(array['management']);
  missing int;
  extra int;
begin
  if detail->>'readView' <> 'detail' then raise exception 'Detail read must say readView=detail'; end if;
  -- Everything except the limited source lines is identical to the full read.
  if (detail - array['readView','sourceLines']) <> (full_read - array['readView','sourceLines']) then
    raise exception 'Detail read differs from the full read outside sourceLines';
  end if;
  -- Every non-sale line and every sale of a customer with a target is kept; nothing else is added.
  select count(*) into missing from jsonb_array_elements(full_read->'sourceLines') f
  where (f->>'kind' <> 'sale' or exists(select 1 from private.stockflow_economic_targets t where t.company_id::text=f->>'companyId' and t.customer_source_id=f->>'customerSourceId'))
    and not exists(select 1 from jsonb_array_elements(detail->'sourceLines') d where d->>'id'=f->>'id');
  if missing > 0 then raise exception 'Detail read dropped % needed source lines', missing; end if;
  select count(*) into extra from jsonb_array_elements(detail->'sourceLines') d
  where d->>'kind'='sale' and not exists(select 1 from private.stockflow_economic_targets t where t.company_id::text=d->>'companyId' and t.customer_source_id=d->>'customerSourceId');
  if extra > 0 then raise exception 'Detail read kept % sales of customers without a target', extra; end if;
  -- Every line an attribution row points to is present, so breakdown voucher numbers resolve.
  select count(*) into missing from jsonb_array_elements(detail->'attributionLines') a
  where not exists(select 1 from jsonb_array_elements(detail->'sourceLines') d where d->>'id'=a->>'sourceLineId');
  if missing > 0 then raise exception 'Detail read lost % attributed source lines', missing; end if;
  if has_function_privilege('authenticated','private.stockflow_economic_workspace_detail(text[])','execute') then
    raise exception 'Detail read must not be callable by clients';
  end if;
end $test$;
rollback;
