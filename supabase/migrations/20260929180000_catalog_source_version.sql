-- A stock-only refresh must not invalidate the account-scoped catalog cache.
-- Legacy connector snapshots still use the overall fetchedAt value.
do $$
declare
  gateway regprocedure;
  definition text;
  updated text;
  replacement text := $expr$'catalogVersion',coalesce(nullif(v_snapshot->>'catalogVersion',''),v_snapshot->>'fetchedAt','')$expr$;
begin
  foreach gateway in array array[
    'public.stockflow_catalog_gateway(text,text,text,jsonb)'::regprocedure,
    'public.stockflow_order_gateway_before_auto_pricing(text,text,text,jsonb)'::regprocedure,
    'public.stockflow_order_list_gateway(text,text,text,jsonb)'::regprocedure
  ] loop
    select pg_get_functiondef(gateway) into definition;
    updated := replace(definition,
      $old$'catalogVersion', coalesce(v_snapshot->>'fetchedAt', '')$old$,
      replacement);
    updated := replace(updated,
      $old$'catalogVersion',coalesce(v_snapshot->>'fetchedAt','')$old$,
      replacement);
    if updated = definition then
      raise exception 'Expected catalog version projection not found in %', gateway;
    end if;
    execute updated;
  end loop;
end $$;

revoke all on function public.stockflow_catalog_gateway(text,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.stockflow_catalog_gateway(text,text,text,jsonb)
  to service_role;
revoke all on function public.stockflow_order_gateway_before_auto_pricing(text,text,text,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.stockflow_order_list_gateway(text,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.stockflow_order_list_gateway(text,text,text,jsonb)
  to service_role;
