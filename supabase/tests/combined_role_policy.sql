begin;
insert into public.stockflow_members(email,role,status) values
 ('combined-active@test.local','sales','active'),
 ('combined-suspended@test.local','accounts','suspended'),
 ('combined-invited@test.local','warehouse','invited');
do $$
declare roles text[]; r text; p record;
begin
  foreach roles slice 1 in array array[
    array['sales','warehouse'],array['sales','accounts'],array['administrator','viewer']
  ] loop
    if not private.stockflow_valid_roles(roles) then raise exception 'Valid set rejected'; end if;
  end loop;
  if private.stockflow_valid_roles(null) or private.stockflow_valid_roles('{}'::text[])
    or private.stockflow_valid_roles(array['sales','sales'])
    or private.stockflow_valid_roles(array['sales',null])
    or private.stockflow_valid_roles(array['sales','owner'])
    or private.stockflow_valid_roles(array[['sales']]) then
    raise exception 'Malformed role set accepted';
  end if;
  if private.stockflow_active_member_roles(' COMBINED-ACTIVE@TEST.LOCAL ')<>array['sales'] then
    raise exception 'Active member lookup failed';
  end if;
  foreach r in array array['combined-suspended@test.local','combined-invited@test.local','missing@test.local'] loop
    begin
      perform private.stockflow_active_member_roles(r);
      raise exception 'Inactive membership accepted';
    exception when insufficient_privilege then null; end;
  end loop;
  perform private.assert_stockflow_permission(array['sales','warehouse'],'orders.create');
  begin
    perform private.assert_stockflow_permission(array['viewer','warehouse'],'orders.create');
    raise exception 'Warehouse/viewer gained creation';
  exception when insufficient_privilege then null; end;
  begin
    perform private.assert_stockflow_permission(array['administrator','unknown'],'orders.create');
    raise exception 'Invalid set gained privilege';
  exception when insufficient_privilege then null; end;
  perform private.assert_stockflow_order_transition(array['sales','warehouse'],'awaiting_confirmation','confirmed');
  perform private.assert_stockflow_order_transition(array['sales','warehouse'],'confirmed','packed');
  begin
    perform private.assert_stockflow_order_transition(array['sales','warehouse'],'confirmed','cancelled','test');
    raise exception 'Combined operational roles gained administrator cancellation';
  exception when insufficient_privilege then null; end;
  begin
    perform private.assert_stockflow_order_transition(array['sales','accounts'],'awaiting_tally_billing','billed_in_tally');
    raise exception 'Invoice invariant bypassed';
  exception when invalid_parameter_value then null; end;
  begin
    perform private.assert_stockflow_order_transition(array['administrator','sales'],'confirmed','cancelled');
    raise exception 'Reason invariant bypassed';
  exception when invalid_parameter_value then null; end;
  -- Singleton overloads must agree for every current role/scope combination.
  foreach r in array array['administrator','sales','operations','warehouse','accounts','management','viewer'] loop
    if private.stockflow_role_can_read_order('actor@test.local',r,'other@test.local') is distinct from
      private.stockflow_role_can_read_order('actor@test.local',array[r],'other@test.local') then
      raise exception 'Singleton scope changed for %',r;
    end if;
  end loop;
  if private.stockflow_role_can_read_order('actor@test.local',array['sales','unknown'],'actor@test.local') then
    raise exception 'Invalid set read order';
  end if;
  if private.stockflow_role_can_read_order('actor@test.local',array['sales','warehouse'],'other@test.local') is distinct from
    (private.stockflow_role_can_read_order('actor@test.local','sales','other@test.local') or
     private.stockflow_role_can_read_order('actor@test.local','warehouse','other@test.local')) then
    raise exception 'Scope union failed';
  end if;
  for p in select oid from pg_proc where pronamespace='private'::regnamespace and proname in
    ('stockflow_valid_roles','stockflow_active_member_roles','assert_stockflow_permission','assert_stockflow_order_transition','stockflow_role_can_read_order') loop
    if has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE') then
      raise exception 'Policy helper publicly executable';
    end if;
  end loop;
end $$;
rollback;
