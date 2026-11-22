begin;

create function private.stockflow_unlinked_po_receipts(p_today date,p_page integer)
returns jsonb language plpgsql stable set search_path=pg_catalog,private as $$
begin
  if p_page is null or p_page not between 1 and 100 then
    raise exception 'Invalid unlinked receipts page' using errcode='22023'; end if;
  return (
    with kept as materialized (
      select pv.source_id,pl.line_key,pv.business_date,
        coalesce(nullif(btrim(pv.evidence->>'sourceReference'),''),pv.source_id) reference,
        pl.evidence->>'label' item_key,coalesce(p.name,pl.evidence->>'label') item_name,
        pl.quantity,linked.quantity linked_quantity,pl.quantity-linked.quantity unlinked_quantity,pl.unit,
        (select jsonb_build_object('id',po.id,'poNumber',po.po_number,'stillDue',pol.quantity-pol.received_quantity)
          from private.stockflow_purchase_orders po
          join private.stockflow_purchase_order_lines pol on pol.po_id=po.id
          where po.status='open' and pol.tally_item_key=pl.evidence->>'label'
            and exists(select 1 from private.stockflow_po_receipt_candidates(po.id,pl.evidence->>'label') c
              where c.company_id=pv.company_id and c.source_id=pv.source_id
                and c.line_key=pl.line_key and c.selectable)
          order by po.created_at,po.po_number limit 1) open_po
      from private.stockflow_economic_source_lines pl
      join private.stockflow_economic_source_vouchers pv on pv.id=pl.voucher_id
      left join private.stockflow_products p on p.tally_item_key=pl.evidence->>'label'
      cross join lateral (
        select coalesce(sum(l.quantity),0) quantity from private.stockflow_po_tally_receipt_links l
        where l.company_id=pv.company_id and l.source_id=pv.source_id and l.line_key=pl.line_key
      ) linked
      where pv.kind='purchase' and not pv.cancelled and pl.quantity>0
        and pv.business_date between p_today-29 and p_today
        and not exists(select 1 from private.stockflow_economic_source_vouchers nv
          where nv.company_id=pv.company_id and nv.source_id=pv.source_id and nv.source_revision>pv.source_revision)
        and pl.quantity-linked.quantity>0
    ), page as (
      select * from kept order by business_date desc,reference,line_key offset (p_page-1)*20 limit 20
    )
    select jsonb_build_object('page',p_page,'pageSize',20,'total',(select count(*) from kept),
      'rows',coalesce((select jsonb_agg(jsonb_build_object(
        'sourceId',source_id,'lineKey',line_key,'date',to_char(business_date,'YYYY-MM-DD'),
        'reference',reference,'itemKey',item_key,'itemName',item_name,'quantity',quantity,
        'linkedQuantity',linked_quantity,'unlinkedQuantity',unlinked_quantity,'unit',unit,'openPo',open_po)
        order by business_date desc,reference,line_key) from page),'[]'::jsonb))
  );
end $$;
revoke all on function private.stockflow_unlinked_po_receipts(date,integer) from public,anon,authenticated,service_role;

create function public.stockflow_po_unlinked_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=pg_catalog,private,extensions as $$
declare
  v_actor text:=lower(btrim(coalesce(p_actor_email,''))); v_hash text; v_roles text[];
  v_page numeric;
begin
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_hash then
    raise exception 'Unauthorized gateway' using errcode='42501'; end if;
  select roles into v_roles from public.stockflow_members where email=v_actor and status='active';
  if not private.stockflow_valid_roles(v_roles) or not coalesce(v_roles && array['administrator','management','operations'],false) then
    raise exception 'Role cannot manage purchase orders' using errcode='42501'; end if;
  if p_action is distinct from 'get_unlinked_receipts' then
    raise exception 'Invalid purchase action' using errcode='22023'; end if;
  -- Use the purchase gateway's shared actor lock and admission counter.
  perform pg_advisory_xact_lock(hashtextextended('stockflow_purchase_actor:'||v_actor,0));
  if (select count(*) from private.stockflow_request_log where actor_email=v_actor and created_at>=now()-interval '1 minute')>=30 then
    raise exception 'Too many order requests' using errcode='54000'; end if;
  insert into private.stockflow_request_log(actor_email,action) values(v_actor,p_action);

  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'Invalid unlinked receipts page' using errcode='22023'; end if;
  if p_payload-'page'<>'{}'::jsonb or jsonb_typeof(p_payload->'page') is distinct from 'number' then
    raise exception 'Invalid unlinked receipts page' using errcode='22023'; end if;
  v_page:=(p_payload->>'page')::numeric;
  if v_page<>trunc(v_page) or v_page not between 1 and 100 then
    raise exception 'Invalid unlinked receipts page' using errcode='22023'; end if;
  return private.stockflow_unlinked_po_receipts((now() at time zone 'Asia/Kolkata')::date,v_page::integer);
end $$;
revoke all on function public.stockflow_po_unlinked_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_po_unlinked_gateway(text,text,text,jsonb) to service_role;
commit;
notify pgrst,'reload schema';
