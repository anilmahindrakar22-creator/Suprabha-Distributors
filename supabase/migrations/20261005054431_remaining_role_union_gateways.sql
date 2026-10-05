begin;
do $migration$
declare f text; name text;
begin
 foreach name in array array['stockflow_exception_gateway','stockflow_installation_gateway','stockflow_service_gateway',
   'stockflow_customer_gateway','stockflow_product_request_gateway','stockflow_inventory_gateway','stockflow_allocation_gateway'] loop
  select pg_get_functiondef(to_regprocedure('public.'||name||'(text,text,text,jsonb)')) into f;
  -- Historical deployment order retains the lean active-member customer directory.
  if name='stockflow_customer_gateway' and position('v_role text;' in f)=0 then
    if position('where email = v_email and status = ''active''' in f)=0 then raise exception 'Customer active-member seam changed'; end if;
    execute replace(f,'where email = v_email and status = ''active''',
      'where email = v_email and status = ''active'' and private.stockflow_valid_roles(roles)');
    continue;
  end if;
  if position('v_role text;' in f)=0 or not (f ~ 'select role into v_role from public.stockflow_members') then
    raise exception 'Remaining membership seam changed: %',name; end if;
  f:=replace(f,'v_role text;','v_role text; v_roles text[];');
  f:=replace(f,'select role into v_role from public.stockflow_members','select role, roles into v_role, v_roles from public.stockflow_members');
  f:=replace(f,'v_role is null','not private.stockflow_valid_roles(v_roles)');
  f:=regexp_replace(f,'v_role not in \(([^)]+)\)',
    '(not private.stockflow_valid_roles(v_roles) or not (v_roles && array[\1]::text[]))','g');
  f:=regexp_replace(f,'v_role in \(([^)]+)\)','(private.stockflow_valid_roles(v_roles) and v_roles && array[\1]::text[])','g');
  f:=regexp_replace(f,'private\.assert_stockflow_order_access\(v_email,\s*v_role,','private.assert_stockflow_order_access(v_email,v_roles,','g');
  f:=replace(f,'private.assert_stockflow_permission(v_role,','private.assert_stockflow_permission(v_roles,');
  f:=regexp_replace(f,'v_email,\s*v_role,\s*jsonb_build_object\(','v_email,v_role,jsonb_build_object(''assignedRoles'',v_roles,','g');
  execute f;
  execute format('revoke all on function public.%I(text,text,text,jsonb) from public,anon,authenticated',name);
 end loop;
 -- Governed wrapper delegates authorization to the already integrated v3 gateway.
 revoke all on function public.stockflow_pricing_gateway_before_order_preview(text,text,text,jsonb) from public,anon,authenticated,service_role;
 foreach name in array array['stockflow_order_gateway_before_auto_pricing','stockflow_order_list_gateway'] loop
  select pg_get_functiondef(to_regprocedure('public.'||name||'(text,text,text,jsonb)')) into f;
  if name='stockflow_order_list_gateway' then
    if position('''actor'',jsonb_build_object(''email'',v_email,''role'',v_role)' in f)=0 then raise exception 'List actor seam changed'; end if;
    f:=replace(f,'''actor'',jsonb_build_object(''email'',v_email,''role'',v_role)',
      '''actor'',jsonb_build_object(''email'',v_email,''role'',v_role,''roles'',v_roles)');
  else
    if position('''actor'', jsonb_build_object(''email'', v_actor_email, ''role'', v_role)' in f)=0 then raise exception 'Bootstrap actor seam changed'; end if;
    f:=replace(f,'''actor'', jsonb_build_object(''email'', v_actor_email, ''role'', v_role)',
      '''actor'', jsonb_build_object(''email'', v_actor_email, ''role'', v_role, ''roles'', v_roles)');
  end if;
  execute f;
 end loop;
 -- Assignability depends on all active roles, not the legacy primary role.
 select pg_get_functiondef('public.stockflow_assignment_gateway(text,text,text,jsonb)'::regprocedure) into f;
 if position('and role <> ''viewer''' in f)=0 then raise exception 'Assignee seam changed'; end if;
 execute replace(f,'and role <> ''viewer''','and private.stockflow_valid_roles(roles) and roles <> array[''viewer'']::text[]');
end $migration$;
commit;
