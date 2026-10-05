begin;
do $migration$
declare f text; seam text := 'v_key := p_payload->>''idempotencyKey'';';
  locked_seam text := 'if not found then raise exception ''Order was not found'' using errcode=''22023''; end if;';
begin
  select pg_get_functiondef('public.stockflow_billing_review_gateway(text,text,text,jsonb)'::regprocedure) into f;
  if position('assigned_roles text[]' in f)=0 or
    (select count(*) from regexp_matches(f,'v_key := p_payload->>''idempotencyKey'';','g'))<>1 or
    position('private.assert_stockflow_order_access' in f)>0 or position(locked_seam in f)=0 then
    raise exception 'Billing review scope seam changed';
  end if;
  f := replace(f,seam,
    'perform private.assert_stockflow_order_access(v_email,assigned_roles,(p_payload->>''orderId'')::uuid); '||seam);
  -- Recheck after acquiring the existing order lock, in case archival raced the initial check.
  f := replace(f,locked_seam,locked_seam||' perform private.assert_stockflow_order_access(v_email,assigned_roles,v_order.id);');
  execute f;
end $migration$;
revoke all on function public.stockflow_billing_review_gateway(text,text,text,jsonb) from public,anon,authenticated;
commit;
