begin;
-- Operational invoice evidence is an allowlist, not a commercial payload.
create function private.stockflow_operational_invoice(p_invoice jsonb)
returns jsonb language sql immutable
set search_path=pg_catalog
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'voucherNumber',p_invoice->'voucherNumber','reference',p_invoice->'reference',
    'party',p_invoice->'party','date',p_invoice->'date','masterId',p_invoice->'masterId',
    'lineItems',case when jsonb_typeof(p_invoice->'lineItems')='array' then
      (select coalesce(jsonb_agg(jsonb_build_object('itemName',line->'itemName','quantity',line->'quantity')),'[]'::jsonb)
       from jsonb_array_elements(p_invoice->'lineItems') line) else null end
  ))
$$;
revoke all on function private.stockflow_operational_invoice(jsonb) from public,anon,authenticated;
do $migration$
declare f text; name text; pair text[]; expected integer;
begin
  foreach name in array array['stockflow_order_list_gateway','stockflow_order_detail_gateway'] loop
    select pg_get_functiondef(to_regprocedure('public.'||name||'(text,text,text,jsonb)')) into f;
    foreach pair slice 1 in array array[
      array['  v_role text;','  v_role text; v_roles text[];'],
      array['select role into v_role from public.stockflow_members','select role, roles into v_role, v_roles from public.stockflow_members'],
      array['if v_role is null then','if v_role is null or not private.stockflow_valid_roles(v_roles) then']
    ] loop
      if (length(f)-length(replace(f,pair[1],'')))/length(pair[1])<>1 then
        raise exception 'Expected read gateway fragment missing: % %',name,pair[1];
      end if;
      f:=replace(f,pair[1],pair[2]);
    end loop;
    if name='stockflow_order_list_gateway' then
      expected:=(length(f)-length(replace(f,'private.stockflow_role_can_read_order(v_email,v_role,','')))/length('private.stockflow_role_can_read_order(v_email,v_role,');
      if expected<>2 or position('jsonb_agg(invoice)' in f)=0 then raise exception 'Expected list scope/invoice projection missing'; end if;
      f:=replace(f,'private.stockflow_role_can_read_order(v_email,v_role,','private.stockflow_role_can_read_order(v_email,v_roles,');
      f:=replace(f,'jsonb_agg(invoice)','jsonb_agg(private.stockflow_operational_invoice(invoice))');
    else
      if position('private.assert_stockflow_order_access(v_email,v_role,v_order_id)' in f)=0 then raise exception 'Expected detail scope missing'; end if;
      f:=replace(f,'private.assert_stockflow_order_access(v_email,v_role,v_order_id)','private.assert_stockflow_order_access(v_email,v_roles,v_order_id)');
    end if;
    execute f;
  end loop;
end $migration$;
revoke all on function public.stockflow_order_list_gateway(text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.stockflow_order_detail_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_order_list_gateway(text,text,text,jsonb) to service_role;
grant execute on function public.stockflow_order_detail_gateway(text,text,text,jsonb) to service_role;
commit;
