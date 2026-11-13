begin;

-- Round display-only derived prices at the gateway; internal comparisons stay exact.
create or replace function private.stockflow_growth_integer_paise(p jsonb) returns jsonb
language plpgsql immutable set search_path=pg_catalog as $$
declare result jsonb;
begin
 if p is null then return null;end if;
 case jsonb_typeof(p)
 when 'object' then
  select coalesce(jsonb_object_agg(k,case
   when strpos(lower(k),'paise')>0 and jsonb_typeof(v)='number' then to_jsonb(round(v::text::numeric))
   else private.stockflow_growth_integer_paise(v) end),'{}'::jsonb)
  into result from jsonb_each(p) as e(k,v);
 when 'array' then
  select coalesce(jsonb_agg(private.stockflow_growth_integer_paise(v) order by ord),'[]'::jsonb)
  into result from jsonb_array_elements(p) with ordinality as e(v,ord);
 else return p;
 end case;
 return result;
end$$;

revoke all on function private.stockflow_growth_integer_paise(jsonb) from public,anon,authenticated,service_role;

do $patch$
declare f text; old_text text; new_text text;
begin
 select replace(pg_get_functiondef('public.stockflow_growth_gateway(text,text,text,jsonb)'::regprocedure),chr(13),'') into f;
 old_text:=$old$return private.stockflow_growth_margin_read((now() at time zone 'Asia/Kolkata')::date,p_payload);$old$;
 new_text:=$new$return private.stockflow_growth_integer_paise(private.stockflow_growth_margin_read((now() at time zone 'Asia/Kolkata')::date,p_payload));$new$;
 if (length(f)-length(replace(f,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected growth paise gateway seam';end if;
 f:=replace(f,old_text,new_text);
 old_text:=$old$return private.stockflow_growth_margin_detail((now() at time zone 'Asia/Kolkata')::date,p_payload);$old$;
 new_text:=$new$return private.stockflow_growth_integer_paise(private.stockflow_growth_margin_detail((now() at time zone 'Asia/Kolkata')::date,p_payload));$new$;
 if (length(f)-length(replace(f,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected growth paise gateway seam';end if;
 f:=replace(f,old_text,new_text);
 old_text:=$old$return private.stockflow_growth_billed_below((now() at time zone 'Asia/Kolkata')::date,p_payload);$old$;
 new_text:=$new$return private.stockflow_growth_integer_paise(private.stockflow_growth_billed_below((now() at time zone 'Asia/Kolkata')::date,p_payload));$new$;
 if (length(f)-length(replace(f,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected growth paise gateway seam';end if;
 f:=replace(f,old_text,new_text);
 execute f;
end$patch$;

revoke all on function public.stockflow_growth_gateway(text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.stockflow_growth_gateway(text,text,text,jsonb) to service_role;
commit;
