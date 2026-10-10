begin;

-- Show the readable Tally voucher number (for example SD/26-27/0404) beside
-- the canonical source identity, so Accounts can find the document in Tally.
-- Display only: attribution, cost and identity still use the canonical IDs.
do $migration$
declare
  definition text;
  old_fragment constant text := $q$'productName',coalesce(l.evidence->>'label',l.product_id),'quantity',l.quantity::text$q$;
  new_fragment constant text := $q$'productName',coalesce(l.evidence->>'label',l.product_id),'voucherNumber',nullif(btrim(v.evidence->>'sourceReference'),''),'quantity',l.quantity::text$q$;
  occurrences integer;
begin
  select pg_get_functiondef('private.stockflow_economic_workspace(text[])'::regprocedure)
  into definition;

  occurrences := (length(definition) - length(replace(definition, old_fragment, ''))) / length(old_fragment);
  if occurrences <> 1 then
    raise exception 'Expected one source-line product fragment, found %', occurrences;
  end if;

  execute replace(definition, old_fragment, new_fragment);
end
$migration$;

revoke all on function private.stockflow_economic_workspace(text[]) from public,anon,authenticated;

commit;
