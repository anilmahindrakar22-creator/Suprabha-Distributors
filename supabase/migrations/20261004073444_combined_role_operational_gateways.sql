begin;
do $migration$
declare f text; name text; updated text; count_guard integer;
begin
  foreach name in array array[
    'stockflow_priority_gateway','stockflow_assignment_gateway','stockflow_follow_up_gateway',
    'stockflow_order_note_gateway','stockflow_edit_gateway','stockflow_fulfilment_gateway',
    'stockflow_delivery_gateway','stockflow_order_activity_gateway'
  ] loop
    select pg_get_functiondef(to_regprocedure('public.'||name||'(text,text,text,jsonb)')) into f;
    if (length(f)-length(replace(f,'v_role text;','')))/length('v_role text;')<>1
      or position('select role into v_role from public.stockflow_members' in f)=0 then
      raise exception 'Expected operational membership seam missing: %',name;
    end if;
    f:=replace(f,'v_role text;','v_role text; v_roles text[];');
    f:=replace(f,'select role into v_role from public.stockflow_members','select role, roles into v_role, v_roles from public.stockflow_members');
    if name='stockflow_order_activity_gateway' then
      if position('if v_role is null then' in f)=0 then raise exception 'Activity membership guard missing'; end if;
      f:=replace(f,'if v_role is null then','if v_role is null or not private.stockflow_valid_roles(v_roles) then');
    else
      if (select count(*) from regexp_matches(f,'if v_role not in \(([^)]+)\) then','g'))<>1 then
        raise exception 'Expected exactly one action guard: %',name;
      end if;
      f:=regexp_replace(f,'if v_role not in \(([^)]+)\) then',
        'if not private.stockflow_valid_roles(v_roles) or not (v_roles && array[\1]::text[]) then');
      count_guard:=(select count(*) from regexp_matches(f,'v_email,\s*v_role,\s*jsonb_build_object\(','g'));
      if count_guard<>(case when name='stockflow_delivery_gateway' then 2 else 1 end) then
        raise exception 'Expected audit role-set seam missing: %',name;
      end if;
      f:=regexp_replace(f,'v_email,\s*v_role,\s*jsonb_build_object\(',
        'v_email,v_role,jsonb_build_object(''assignedRoles'',v_roles,','g');
    end if;
    updated:=regexp_replace(f,'private\.assert_stockflow_order_access\(v_email,\s*v_role,',
      'private.assert_stockflow_order_access(v_email,v_roles,','g');
    if updated=f then raise exception 'Expected operational order scope missing: %',name; end if;
    execute updated;
    execute format('revoke all on function public.%I(text,text,text,jsonb) from public,anon,authenticated',name);
  end loop;
end $migration$;
commit;
