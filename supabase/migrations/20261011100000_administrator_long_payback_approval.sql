begin;

-- Owner decision D-04, 13 Oct 2026: management can still approve within the
-- review band. Beyond it, only an administrator with explicit confirmation
-- (directorException retained for API compatibility) can approve capital exposure.
-- limit_exceeded stays blocked for everyone, including administrators.
do $upgrade$
declare definition text; anchor text; old_message text; new_message text; i integer;
begin
 definition:=replace(pg_get_functiondef('public.stockflow_economics_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'');
 anchor:=$seam$not coalesce((p_payload->>'directorException')::boolean,false)$seam$;
 if position('roles:=private.stockflow_active_member_roles(actor)' in definition)=0
  or (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>3
 then raise exception 'Unexpected economics gateway seam';end if;
 definition:=replace(definition,anchor,$seam$(not coalesce((p_payload->>'directorException')::boolean,false) or not (roles && array['administrator']::text[]))$seam$);
 for i in 1..3 loop
  old_message:=(array['''Director exception required for revised acquisition payback''','''Explicit director exception required for long payback''','''Director exception required for increased capital payback'''])[i];
  new_message:=(array['''Administrator approval required for revised acquisition payback beyond the review band''','''Administrator approval required for payback beyond the review band''','''Administrator approval required for increased capital payback beyond the review band'''])[i];
  if (length(definition)-length(replace(definition,old_message,'')))/length(old_message)<>1 then raise exception 'Unexpected economics gateway seam';end if;
  definition:=replace(definition,old_message,new_message);
 end loop;
 -- Expose the active administrator permission alongside the existing workspace permissions.
 anchor:='return private.stockflow_economic_workspace(roles);';
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'Unexpected economics gateway seam';end if;
 definition:=replace(definition,anchor,$seam$return private.stockflow_economic_workspace(roles)||jsonb_build_object('canAdministrator',roles && array['administrator']::text[]);$seam$);
 execute definition;
end$upgrade$;
revoke all on function public.stockflow_economics_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_economics_gateway(text,text,text,jsonb) to service_role;
commit;
