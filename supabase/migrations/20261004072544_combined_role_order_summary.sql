begin;
create function private.stockflow_can_access_order(p_actor_email text,p_roles text[],p_order_id uuid)
returns boolean language sql stable
set search_path=pg_catalog,private
as $$
  select exists(select 1 from private.stockflow_orders o where o.id=p_order_id and o.archived_at is null
    and private.stockflow_role_can_read_order(p_actor_email,p_roles,o.created_by_email))
$$;
revoke all on function private.stockflow_can_access_order(text,text[],uuid) from public,anon,authenticated;

-- Clone the current consolidated count query into an array overload, changing
-- only its role-scope predicate. Keep its materialization and business clock.
do $migration$
declare f text; name text; pair text[];
begin
  select pg_get_functiondef('private.stockflow_operations_summary(text,text)'::regprocedure) into f;
  if position('p_role text)' in f)=0 or position('where role=p_role' in f)=0 then
    raise exception 'Expected consolidated summary signature/scope missing';
  end if;
  f:=replace(f,'p_role text)','p_roles text[])');
  f:=replace(f,'where role=p_role','where private.stockflow_valid_roles(p_roles) and role=any(p_roles)');
  execute f;

  select pg_get_functiondef('public.stockflow_order_summary_gateway(text,text,text,jsonb)'::regprocedure) into f;
  foreach pair slice 1 in array array[
    array['  v_role text;','  v_role text; v_roles text[];'],
    array['select role into v_role from public.stockflow_members','select role, roles into v_role, v_roles from public.stockflow_members'],
    array['if v_role is null then','if v_role is null or not private.stockflow_valid_roles(v_roles) then'],
    array['private.stockflow_operations_summary(v_email,v_role)','private.stockflow_operations_summary(v_email,v_roles)']
  ] loop
    if (length(f)-length(replace(f,pair[1],'')))/length(pair[1])<>1 then
      raise exception 'Expected summary fragment missing: %',pair[1];
    end if;
    f:=replace(f,pair[1],pair[2]);
  end loop;
  execute f;

  foreach name in array array['stockflow_order_list_gateway','stockflow_order_gateway_before_auto_pricing'] loop
    select pg_get_functiondef(to_regprocedure('public.'||name||'(text,text,text,jsonb)')) into f;
    if name='stockflow_order_list_gateway' then
      if position('private.stockflow_operations_summary(v_email,v_role)' in f)=0 then raise exception 'Expected list summary missing'; end if;
      f:=replace(f,'private.stockflow_operations_summary(v_email,v_role)','private.stockflow_operations_summary(v_email,v_roles)');
    else
      if position('private.stockflow_operations_summary(v_actor_email,v_role)' in f)=0
        or position('private.stockflow_can_access_order(v_actor_email,v_role,x.id)' in f)=0
        or position('coalesce(v_snapshot->''tallyInvoices'', ''[]''::jsonb)' in f)=0 then
        raise exception 'Expected bootstrap summary/scope/invoices missing';
      end if;
      f:=replace(f,'private.stockflow_operations_summary(v_actor_email,v_role)','private.stockflow_operations_summary(v_actor_email,v_roles)');
      f:=replace(f,'private.stockflow_can_access_order(v_actor_email,v_role,x.id)','private.stockflow_can_access_order(v_actor_email,v_roles,x.id)');
      f:=replace(f,'coalesce(v_snapshot->''tallyInvoices'', ''[]''::jsonb)',
        '(select coalesce(jsonb_agg(private.stockflow_operational_invoice(invoice)),''[]''::jsonb) from jsonb_array_elements(coalesce(v_snapshot->''tallyInvoices'',''[]''::jsonb)) invoice)');
    end if;
    execute f;
  end loop;
end $migration$;
revoke all on function private.stockflow_operations_summary(text,text[]) from public,anon,authenticated;
revoke all on function public.stockflow_order_gateway_before_auto_pricing(text,text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.stockflow_order_summary_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_order_summary_gateway(text,text,text,jsonb) to service_role;
commit;
