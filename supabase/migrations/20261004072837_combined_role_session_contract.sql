begin;
do $migration$
declare f text; pair text[];
begin
  select pg_get_functiondef('public.stockflow_user_gateway(text,text,text,jsonb)'::regprocedure) into f;
  foreach pair slice 1 in array array[
    array['v_actor_role text;','v_actor_role text; v_actor_roles text[];'],
    array['select role into v_actor_role from public.stockflow_members','select role, roles into v_actor_role, v_actor_roles from public.stockflow_members'],
    array['if v_actor_role is null then','if v_actor_role is null or not private.stockflow_valid_roles(v_actor_roles) then'],
    array['jsonb_build_object(''email'', v_actor_email, ''role'', v_actor_role)',
      'jsonb_build_object(''email'', v_actor_email, ''role'', v_actor_role, ''roles'', v_actor_roles)']
  ] loop
    if (length(f)-length(replace(f,pair[1],'')))/length(pair[1])<>1 then
      raise exception 'Expected session gateway fragment missing: %',pair[1];
    end if;
    f:=replace(f,pair[1],pair[2]);
  end loop;
  execute f;
end $migration$;
revoke all on function public.stockflow_user_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_user_gateway(text,text,text,jsonb) to service_role;
commit;
