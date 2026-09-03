do $$
declare
  f text;
  updated text;
begin
  select pg_get_functiondef('public.stockflow_order_gateway(text,text,text,jsonb)'::regprocedure) into f;
  updated := replace(
    f,
    $old$        'catalog', coalesce(v_snapshot->'catalog', '[]'::jsonb)$old$,
    $new$        'catalog', coalesce(v_snapshot->'catalog', '[]'::jsonb),
        'tallyInvoices', coalesce(v_snapshot->'tallyInvoices', '[]'::jsonb)$new$
  );
  if updated = f then raise exception 'Expected snapshot catalog projection was not found'; end if;
  execute updated;
end;
$$;

revoke all on function public.stockflow_order_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_order_gateway(text,text,text,jsonb) to service_role;
