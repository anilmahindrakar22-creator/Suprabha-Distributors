begin;

alter table private.stockflow_purchase_order_lines add column original_quantity numeric;
update private.stockflow_purchase_order_lines set original_quantity=quantity;
alter table private.stockflow_purchase_order_lines alter column original_quantity set not null;
alter table private.stockflow_purchase_order_lines add constraint stockflow_po_lines_original_quantity_check
  check (original_quantity>0 and original_quantity<=1000000);

create function private.stockflow_po_line_original_default()
returns trigger language plpgsql set search_path=pg_catalog,private as $$
begin
  new.original_quantity:=coalesce(new.original_quantity,new.quantity);
  return new;
end $$;
create trigger stockflow_po_line_original_default before insert on private.stockflow_purchase_order_lines
  for each row execute function private.stockflow_po_line_original_default();
create function private.stockflow_po_line_original_immutable()
returns trigger language plpgsql set search_path=pg_catalog,private as $$
begin
  if new.original_quantity is distinct from old.original_quantity then
    raise exception 'Original quantity cannot change' using errcode='22023'; end if;
  return new;
end $$;
create trigger stockflow_po_line_original_immutable before update on private.stockflow_purchase_order_lines
  for each row execute function private.stockflow_po_line_original_immutable();

alter table private.stockflow_purchase_orders
  add column supplier_confirmed_at timestamptz,
  add column resend_needed_at timestamptz,
  add column revision_count integer not null default 0 check (revision_count>=0);

do $constraint$
declare v_name text; v_count integer;
begin
  select count(*),min(conname::text) into v_count,v_name from pg_constraint
    where conrelid='private.stockflow_purchase_order_events'::regclass and contype='c'
      and pg_get_constraintdef(oid) like '%mark_purchase_order_shared%';
  if v_count<>1 then raise exception 'Expected exactly one purchase order event type constraint'; end if;
  execute format('alter table private.stockflow_purchase_order_events drop constraint %I',v_name);
end $constraint$;
alter table private.stockflow_purchase_order_events add constraint stockflow_purchase_order_events_event_type_check
  check (event_type in ('created','mark_purchase_order_shared','receive_purchase_order','cancel_purchase_order',
    'request_po_quantity_correction','decide_po_quantity_correction','correct_purchase_order_quantity','confirm_purchase_order_supplier'));
create index stockflow_po_events_po_type_time on private.stockflow_purchase_order_events(po_id,event_type,recorded_at desc);

create table private.stockflow_po_correction_requests (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null,
  tally_item_key text not null,
  foreign key(po_id,tally_item_key) references private.stockflow_purchase_order_lines(po_id,tally_item_key),
  from_quantity numeric not null check (from_quantity>0 and from_quantity<=1000000),
  to_quantity numeric not null check (to_quantity>0 and to_quantity<=1000000),
  check (to_quantity<>from_quantity),
  reason_code text not null check (reason_code in ('typing_mistake','supplier_changed','requirement_changed')),
  note text not null check (char_length(btrim(note)) between 3 and 300),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by_email text not null,
  requested_at timestamptz not null default now(),
  decided_by_email text,
  decided_at timestamptz,
  decision_note text check (decision_note is null or char_length(btrim(decision_note)) between 1 and 300),
  check ((status='pending') = (decided_by_email is null and decided_at is null))
);
create unique index stockflow_po_correction_one_pending on private.stockflow_po_correction_requests(po_id,tally_item_key) where status='pending';
create index stockflow_po_correction_requested_at on private.stockflow_po_correction_requests(requested_at desc);
alter table private.stockflow_po_correction_requests enable row level security;
revoke all on private.stockflow_po_correction_requests from public,anon,authenticated,service_role;

-- Existing projections, line ordering and total-value semantics are unchanged.
create or replace function private.stockflow_purchase_order_json(p_id uuid,p_show_rates boolean)
returns jsonb language sql stable set search_path=pg_catalog,private as $$
  select jsonb_build_object('id',o.id,'poNumber',o.po_number,'supplierName',o.supplier_name,'status',o.status,
    'sharedAt',o.shared_at,'version',o.version,'createdAt',o.created_at,'createdByEmail',o.created_by_email,
    'revisionCount',o.revision_count,'resendNeeded',o.resend_needed_at is not null,'supplierConfirmedAt',o.supplier_confirmed_at,
    'pendingCorrections',(select coalesce(jsonb_agg(jsonb_build_object(
      'requestId',q.id,'itemKey',q.tally_item_key,'fromQuantity',q.from_quantity,'toQuantity',q.to_quantity,
      'reasonCode',q.reason_code,'note',q.note,'requestedByEmail',q.requested_by_email,'requestedAt',q.requested_at)
      order by q.requested_at),'[]') from private.stockflow_po_correction_requests q where q.po_id=o.id and q.status='pending'),
    'corrections',(select coalesce(jsonb_agg(jsonb_build_object(
      'itemKey',e.metadata->'itemKey','fromQuantity',e.metadata->'fromQuantity','toQuantity',e.metadata->'toQuantity',
      'reasonCode',e.metadata->'reasonCode','note',e.metadata->'note','requestedByEmail',e.metadata->'requestedByEmail',
      'approvedByEmail',e.metadata->'approvedByEmail','recordedAt',e.recorded_at) order by e.recorded_at desc),'[]')
      from (select metadata,recorded_at from private.stockflow_purchase_order_events
        where po_id=o.id and event_type='correct_purchase_order_quantity' order by recorded_at desc limit 20) e),
    'lines',(select jsonb_agg(jsonb_build_object('itemKey',l.tally_item_key,'itemName',l.item_name,
      'quantity',l.quantity,'unit',l.unit,'receivedQuantity',l.received_quantity,
      'originalQuantity',l.original_quantity,'locked',exists(select 1 from private.stockflow_po_tally_receipt_links k
        where k.po_id=l.po_id and k.tally_item_key=l.tally_item_key))
      || case when p_show_rates then jsonb_build_object('rate',l.rate) else '{}'::jsonb end order by l.tally_item_key)
      from private.stockflow_purchase_order_lines l where l.po_id=o.id))
    || case when p_show_rates then jsonb_build_object('totalValue',
      (select case when count(rate)=count(*) then sum(quantity*rate) end from private.stockflow_purchase_order_lines where po_id=o.id))
      else '{}'::jsonb end
  from private.stockflow_purchase_orders o where o.id=p_id
$$;

create function public.stockflow_po_revision_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=pg_catalog,private,extensions as $$
declare
  v_actor text:=lower(btrim(coalesce(p_actor_email,''))); v_hash text; v_roles text[]; v_show_rates boolean;
  v_result jsonb; v_key text:=p_payload->>'idempotencyKey'; v_id uuid; v_version integer; v_request_id uuid;
  v_order private.stockflow_purchase_orders%rowtype;
  v_line private.stockflow_purchase_order_lines%rowtype;
  v_request private.stockflow_po_correction_requests%rowtype;
  v_qty numeric; v_note text; v_reason text; v_decision text; v_applied boolean;
  v_since date:=(now() at time zone 'Asia/Kolkata')::date-7;
begin
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_hash then
    raise exception 'Unauthorized gateway' using errcode='42501'; end if;
  select roles into v_roles from public.stockflow_members where email=v_actor and status='active';
  if not private.stockflow_valid_roles(v_roles) or not coalesce(v_roles && array['administrator','management','operations'],false) then
    raise exception 'Role cannot manage purchase orders' using errcode='42501'; end if;
  if p_action is null or p_action not in ('request_po_quantity_correction','decide_po_quantity_correction','confirm_purchase_order_supplier','list_po_corrections')
    or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid purchase action' using errcode='22023'; end if;
  if p_action in ('decide_po_quantity_correction','list_po_corrections') and not (v_roles && array['management','administrator']) then
    raise exception 'Only management can review corrections' using errcode='42501'; end if;
  v_show_rates:=v_roles && array['administrator','management'];
  perform pg_advisory_xact_lock(hashtextextended('stockflow_purchase_actor:'||v_actor,0));
  if (select count(*) from private.stockflow_request_log where actor_email=v_actor and created_at>=now()-interval '1 minute')>=30 then
    raise exception 'Too many order requests' using errcode='54000'; end if;
  insert into private.stockflow_request_log(actor_email,action) values(v_actor,p_action);

  if p_action='list_po_corrections' then
    if p_payload<>'{}'::jsonb then raise exception 'Invalid corrections list payload' using errcode='22023'; end if;
    with activity as (
      select e.po_id,max(e.recorded_at) last_activity from private.stockflow_purchase_order_events e
      where e.event_type in ('correct_purchase_order_quantity','request_po_quantity_correction')
        and e.recorded_at>=v_since::timestamp at time zone 'Asia/Kolkata'
      group by e.po_id order by max(e.recorded_at) desc,e.po_id limit 100
    ), items as (
      select o.*,a.last_activity,
        (select count(*) from private.stockflow_purchase_order_events e where e.po_id=o.id
          and e.event_type='correct_purchase_order_quantity') corrections,
        (select count(*) from private.stockflow_po_correction_requests q where q.po_id=o.id
          and q.status='pending' and o.status='open') pending,
        exists(select 1 from private.stockflow_purchase_order_events e where e.po_id=o.id
          and e.event_type in ('correct_purchase_order_quantity','request_po_quantity_correction')
          and e.recorded_at>=v_since::timestamp at time zone 'Asia/Kolkata'
          and (e.metadata->>'requestedByEmail'=o.created_by_email or e.actor_email=o.created_by_email)) by_creator,
        exists(select 1 from private.stockflow_purchase_order_events e
          join private.stockflow_purchase_order_events receipt on receipt.po_id=e.po_id
            and receipt.event_type='receive_purchase_order' and receipt.recorded_at>=e.recorded_at
            and receipt.recorded_at<=e.recorded_at+interval '24 hours'
          where e.po_id=o.id and e.event_type='correct_purchase_order_quantity') before_receipt
      from activity a join private.stockflow_purchase_orders o on o.id=a.po_id
    )
    select jsonb_build_object('view','po_corrections','since',v_since,'items',coalesce(jsonb_agg(jsonb_build_object(
      'poId',id,'poNumber',po_number,'supplierName',supplier_name,'status',status,'createdByEmail',created_by_email,
      'corrections',corrections,'pending',pending,'flags',jsonb_build_object('byCreator',by_creator,
        'moreThanTwo',corrections>2,'beforeReceipt',before_receipt,'notResent',resend_needed_at is not null))
      order by last_activity desc,id),'[]')) into v_result from items;
    return case when v_show_rates then v_result else private.stockflow_purchase_redact(v_result) end;
  end if;

  if p_action='request_po_quantity_correction' then
    if not (p_payload ?& array['id','expectedVersion','itemKey','quantity','reasonCode','note','idempotencyKey'])
      or p_payload-array['id','expectedVersion','itemKey','quantity','reasonCode','note','idempotencyKey']<>'{}'::jsonb then
      raise exception 'Invalid correction payload' using errcode='22023'; end if;
  elsif p_action='decide_po_quantity_correction' then
    if not (p_payload ?& array['requestId','expectedVersion','decision','idempotencyKey'])
      or p_payload-array['requestId','expectedVersion','decision','note','idempotencyKey']<>'{}'::jsonb then
      raise exception 'Invalid correction decision payload' using errcode='22023'; end if;
  else
    if not (p_payload ?& array['id','expectedVersion','idempotencyKey'])
      or p_payload-array['id','expectedVersion','note','idempotencyKey']<>'{}'::jsonb then
      raise exception 'Invalid supplier confirmation payload' using errcode='22023'; end if;
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
  if p_action='decide_po_quantity_correction' then
    v_request_id:=(p_payload->>'requestId')::uuid;
    -- Discover the parent without locking the child; all writers lock PO first.
    select po_id into v_id from private.stockflow_po_correction_requests where id=v_request_id;
    if not found then raise exception 'Correction request not found' using errcode='22023'; end if;
  else
    v_id:=(p_payload->>'id')::uuid;
    if v_id is null then raise exception 'Valid ID and expected version required' using errcode='22023'; end if;
  end if;
  select * into v_order from private.stockflow_purchase_orders where id=v_id for update;
  if not found then raise exception 'Purchase order not found' using errcode='22023'; end if;
  if v_order.version<>v_version then raise exception 'Purchase order has changed' using errcode='PT409'; end if;

  if p_action='request_po_quantity_correction' then
    if jsonb_typeof(p_payload->'quantity') is distinct from 'number' then raise exception 'Invalid quantity' using errcode='22023'; end if;
    if jsonb_typeof(p_payload->'itemKey') is distinct from 'string' then raise exception 'Purchase order line not found' using errcode='22023'; end if;
    if jsonb_typeof(p_payload->'note') is distinct from 'string' or char_length(btrim(p_payload->>'note')) not between 3 and 300 then
      raise exception 'Correction note must contain 3 to 300 characters' using errcode='22023'; end if;
    v_note:=btrim(p_payload->>'note'); v_reason:=p_payload->>'reasonCode'; v_qty:=(p_payload->>'quantity')::numeric;
    if v_reason is null or v_reason not in ('typing_mistake','supplier_changed','requirement_changed') then
      raise exception 'Invalid correction reason' using errcode='22023'; end if;
    if v_order.status<>'open' then raise exception 'Open purchase order required' using errcode='22023'; end if;
    select * into v_line from private.stockflow_purchase_order_lines where po_id=v_id and tally_item_key=p_payload->>'itemKey';
    if not found then raise exception 'Purchase order line not found' using errcode='22023'; end if;
    if exists(select 1 from private.stockflow_po_tally_receipt_links where po_id=v_id and tally_item_key=v_line.tally_item_key) then
      raise exception 'Line is locked: a Tally receipt is linked' using errcode='22023'; end if;
    if v_qty=v_line.quantity then raise exception 'Enter a different quantity' using errcode='22023'; end if;
    if v_qty<=0 or v_qty>1000000 then raise exception 'Invalid quantity' using errcode='22023'; end if;
    if v_qty<v_line.received_quantity then raise exception 'Quantity cannot be below what was received' using errcode='22023'; end if;
    if exists(select 1 from private.stockflow_po_correction_requests where po_id=v_id and tally_item_key=v_line.tally_item_key and status='pending') then
      raise exception 'A correction is already waiting for approval' using errcode='22023'; end if;
    v_applied:=v_order.shared_at is null and (v_qty<v_line.quantity or v_qty<=v_line.original_quantity*1.2);
    if v_applied then
      update private.stockflow_purchase_order_lines set quantity=v_qty where po_id=v_id and tally_item_key=v_line.tally_item_key;
      update private.stockflow_purchase_orders set revision_count=revision_count+1,supplier_confirmed_at=null where id=v_id;
      insert into private.stockflow_purchase_order_events(po_id,event_type,actor_email,metadata)
        values(v_id,'correct_purchase_order_quantity',v_actor,jsonb_build_object('itemKey',v_line.tally_item_key,
          'fromQuantity',v_line.quantity,'toQuantity',v_qty,'reasonCode',v_reason,'note',v_note,
          'requestedByEmail',v_actor,'approvedByEmail',null,'mode','direct'));
    else
      begin
        insert into private.stockflow_po_correction_requests(po_id,tally_item_key,from_quantity,to_quantity,reason_code,note,requested_by_email)
          values(v_id,v_line.tally_item_key,v_line.quantity,v_qty,v_reason,v_note,v_actor) returning id into v_request_id;
      exception when unique_violation then
        raise exception 'A correction is already waiting for approval' using errcode='22023';
      end;
      insert into private.stockflow_purchase_order_events(po_id,event_type,actor_email,metadata)
        values(v_id,'request_po_quantity_correction',v_actor,jsonb_build_object('requestId',v_request_id,
          'itemKey',v_line.tally_item_key,'fromQuantity',v_line.quantity,'toQuantity',v_qty,'reasonCode',v_reason,'note',v_note));
    end if;
  elsif p_action='decide_po_quantity_correction' then
    v_decision:=p_payload->>'decision';
    if v_decision is null or v_decision not in ('approve','reject') then raise exception 'Invalid correction decision' using errcode='22023'; end if;
    if p_payload ? 'note' and (jsonb_typeof(p_payload->'note') is distinct from 'string' or char_length(btrim(p_payload->>'note'))>300) then
      raise exception 'Decision note must contain at most 300 characters' using errcode='22023'; end if;
    v_note:=nullif(btrim(p_payload->>'note'),'');
    select * into v_request from private.stockflow_po_correction_requests where id=v_request_id and po_id=v_id for update;
    if not found then raise exception 'Correction request not found' using errcode='22023'; end if;
    if v_request.status<>'pending' then raise exception 'This request was already decided' using errcode='22023'; end if;
    if v_actor=v_request.requested_by_email then raise exception 'You cannot approve your own correction' using errcode='42501'; end if;
    if not ('management'=any(v_roles)) and exists(select 1 from public.stockflow_members
      where status='active' and 'management'=any(roles) and email<>v_request.requested_by_email) then
      raise exception 'A manager must review this correction' using errcode='42501'; end if;
    if v_decision='approve' then
      if v_order.status<>'open' then raise exception 'Open purchase order required' using errcode='22023'; end if;
      select * into v_line from private.stockflow_purchase_order_lines where po_id=v_id and tally_item_key=v_request.tally_item_key;
      if exists(select 1 from private.stockflow_po_tally_receipt_links where po_id=v_id and tally_item_key=v_request.tally_item_key) then
        raise exception 'Line is locked: a Tally receipt is linked' using errcode='22023'; end if;
      if v_line.quantity<>v_request.from_quantity then
        raise exception 'This line changed after the request. Reject it and ask again.' using errcode='22023'; end if;
      if v_request.to_quantity<v_line.received_quantity then raise exception 'Quantity cannot be below what was received' using errcode='22023'; end if;
      update private.stockflow_purchase_order_lines set quantity=v_request.to_quantity where po_id=v_id and tally_item_key=v_request.tally_item_key;
      update private.stockflow_purchase_orders set revision_count=revision_count+1,supplier_confirmed_at=null,
        resend_needed_at=case when shared_at is not null then now() else resend_needed_at end where id=v_id;
      insert into private.stockflow_purchase_order_events(po_id,event_type,actor_email,metadata)
        values(v_id,'correct_purchase_order_quantity',v_actor,jsonb_build_object('itemKey',v_request.tally_item_key,
          'fromQuantity',v_request.from_quantity,'toQuantity',v_request.to_quantity,'reasonCode',v_request.reason_code,'note',v_request.note,
          'requestedByEmail',v_request.requested_by_email,'approvedByEmail',v_actor,'mode','approved','requestId',v_request_id));
    end if;
    update private.stockflow_po_correction_requests set status=case when v_decision='approve' then 'approved' else 'rejected' end,
      decided_by_email=v_actor,decided_at=now(),decision_note=v_note where id=v_request_id;
    insert into private.stockflow_purchase_order_events(po_id,event_type,actor_email,metadata)
      values(v_id,'decide_po_quantity_correction',v_actor,jsonb_build_object('requestId',v_request_id,'decision',v_decision,'note',v_note));
  else
    if p_payload ? 'note' and (jsonb_typeof(p_payload->'note') is distinct from 'string' or char_length(btrim(p_payload->>'note'))>200) then
      raise exception 'Confirmation note must contain at most 200 characters' using errcode='22023'; end if;
    v_note:=nullif(btrim(p_payload->>'note'),'');
    if v_order.status<>'open' then raise exception 'Open purchase order required' using errcode='22023'; end if;
    if v_order.shared_at is null then raise exception 'Share the purchase order first' using errcode='22023'; end if;
    if v_order.resend_needed_at is not null then raise exception 'Share the corrected PO first' using errcode='22023'; end if;
    update private.stockflow_purchase_orders set supplier_confirmed_at=now() where id=v_id;
    insert into private.stockflow_purchase_order_events(po_id,event_type,actor_email,metadata)
      values(v_id,'confirm_purchase_order_supplier',v_actor,jsonb_build_object('note',v_note));
  end if;
  update private.stockflow_purchase_orders set version=version+1,updated_at=now() where id=v_id;
  v_result:=jsonb_build_object('purchaseOrder',private.stockflow_purchase_order_json(v_id,true));
  if p_action='request_po_quantity_correction' then v_result:=jsonb_build_object('applied',v_applied)||v_result; end if;
  perform private.finish_stockflow_command(v_actor,p_action,v_key,p_payload,v_id,v_result);
  return case when v_show_rates then v_result else private.stockflow_purchase_redact(v_result) end;
exception when invalid_text_representation or numeric_value_out_of_range or check_violation or not_null_violation then
  raise exception 'Invalid purchase order data' using errcode='22023';
end $$;

alter function public.stockflow_purchase_gateway(text,text,text,jsonb) rename to stockflow_purchase_gateway_before_revisions;
create function public.stockflow_purchase_gateway(p_gateway_key text,p_actor_email text,p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=pg_catalog,private,extensions as $$
declare
  v_actor text:=lower(btrim(coalesce(p_actor_email,''))); v_hash text; v_roles text[];
  v_id uuid; v_order private.stockflow_purchase_orders%rowtype;
begin
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_hash then
    raise exception 'Unauthorized gateway' using errcode='42501'; end if;
  select roles into v_roles from public.stockflow_members where email=v_actor and status='active';
  if not private.stockflow_valid_roles(v_roles) or not coalesce(v_roles && array['administrator','management','operations'],false) then
    raise exception 'Role cannot manage purchase orders' using errcode='42501'; end if;
  if p_action='mark_purchase_order_shared' then
    if p_payload ? 'channel' and (jsonb_typeof(p_payload->'channel') is distinct from 'string'
      or p_payload->>'channel' not in ('text','pdf')) then
      raise exception 'Invalid share channel' using errcode='22023'; end if;
    perform pg_advisory_xact_lock(hashtextextended('stockflow_purchase_actor:'||v_actor,0));
    begin
      v_id:=(p_payload->>'id')::uuid;
      select * into v_order from private.stockflow_purchase_orders where id=v_id for update;
      if found and v_order.version=(p_payload->>'expectedVersion')::integer then
        update private.stockflow_purchase_orders set resend_needed_at=null where id=v_id;
      end if;
    exception when invalid_text_representation or numeric_value_out_of_range then
      -- The original gateway owns malformed ID/version errors and cached replays.
      null;
    end;
  end if;
  return public.stockflow_purchase_gateway_before_revisions(p_gateway_key,p_actor_email,p_action,p_payload);
end $$;

revoke all on function private.stockflow_po_line_original_default(),private.stockflow_po_line_original_immutable(),
  private.stockflow_purchase_order_json(uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function public.stockflow_purchase_gateway_before_revisions(text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.stockflow_purchase_gateway(text,text,text,jsonb),
  public.stockflow_po_revision_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_purchase_gateway(text,text,text,jsonb),
  public.stockflow_po_revision_gateway(text,text,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
