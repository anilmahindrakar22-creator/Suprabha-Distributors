-- Access-scoped current state, rather than queue counts or event sequence watermarks.
create or replace function private.stockflow_order_revision(p_actor_email text, p_roles text[])
returns text language sql stable
set search_path = pg_catalog, private
as $$
  select md5(coalesce(string_agg(o.id::text || ':' || o.version::text || ':' || o.status, ',' order by o.id), ''))
  from private.stockflow_orders o
  where private.stockflow_can_access_order(p_actor_email,p_roles,o.id)
$$;
revoke all on function private.stockflow_order_revision(text,text[]) from public,anon,authenticated;

do $migration$
declare f text; fragment text := '''operationsDate'', to_char(v_business_date,''YYYY-MM-DD'')';
begin
  select pg_get_functiondef('public.stockflow_order_summary_gateway(text,text,text,jsonb)'::regprocedure) into f;
  if (length(f)-length(replace(f,fragment,'')))/length(fragment) <> 1
    or position('private.stockflow_operations_summary(v_email,v_roles)' in f)=0 then
    raise exception 'Expected combined-role summary boundary not found';
  end if;
  f := replace(f,fragment,fragment || ', ''orderRevision'', private.stockflow_order_revision(v_email,v_roles)');
  execute f;
end $migration$;
revoke all on function public.stockflow_order_summary_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_order_summary_gateway(text,text,text,jsonb) to service_role;
