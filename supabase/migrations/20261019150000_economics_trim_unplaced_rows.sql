-- The full Economics read sent every unplaced sale twice: 5,490 of 5,534 attribution rows
-- (19 Oct 2026) were "no_verified_compatible_placement" sales to the 165 customers without
-- a registered instrument, repeated line by line in exceptions. About 5 MB of a 9 MB response.
--
-- attributionLines keep every row the screens read: rows with a target (lifetime, breakdown,
-- cost verification, todo), unplaced rows for customers that have a target (suggested items),
-- and any other untargeted reason. exceptions keep every other row and every import
-- rejection; the unplaced sales become one row per customer with line count and total,
-- so customers buying reagents without a registered instrument stay visible.
-- reportingSummary, todoCount and all target figures are computed separately and unchanged.

do $$
declare
  f text;
  attribution_old constant text := $a$where r.run_id=run),'[]'::jsonb) end,
  'sourceLines',$a$;
  attribution_new constant text := $a$where r.run_id=run and (r.target_id is not null or r.reason is distinct from 'no_verified_compatible_placement' or exists(select 1 from private.stockflow_economic_targets kept where kept.company_id=v.company_id and kept.customer_source_id=v.customer_source_id))),'[]'::jsonb) end,
  'sourceLines',$a$;
  exceptions_old constant text := $a$where r.run_id=run and r.status not in ('verified','instrument_billing') group by v.source_id,l.id,v.business_date,r.status,r.reason
    union all select$a$;
  exceptions_new constant text := $a$where r.run_id=run and r.status not in ('verified','instrument_billing') and r.reason is distinct from 'no_verified_compatible_placement' group by v.source_id,l.id,v.business_date,r.status,r.reason
    union all select jsonb_build_object('sourceId','Customer '||v.customer_source_id,'productId',count(*)::text||' sales lines','date',max(v.business_date),'netSalesPaise',sum(r.revenue_paise)::text,'status','unattributed','reason','no_verified_compatible_placement','lineCount',count(*))
    from private.stockflow_economic_results r join private.stockflow_economic_source_lines l on l.id=r.source_line_id join private.stockflow_economic_source_vouchers v on v.id=l.voucher_id where r.run_id=run and r.status not in ('verified','instrument_billing') and r.reason='no_verified_compatible_placement' group by v.company_id,v.customer_source_id
    union all select$a$;
begin
  select pg_get_functiondef('private.stockflow_economic_workspace_read(text[],boolean)'::regprocedure) into f;
  if (length(f) - length(replace(f, attribution_old, ''))) / length(attribution_old) <> 1 then
    raise exception 'Expected one attribution-lines read in the economics workspace';
  end if;
  if (length(f) - length(replace(f, exceptions_old, ''))) / length(exceptions_old) <> 1 then
    raise exception 'Expected one result-exceptions read in the economics workspace';
  end if;
  f := replace(f, attribution_old, attribution_new);
  f := replace(f, exceptions_old, exceptions_new);
  execute f;
end $$;
