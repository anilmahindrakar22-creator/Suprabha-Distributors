do $migration$
declare f text; updated text;
begin
  select pg_get_functiondef('private.stockflow_order_matches_filter(private.stockflow_orders,text,text,date)'::regprocedure) into f;
  updated := replace(f,
    $old$assignee text := case when q like 'assignee:%' then nullif(btrim(substr(q,10)),'') else null end;$old$,
    $new$assignee_filter boolean := q like 'assignee:%';
  assignee text := case when q like 'assignee:%' then nullif(btrim(substr(q,10)),'') else null end;$new$);
  if updated=f then raise exception 'Expected assignee filter declaration was not found'; end if;
  f := updated;
  updated := replace(f,
    $old$and (assignee is null or p_order.assigned_to_email=assignee)
    and (q = '' or assignee is not null or strpos(lower(concat_ws(' ',p_order.order_number,p_order.customer_name,p_order.customer_phone,p_order.tally_invoice_number,p_order.assigned_to_email)),q) > 0$old$,
    $new$and (not assignee_filter or (assignee='unassigned' and p_order.assigned_to_email is null) or p_order.assigned_to_email=assignee)
    and (q = '' or assignee_filter or strpos(lower(concat_ws(' ',p_order.order_number,p_order.customer_name,p_order.customer_phone,p_order.tally_invoice_number,p_order.assigned_to_email)),q) > 0$new$);
  if updated=f then raise exception 'Expected assignee filter predicate was not found'; end if;
  execute updated;
end $migration$;

revoke all on function private.stockflow_order_matches_filter(private.stockflow_orders,text,text,date) from public, anon, authenticated;
