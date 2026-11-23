begin;

create function private.stockflow_stock_on_po() returns jsonb
language sql stable security definer set search_path=pg_catalog,private,public as $$
with outstanding as (
  select l.tally_item_key,l.quantity-l.received_quantity as due,p.id,p.po_number,p.created_at
  from private.stockflow_purchase_order_lines l
  join private.stockflow_purchase_orders p on p.id=l.po_id
  where p.status='open' and l.quantity-l.received_quantity>0
), grouped as (
  select tally_item_key,round(sum(due),3) as due_quantity,count(distinct id) as po_count,
    (array_agg(po_number order by created_at desc,po_number desc))[1] as latest_po_number,
    max(created_at) as latest_created_at
  from outstanding group by tally_item_key
  order by tally_item_key collate "C" limit 2000
)
select jsonb_build_object('view','on_po','items',coalesce((select jsonb_agg(
  jsonb_build_object('itemKey',tally_item_key,'dueQuantity',due_quantity,'poCount',po_count,
    'latestPoNumber',latest_po_number,'latestCreatedAt',latest_created_at)
  order by tally_item_key collate "C") from grouped),'[]'::jsonb))
$$;
revoke all on function private.stockflow_stock_on_po() from public,anon,authenticated,service_role;

alter function public.stockflow_requirements_gateway(text,text,text,jsonb)
  rename to stockflow_requirements_gateway_before_on_po;
create function public.stockflow_requirements_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,extensions as $$
declare v_hash text;
begin
  if p_action='get_requirements' and coalesce(p_payload->>'view','')='on_po' then
    select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
    if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_hash then
      raise exception 'Unauthorized gateway' using errcode='42501';
    end if;
    if not exists(select 1 from public.stockflow_members
      where email=lower(btrim(coalesce(p_actor_email,''))) and status='active') then
      raise exception 'Active membership required' using errcode='42501';
    end if;
    if p_payload - 'view' <> '{}'::jsonb then
      raise exception 'Invalid requirements view' using errcode='22023';
    end if;
    return private.stockflow_stock_on_po();
  end if;
  return public.stockflow_requirements_gateway_before_on_po(p_gateway_key,p_actor_email,p_action,p_payload);
end $$;
revoke all on function public.stockflow_requirements_gateway_before_on_po(text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.stockflow_requirements_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_requirements_gateway(text,text,text,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
