begin;

-- Patch only unique seams in the live prospects definition.
do $patch$
declare definition text; old_text text; new_text text;
begin
 definition:=replace(pg_get_functiondef('private.stockflow_brand_prospects(text,text[],jsonb)'::regprocedure),chr(13),'');
 for old_text,new_text in select * from (values
 ($old$ v_today date:=(now() at time zone 'Asia/Kolkata')::date; v_result jsonb;
begin$old$,
  $new$ v_today date:=(now() at time zone 'Asia/Kolkata')::date; v_result jsonb;
 v_wallet jsonb; v_focus text[]:='{}';
begin$new$),
 ($old$  raise exception 'Active brand required' using errcode='22023';end if;

 with brand_areas$old$,
  $new$  raise exception 'Active brand required' using errcode='22023';end if;

 v_wallet:=private.stockflow_wallet_read(v_today);
 if v_wallet#>>'{coverage,certified}'='true' then
  select coalesce(array_agg(value->>'customerId'),'{}') into v_focus
  from jsonb_array_elements(v_wallet->'rows') where (value->>'inFocusBand')::boolean;
 end if;

 with brand_areas$new$),
 ($old$select c.*,i.customer_id is not null has_machine from$old$,
  $new$select c.*,i.customer_id is not null has_machine,c.id::text=any(v_focus) focus from$new$),
 ($old$order by has_machine,in_house desc,volume desc,name,id limit 20$old$,
  $new$order by focus desc,has_machine,in_house desc,volume desc,name,id limit 20$new$),
 ($old$order by s.has_machine,s.in_house desc,s.volume desc,s.name,s.id)$old$,
  $new$order by s.focus desc,s.has_machine,s.in_house desc,s.volume desc,s.name,s.id)$new$),
 ($old$'hasOurMachine',s.has_machine)$old$,
  $new$'hasOurMachine',s.has_machine,'focus',s.focus)$new$)
 ) patches(old_text,new_text) loop
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then
   raise exception 'Unexpected prospects focus anchor: %',old_text;
  end if;
  definition:=replace(definition,old_text,new_text);
  if position(old_text in definition)>0 then raise exception 'Legacy prospects focus anchor remains';end if;
 end loop;
 execute definition;
end $patch$;
revoke all on function private.stockflow_brand_prospects(text,text[],jsonb) from public,anon,authenticated,service_role;

commit;
