begin;
do $migration$
declare f text; name text; role_var text; updated text;
begin
  foreach name in array array['stockflow_submission_recovery_gateway',
    'stockflow_submission_recovery_gateway_before_group_margin',
    'stockflow_submission_recovery_gateway_before_customer_bulk','stockflow_billing_review_gateway'] loop
    role_var:=case when name in ('stockflow_submission_recovery_gateway','stockflow_submission_recovery_gateway_before_group_margin')
      then 'actor_role' else 'v_role' end;
    select pg_get_functiondef(to_regprocedure('public.'||name||'(text,text,text,jsonb)')) into f;
    if (select count(*) from regexp_matches(f,'\m'||role_var||' text;','g'))<>1
      or position('select role into '||role_var in f)=0 then raise exception 'Recovery membership seam missing: %',name; end if;
    f:=regexp_replace(f,'\m'||role_var||' text;',role_var||' text; assigned_roles text[];');
    f:=replace(f,'select role into '||role_var,'select role, roles into '||role_var||', assigned_roles');
    f:=replace(f,'private.stockflow_assert_pricing_role('||role_var||')','private.stockflow_assert_pricing_role(assigned_roles)');
    f:=replace(f,role_var||' is null','not private.stockflow_valid_roles(assigned_roles)');
    f:=regexp_replace(f,'\m'||role_var||' not in \(([^)]+)\)',
      '(not private.stockflow_valid_roles(assigned_roles) or not (assigned_roles && array[\1]::text[]))','g');
    f:=regexp_replace(f,'private\.assert_stockflow_order_access\(v_email,\s*'||role_var||',',
      'private.assert_stockflow_order_access(v_email,assigned_roles,','g');
    f:=regexp_replace(f,'\m'||role_var||',\s*(request_key|v_key),\s*jsonb_build_object\(',
      role_var||',\1,jsonb_build_object(''assignedRoles'',assigned_roles,','g');
    f:=regexp_replace(f,'v_email,\s*'||role_var||',\s*jsonb_build_object\(',
      'v_email,'||role_var||',jsonb_build_object(''assignedRoles'',assigned_roles,','g');
    execute f;
    execute format('revoke all on function public.%I(text,text,text,jsonb) from public,anon,authenticated',name);
    if name like '%_before_%' then
      execute format('revoke all on function public.%I(text,text,text,jsonb) from service_role',name);
    end if;
  end loop;
end $migration$;
commit;
