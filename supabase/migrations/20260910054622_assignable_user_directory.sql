do $migration$
declare f text; updated text;
begin
  select pg_get_functiondef('public.stockflow_user_gateway(text,text,text,jsonb)'::regprocedure) into f;
  updated := regexp_replace(f,
    $old$if v_actor_role <> 'administrator' then[[:space:]]+raise exception 'Administrator access is required' using errcode = '42501';[[:space:]]+end if;$old$,
    $new$if p_action = 'list_assignable_users' then
    if v_actor_role not in ('administrator','operations','management') then
      raise exception 'Role cannot assign orders' using errcode = '42501';
    end if;
    return jsonb_build_object('users', coalesce((
      select jsonb_agg(jsonb_build_object('email',email,'role',role) order by email)
      from public.stockflow_members where status='active' and role <> 'viewer'
    ), '[]'::jsonb));
  end if;
  if v_actor_role <> 'administrator' then
    raise exception 'Administrator access is required' using errcode = '42501';
  end if;$new$);
  if updated=f then raise exception 'Expected user authorization block was not found'; end if;
  execute updated;

  select pg_get_functiondef('public.stockflow_assignment_gateway(text,text,text,jsonb)'::regprocedure) into f;
  updated := replace(f,
    $old$not exists(select 1 from public.stockflow_members where email=v_assignee and status='active')$old$,
    $new$not exists(select 1 from public.stockflow_members where email=v_assignee and status='active' and role <> 'viewer')$new$);
  if updated=f then raise exception 'Expected active assignee check was not found'; end if;
  execute updated;
end $migration$;

revoke all on function public.stockflow_user_gateway(text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.stockflow_assignment_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_user_gateway(text,text,text,jsonb) to service_role;
grant execute on function public.stockflow_assignment_gateway(text,text,text,jsonb) to service_role;
