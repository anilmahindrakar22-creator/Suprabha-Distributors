begin;

-- Preserve the live gateway and require one exact, version-checked location seam.
do $patch$
declare definition text; old_text text; new_text text;
begin
 definition:=replace(pg_get_functiondef('public.stockflow_accounts_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'');
 old_text:=$old$      if v_expected is distinct from v_location.version then raise exception 'Location changed; refresh and try again' using errcode='PT409'; end if;$old$;
 new_text:=old_text||$new$
      if v_location.precision='pin' and not (v_roles && array['administrator','management']::text[]) then raise exception 'Only management can move a pin' using errcode='PT403'; end if;$new$;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected accounts pin location anchor';end if;
 definition:=replace(definition,old_text,new_text);
 execute definition;
end $patch$;

commit;
