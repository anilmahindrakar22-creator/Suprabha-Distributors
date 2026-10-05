begin;
insert into public.stockflow_members(email,role,status)
values('role-storage@test.local','sales','active');
do $$
begin
  if (select roles from public.stockflow_members where email='role-storage@test.local') <> array['sales'] then
    raise exception 'Legacy insert did not populate roles';
  end if;
  update public.stockflow_members set role='warehouse' where email='role-storage@test.local';
  if (select roles from public.stockflow_members where email='role-storage@test.local') <> array['warehouse'] then
    raise exception 'Legacy update did not synchronize roles';
  end if;
  begin
    update public.stockflow_members set roles=array['warehouse','invented'] where email='role-storage@test.local';
    raise exception 'Invalid combined permissions accepted';
  exception when check_violation then null;
  end;
  if has_table_privilege('authenticated','public.stockflow_members','UPDATE')
    or has_table_privilege('anon','public.stockflow_members','UPDATE') then
    raise exception 'Client can mutate role assignments';
  end if;
  insert into private.stockflow_member_events(member_email,action,previous_role,new_role,previous_status,new_status,actor_email)
  values('role-storage@test.local','updated','sales','warehouse','active','active','administrator@test.local');
  if not exists(select 1 from private.stockflow_member_events where member_email='role-storage@test.local'
    and previous_roles=array['sales'] and new_roles=array['warehouse'] and actor_email='administrator@test.local') then
    raise exception 'Role-set audit missing';
  end if;
  begin
    update private.stockflow_member_events set new_roles=array['administrator'] where member_email='role-storage@test.local';
    raise exception 'Immutable audit changed';
  exception when others then
    if sqlerrm='Immutable audit changed' then raise; end if;
  end;
end $$;
rollback;
