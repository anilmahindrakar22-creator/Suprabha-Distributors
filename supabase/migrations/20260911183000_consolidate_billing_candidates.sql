do $migration$
declare f text; updated text;
begin
  select pg_get_functiondef('private.stockflow_order_matches_filter(private.stockflow_orders,text,text,date)'::regprocedure) into f;
  updated := replace(f,
    $old$    when 'delivery_due_today' then$old$,
    $new$    when 'billing_candidates' then p_order.status in ('billed_in_tally','ready_for_dispatch','dispatched','delivered','cancelled')
    when 'delivery_due_today' then$new$);
  if updated=f then raise exception 'Expected delivery queue filter was not found'; end if;
  execute updated;

  select pg_get_functiondef('public.stockflow_order_list_gateway(text,text,text,jsonb)'::regprocedure) into f;
  updated := replace(f,
    $old$'all','open','history','billing','picking','dispatch_ready','delivery_attention'$old$,
    $new$'all','open','history','billing','picking','dispatch_ready','billing_candidates','delivery_attention'$new$);
  if updated=f then raise exception 'Expected order status allowlist was not found'; end if;
  execute updated;
end $migration$;

revoke all on function private.stockflow_order_matches_filter(private.stockflow_orders,text,text,date) from public, anon, authenticated;
revoke all on function public.stockflow_order_list_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_order_list_gateway(text,text,text,jsonb) to service_role;
