begin;

create table private.stockflow_po_tally_receipt_links (
  po_id uuid not null references private.stockflow_purchase_orders(id),
  tally_item_key text not null,
  company_id text not null,
  source_id text not null,
  line_key text not null,
  source_line_id uuid not null references private.stockflow_economic_source_lines(id),
  business_date date not null,
  quantity numeric not null,
  unit text not null,
  linked_by text not null,
  linked_at timestamptz not null default now(),
  foreign key(po_id,tally_item_key) references private.stockflow_purchase_order_lines(po_id,tally_item_key),
  constraint stockflow_po_tally_receipt_identity_rule check (
    char_length(btrim(company_id)) between 1 and 240 and char_length(btrim(source_id)) between 1 and 240
    and char_length(btrim(line_key)) between 1 and 240 and char_length(btrim(tally_item_key)) between 1 and 240),
  constraint stockflow_po_tally_receipt_quantity_rule check (quantity>0 and quantity not in ('NaN'::numeric,'Infinity'::numeric)),
  constraint stockflow_po_tally_receipt_evidence_rule check (
    isfinite(business_date) and char_length(btrim(unit)) between 1 and 80 and char_length(btrim(linked_by))>0)
);
-- Source identity deliberately excludes the revision-specific source_line_id.
create unique index stockflow_po_tally_receipt_source on private.stockflow_po_tally_receipt_links(company_id,source_id,line_key);
create index stockflow_po_tally_receipt_po on private.stockflow_po_tally_receipt_links(po_id,tally_item_key);
alter table private.stockflow_po_tally_receipt_links enable row level security;
revoke all on private.stockflow_po_tally_receipt_links from public,anon,authenticated,service_role;
create trigger no_delete before delete on private.stockflow_po_tally_receipt_links
  for each row execute function private.prevent_business_delete();
create trigger immutable before update on private.stockflow_po_tally_receipt_links
  for each row execute function private.prevent_immutable_pricing_update();

create index stockflow_economic_source_lines_label on private.stockflow_economic_source_lines ((evidence->>'label'));

-- One eligibility definition for both reads and transactional write validation.
-- Only evidence needed to record a receipt is projected; no financial fields.
create function private.stockflow_po_receipt_candidates(p_po_id uuid,p_item text)
returns table(source_line_id uuid,company_id text,source_id text,line_key text,business_date date,
  reference text,quantity numeric,unit text,selectable boolean,reason text)
language sql stable set search_path=pg_catalog,private as $$
  select pl.id,pv.company_id,pv.source_id,pl.line_key,pv.business_date,
    coalesce(nullif(btrim(pv.evidence->>'sourceReference'),''),pv.source_id),pl.quantity,pl.unit,
    coalesce(lower(btrim(pl.unit))=lower(btrim(coalesce(pol.unit,p.base_unit))),false)
      and pl.quantity<=pol.quantity-pol.received_quantity,
    case when not coalesce(lower(btrim(pl.unit))=lower(btrim(coalesce(pol.unit,p.base_unit))),false) then 'unit_mismatch'
      when pl.quantity>pol.quantity-pol.received_quantity then 'exceeds_remaining' end
  from private.stockflow_purchase_orders po
  join private.stockflow_purchase_order_lines pol on pol.po_id=po.id
  left join private.stockflow_products p on p.tally_item_key=pol.tally_item_key
  join private.stockflow_economic_source_lines pl on pl.evidence->>'label'=pol.tally_item_key
  join private.stockflow_economic_source_vouchers pv on pv.id=pl.voucher_id
  where po.id=p_po_id and po.status='open' and pol.tally_item_key=p_item
    and pv.kind='purchase' and not pv.cancelled
    and pv.business_date>=(po.created_at at time zone 'Asia/Kolkata')::date
    and pl.quantity>0
    and not exists(select 1 from private.stockflow_economic_source_vouchers nv
      where nv.company_id=pv.company_id and nv.source_id=pv.source_id and nv.source_revision>pv.source_revision)
    and not exists(select 1 from private.stockflow_po_tally_receipt_links linked
      where linked.company_id=pv.company_id and linked.source_id=pv.source_id and linked.line_key=pl.line_key)
$$;
revoke all on function private.stockflow_po_receipt_candidates(uuid,text) from public,anon,authenticated,service_role;

create function public.stockflow_po_receipt_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=pg_catalog,private,extensions as $$
declare
  v_actor text:=lower(btrim(coalesce(p_actor_email,''))); v_hash text; v_roles text[]; v_show_rates boolean;
  v_result jsonb; v_key text:=p_payload->>'idempotencyKey'; v_id uuid; v_version integer;
  v_order private.stockflow_purchase_orders%rowtype;
  v_entry jsonb; v_field text; v_candidate record; v_group record;
  v_links jsonb:='[]'; v_remaining numeric;
begin
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_hash then
    raise exception 'Unauthorized gateway' using errcode='42501'; end if;
  select roles into v_roles from public.stockflow_members where email=v_actor and status='active';
  if not private.stockflow_valid_roles(v_roles) or not coalesce(v_roles && array['administrator','management','operations'],false) then
    raise exception 'Role cannot manage purchase orders' using errcode='42501'; end if;
  v_show_rates:=v_roles && array['administrator','management'];
  if p_action is null or p_action not in ('get_tally_receipt_counts','get_tally_receipts','receive_from_tally')
    or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid purchase action' using errcode='22023'; end if;
  -- Use the purchase gateway's shared actor lock and admission counter.
  perform pg_advisory_xact_lock(hashtextextended('stockflow_purchase_actor:'||v_actor,0));
  if (select count(*) from private.stockflow_request_log where actor_email=v_actor and created_at>=now()-interval '1 minute')>=30 then
    raise exception 'Too many order requests' using errcode='54000'; end if;
  insert into private.stockflow_request_log(actor_email,action) values(v_actor,p_action);

  if p_action='get_tally_receipt_counts' then
    if jsonb_typeof(p_payload->'ids') is distinct from 'array' then raise exception 'IDs required' using errcode='22023'; end if;
    if jsonb_array_length(p_payload->'ids') not between 1 and 20 then raise exception 'Provide 1 to 20 IDs' using errcode='22023'; end if;
    for v_entry in select value from jsonb_array_elements(p_payload->'ids') loop
      if jsonb_typeof(v_entry) is distinct from 'string'
        or (v_entry#>>'{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'Valid purchase order IDs required' using errcode='22023'; end if;
    end loop;
    select jsonb_build_object('counts',jsonb_object_agg(q.id::text,q.n)) into v_result
    from (
      select ids.id,(select count(*) from private.stockflow_purchase_order_lines pol
        cross join lateral private.stockflow_po_receipt_candidates(ids.id,pol.tally_item_key) c
        where pol.po_id=ids.id and pol.quantity>pol.received_quantity and c.selectable) n
      from (select distinct value::uuid id from jsonb_array_elements_text(p_payload->'ids')) ids
    ) q;
    return case when v_show_rates then v_result else private.stockflow_purchase_redact(v_result) end;
  end if;
  if jsonb_typeof(p_payload->'id') is distinct from 'string'
    or coalesce(p_payload->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Valid purchase order ID required' using errcode='22023'; end if;
  v_id:=(p_payload->>'id')::uuid;
  if p_action='get_tally_receipts' then
    -- Keep version, remaining quantities and candidates on one statement snapshot.
    select jsonb_build_object('poId',po.id,'version',po.version,'lines',coalesce((
      select jsonb_agg(jsonb_build_object('itemKey',pol.tally_item_key,'itemName',pol.item_name,
        'unit',coalesce(pol.unit,p.base_unit),'quantity',pol.quantity,'receivedQuantity',pol.received_quantity,
        'remaining',pol.quantity-pol.received_quantity,'candidates',(
          select coalesce(jsonb_agg(jsonb_build_object('sourceId',c.source_id,'lineKey',c.line_key,
            'date',c.business_date,'reference',c.reference,'quantity',c.quantity,'unit',c.unit,
            'selectable',c.selectable,'reason',c.reason)
            order by c.business_date,c.reference,c.source_id,c.line_key,c.company_id),'[]')
          from (select * from private.stockflow_po_receipt_candidates(po.id,pol.tally_item_key)
            order by business_date,reference,source_id,line_key,company_id limit 20) c
        )) order by pol.tally_item_key)
      from private.stockflow_purchase_order_lines pol left join private.stockflow_products p on p.tally_item_key=pol.tally_item_key
      where pol.po_id=po.id),'[]')) into v_result
    from private.stockflow_purchase_orders po where po.id=v_id and po.status='open';
    if v_result is null then raise exception 'Open purchase order required' using errcode='22023'; end if;
    return case when v_show_rates then v_result else private.stockflow_purchase_redact(v_result) end;
  end if;

  if coalesce(v_key,'') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Valid idempotency key required' using errcode='22023'; end if;
  v_result:=private.begin_stockflow_command(v_actor,p_action,v_key,p_payload);
  if v_result is not null then
    return case when v_show_rates then v_result else private.stockflow_purchase_redact(v_result) end;
  end if;
  if jsonb_typeof(p_payload->'expectedVersion') is distinct from 'number' or (p_payload->>'expectedVersion') !~ '^[1-9][0-9]*$' then
    raise exception 'Valid ID and expected version required' using errcode='22023'; end if;
  v_version:=(p_payload->>'expectedVersion')::integer;
  select * into v_order from private.stockflow_purchase_orders where id=v_id for update;
  if not found then raise exception 'Purchase order not found' using errcode='22023'; end if;
  if v_order.version<>v_version then raise exception 'Purchase order has changed' using errcode='PT409'; end if;
  if v_order.status<>'open' then raise exception 'Open purchase order required' using errcode='22023'; end if;
  if jsonb_typeof(p_payload->'links') is distinct from 'array' then raise exception 'Links required' using errcode='22023'; end if;
  if jsonb_array_length(p_payload->'links') not between 1 and 100
    or (select count(distinct (value->>'itemKey',value->>'sourceId',value->>'lineKey')) from jsonb_array_elements(p_payload->'links'))<>jsonb_array_length(p_payload->'links') then
    raise exception 'Provide 1 to 100 distinct links' using errcode='22023'; end if;
  for v_entry in select value from jsonb_array_elements(p_payload->'links') loop
    if jsonb_typeof(v_entry) is distinct from 'object' then raise exception 'Invalid receipt link' using errcode='22023'; end if;
    foreach v_field in array array['itemKey','sourceId','lineKey'] loop
      if jsonb_typeof(v_entry->v_field) is distinct from 'string' or char_length(btrim(v_entry->>v_field)) not between 1 and 240 then
        raise exception 'Invalid receipt link' using errcode='22023'; end if;
    end loop;
    if not exists(select 1 from private.stockflow_purchase_order_lines where po_id=v_id and tally_item_key=v_entry->>'itemKey') then
      raise exception 'Invalid purchase order item' using errcode='22023'; end if;
    select c.*,count(*) over() match_count into v_candidate from private.stockflow_po_receipt_candidates(v_id,v_entry->>'itemKey') c
      where c.source_id=v_entry->>'sourceId' and c.line_key=v_entry->>'lineKey';
    if not found then
      if exists(select 1 from private.stockflow_po_tally_receipt_links linked
        where linked.source_id=v_entry->>'sourceId' and linked.line_key=v_entry->>'lineKey' and linked.tally_item_key=v_entry->>'itemKey') then
        raise exception 'Already recorded on another PO' using errcode='PT409'; end if;
      raise exception 'Tally receipt has changed; reload candidates' using errcode='PT409';
    elsif v_candidate.match_count>1 then
      -- The public contract has no company selector. Never guess between companies.
      raise exception 'Ambiguous Tally receipt; enter quantities by hand' using errcode='PT409';
    end if;
    if v_candidate.reason='unit_mismatch' then raise exception 'Different unit, enter by hand' using errcode='22023'; end if;
    v_links:=v_links||jsonb_build_array(to_jsonb(v_candidate)||jsonb_build_object('item_key',v_entry->>'itemKey'));
  end loop;
  -- Validate totals before inserting anything; multiple batches may share an item.
  for v_group in select x.item_key,sum(x.quantity) quantity from jsonb_to_recordset(v_links) x(item_key text,quantity numeric) group by x.item_key loop
    select quantity-received_quantity into v_remaining from private.stockflow_purchase_order_lines where po_id=v_id and tally_item_key=v_group.item_key;
    if v_group.quantity>v_remaining then
      raise exception 'Only % remaining for %; enter quantities by hand',v_remaining,v_group.item_key using errcode='22023'; end if;
  end loop;
  begin
    insert into private.stockflow_po_tally_receipt_links(po_id,tally_item_key,company_id,source_id,line_key,source_line_id,business_date,quantity,unit,linked_by)
      select v_id,x.item_key,x.company_id,x.source_id,x.line_key,x.source_line_id,x.business_date,x.quantity,x.unit,v_actor
      from jsonb_to_recordset(v_links) x(item_key text,company_id text,source_id text,line_key text,source_line_id uuid,business_date date,quantity numeric,unit text)
      order by x.company_id,x.source_id,x.line_key;
  exception when unique_violation then
    raise exception 'Already recorded on another PO' using errcode='PT409';
  end;
  update private.stockflow_purchase_order_lines pol set received_quantity=pol.received_quantity+q.quantity
    from (select x.item_key,sum(x.quantity) quantity from jsonb_to_recordset(v_links) x(item_key text,quantity numeric) group by x.item_key) q
    where pol.po_id=v_id and pol.tally_item_key=q.item_key;
  update private.stockflow_purchase_orders set status=case when exists(
    select 1 from private.stockflow_purchase_order_lines where po_id=v_id and received_quantity<quantity) then 'open' else 'received' end,
    version=version+1,updated_at=now() where id=v_id;
  insert into private.stockflow_purchase_order_events(po_id,event_type,actor_email,metadata)
    values(v_id,'receive_purchase_order',v_actor,(p_payload-'idempotencyKey')||jsonb_build_object('source','tally'));
  v_result:=private.stockflow_purchase_order_json(v_id,true);
  perform private.finish_stockflow_command(v_actor,p_action,v_key,p_payload,v_id,v_result);
  return case when v_show_rates then v_result else private.stockflow_purchase_redact(v_result) end;
exception when invalid_text_representation or numeric_value_out_of_range or check_violation or not_null_violation then
  raise exception 'Invalid purchase order data' using errcode='22023';
end $$;
revoke all on function public.stockflow_po_receipt_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_po_receipt_gateway(text,text,text,jsonb) to service_role;
commit;
notify pgrst,'reload schema';
