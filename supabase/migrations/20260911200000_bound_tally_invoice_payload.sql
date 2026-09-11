create or replace function private.stockflow_invoice_matches_order_reference(
  p_invoice jsonb,
  p_order jsonb
) returns boolean
language plpgsql
stable
set search_path = pg_catalog
as $$
declare
  reference text;
  voucher text := btrim(coalesce(p_invoice->>'voucherNumber',''));
  numeric_reference text;
  voucher_parts text[];
  business_date date := (now() at time zone 'Asia/Kolkata')::date;
  financial_year text;
begin
  financial_year := case
    when extract(month from business_date) >= 4
      then to_char(business_date,'YY') || '-' || to_char(business_date + interval '1 year','YY')
    else to_char(business_date - interval '1 year','YY') || '-' || to_char(business_date,'YY')
  end;

  foreach reference in array string_to_array(coalesce(p_order->>'tallyInvoiceNumber',''),',') loop
    reference := btrim(reference);
    if reference = '' then continue; end if;

    if reference !~ '^[0-9]+$' then
      if lower(voucher) = lower(reference) then return true; end if;
      continue;
    end if;

    numeric_reference := coalesce(nullif(ltrim(reference,'0'),''),'0');
    voucher_parts := regexp_match(upper(voucher),'^SD/([0-9]{2}-[0-9]{2})/0*([0-9]+)$');
    if voucher_parts is not null
      and voucher_parts[1] = financial_year
      and coalesce(nullif(ltrim(voucher_parts[2],'0'),''),'0') = numeric_reference then
      return true;
    end if;
  end loop;

  return false;
end;
$$;

comment on function private.stockflow_invoice_matches_order_reference(jsonb,jsonb) is
  'Bounds order-list invoice payloads to exact references, including current-financial-year SD voucher expansion for numeric entries.';

revoke all on function private.stockflow_invoice_matches_order_reference(jsonb,jsonb) from public, anon, authenticated;

do $migration$
declare
  f text;
  updated text;
begin
  select pg_get_functiondef('public.stockflow_order_list_gateway(text,text,text,jsonb)'::regprocedure) into f;

  updated := replace(f,
    $$and lower(regexp_replace(btrim(invoice->>'party'),'\s+',' ','g'))=lower(regexp_replace(btrim(listed->>'customerName'),'\s+',' ','g'))$$,
    $$and lower(regexp_replace(btrim(invoice->>'party'),'\s+',' ','g'))=lower(regexp_replace(btrim(listed->>'customerName'),'\s+',' ','g'))
            and private.stockflow_invoice_matches_order_reference(invoice,listed)$$
  );
  if updated = f then raise exception 'Expected order-list invoice party match was not found'; end if;

  execute updated;
end $migration$;

revoke all on function public.stockflow_order_list_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_order_list_gateway(text,text,text,jsonb) to service_role;
