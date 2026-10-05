begin;
create function private.stockflow_assert_pricing_role(p_roles text[]) returns void
language plpgsql set search_path=pg_catalog,private as $$
begin
  if not private.stockflow_valid_roles(p_roles)
    or not (p_roles && array['administrator','management','accounts']::text[]) then
    raise exception 'Pricing access is restricted' using errcode='42501';
  end if;
end $$;
revoke all on function private.stockflow_assert_pricing_role(text[]) from public,anon,authenticated;

do $migration$
declare f text; identifier text; role_var text; updated text;
begin
  foreach identifier in array array[
    'public.stockflow_pricing_gateway',
    'public.stockflow_pricing_gateway_before_group_margin',
    'public.stockflow_pricing_gateway_before_customer_bulk',
    'public.stockflow_pricing_gateway_v3',
    'public.stockflow_pricing_gateway_v2',
    'private.stockflow_pricing_gateway_v1'
  ] loop
    select pg_get_functiondef(to_regprocedure(identifier||'(text,text,text,jsonb)')) into f;
    role_var:=case when identifier like '%_v1' then 'v_role'
      when identifier like '%_v2' or identifier like '%_v3' then 'role' else 'actor_role' end;
    if (select count(*) from regexp_matches(f,'\m'||role_var||' text;','g'))<>1 then
      raise exception 'Expected pricing role declaration missing: %',identifier;
    end if;
    f:=regexp_replace(f,'\m'||role_var||' text;',role_var||' text; assigned_roles text[];');
    updated:=regexp_replace(f,'select (m\.)?role into '||role_var||'\M',
      'select \1role, \1roles into '||role_var||', assigned_roles');
    if updated=f then raise exception 'Expected pricing membership load missing: %',identifier; end if;
    f:=updated;
    -- All read checks operate on the validated stored union, not the primary
    -- audit role. Existing approval subsets remain separate from read access.
    f:=replace(f,'private.stockflow_assert_pricing_role('||role_var||')',
      'private.stockflow_assert_pricing_role(assigned_roles)');
    f:=regexp_replace(f,'\m'||role_var||' not in \(([^)]+)\)',
      '(not private.stockflow_valid_roles(assigned_roles) or not (assigned_roles && array[\1]::text[]))','g');
    f:=replace(f,role_var||' is null','not private.stockflow_valid_roles(assigned_roles)');
    f:=regexp_replace(f,'private\.assert_stockflow_order_access\(v_email,\s*'||role_var||',',
      'private.assert_stockflow_order_access(v_email,assigned_roles,','g');
    -- Keep the legacy actor role and add the actual role set to existing audit.
    f:=regexp_replace(f,'\m'||role_var||',\s*(v_key|p_payload->>''idempotencyKey''),\s*jsonb_build_object\(',
      role_var||',\1,jsonb_build_object(''assignedRoles'',assigned_roles,','g');
    f:=regexp_replace(f,'v_email,\s*'||role_var||',\s*jsonb_build_object\(',
      'v_email,'||role_var||',jsonb_build_object(''assignedRoles'',assigned_roles,','g');
    execute f;
    execute 'revoke all on function '||identifier||'(text,text,text,jsonb) from public,anon,authenticated';
    if identifier<>'public.stockflow_pricing_gateway' then
      execute 'revoke all on function '||identifier||'(text,text,text,jsonb) from service_role';
    end if;
  end loop;
end $migration$;
commit;
