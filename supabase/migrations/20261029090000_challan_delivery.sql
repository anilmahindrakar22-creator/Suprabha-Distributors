begin;

alter table private.stockflow_orders
  add column challan_number text check (challan_number is null or
    (challan_number=btrim(challan_number) and char_length(challan_number) between 1 and 40)),
  add column challan_at timestamptz,
  add column challan_billed_at timestamptz;

alter function public.stockflow_order_gateway(text,text,text,jsonb)
  rename to stockflow_order_gateway_before_challan;

-- Preserve the command entry point, including its security and search path.
create function public.stockflow_order_gateway(
  p_gateway_key text, p_actor_email text, p_action text, p_payload jsonb default '{}'
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,private as $$
declare
  v_email text := lower(btrim(coalesce(p_actor_email,'')));
  v_role text;
  v_roles text[];
  v_allowed text[];
  v_hash text;
  v_order private.stockflow_orders%rowtype;
  v_id uuid;
  v_version integer;
  v_key text := p_payload->>'idempotencyKey';
  v_number text;
  v_result jsonb;
begin
  if p_action not in ('send_on_challan','bill_challan') or p_action is null then
    return public.stockflow_order_gateway_before_challan(p_gateway_key,p_actor_email,p_action,p_payload);
  end if;
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex')<>v_hash then
    raise exception 'Unauthorized gateway' using errcode='42501';
  end if;
  select role,roles into v_role,v_roles from public.stockflow_members where email=v_email and status='active';
  if p_action='send_on_challan' then
    v_allowed:=array['administrator','operations'];
  else
    select allowed_roles into v_allowed from private.stockflow_order_transition_rules
    where from_status='awaiting_tally_billing' and to_status='billed_in_tally';
  end if;
  if not private.stockflow_valid_roles(v_roles) or not coalesce(v_roles && v_allowed,false) then
    raise exception 'Role cannot perform this challan action' using errcode='42501';
  end if;
  begin
    v_id:=(p_payload->>'orderId')::uuid;
    v_version:=(p_payload->>'expectedVersion')::integer;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Valid order ID and version required' using errcode='22023';
  end;
  if v_id is null or v_version is null then
    raise exception 'Order ID and expected version required' using errcode='22023';
  end if;
  perform private.assert_stockflow_order_access(v_email,v_roles,v_id);
  v_result:=private.begin_stockflow_command(v_email,p_action,v_key,p_payload);
  if v_result is not null then return v_result; end if;
  if (select count(*) from private.stockflow_request_log
      where actor_email=v_email and created_at>=now()-interval '1 minute')>=30 then
    raise exception 'Too many order requests' using errcode='54000';
  end if;
  insert into private.stockflow_request_log(actor_email,action) values(v_email,p_action);
  select * into v_order from private.stockflow_orders where id=v_id for update;
  if not found or v_order.archived_at is not null then
    raise exception 'Active order required' using errcode='22023';
  end if;
  if v_order.version is distinct from v_version then
    raise exception 'Order has changed; refresh before trying again' using errcode='PT409';
  end if;
  if p_action='send_on_challan' then
    v_number:=nullif(btrim(coalesce(p_payload->>'challanNumber','')),'');
    if v_number is null or char_length(v_number)>40 then
      raise exception 'Tally challan number must contain 1 to 40 characters' using errcode='22023';
    end if;
    if v_order.status<>'packed' or v_order.pricing_state<>'approved'
       or v_order.challan_number is not null or v_order.tally_invoice_number is not null then
      raise exception 'A packed order with approved pricing is required' using errcode='22023';
    end if;
    -- The existing pricing-evidence trigger still runs. No generic transition bypass is added.
    update private.stockflow_orders set challan_number=v_number,challan_at=now(),
      status='ready_for_dispatch',version=version+1,updated_at=now(),updated_by_email=v_email
    where id=v_id;
    insert into private.stockflow_order_events(order_id,event_type,from_status,to_status,actor_email,actor_role,metadata)
    values(v_id,'sent_on_challan',v_order.status,'ready_for_dispatch',v_email,v_role,
      jsonb_build_object('challanNumber',v_number,'requestId',v_key,'assignedRoles',v_roles));
  else
    if v_order.challan_number is null or v_order.tally_invoice_number is not null
       or v_order.status not in ('ready_for_dispatch','dispatched','delivered') then
      raise exception 'An unbilled dispatched or dispatch-ready challan is required' using errcode='22023';
    end if;
    v_number:=nullif(btrim(coalesce(p_payload->>'invoiceNumber','')),'');
    -- Reuse the normal billing rule (including any-role permission and required invoice).
    perform private.assert_stockflow_order_transition(v_roles,'awaiting_tally_billing','billed_in_tally',null,v_number);
    if v_number is null then raise exception 'Tally invoice number required' using errcode='22023'; end if;
    -- Same column, bounded split-reference constraint and invoice-link trigger as transition_order.
    -- There is no separate invoice financial-year column; the full voucher reference is retained.
    update private.stockflow_orders set tally_invoice_number=v_number,challan_billed_at=now(),
      version=version+1,updated_at=now(),updated_by_email=v_email where id=v_id;
    insert into private.stockflow_order_events(order_id,event_type,from_status,to_status,actor_email,actor_role,metadata)
    values(v_id,'challan_billed',v_order.status,v_order.status,v_email,v_role,
      jsonb_build_object('tallyInvoiceNumber',v_number,'requestId',v_key,'assignedRoles',v_roles));
  end if;
  v_result:=jsonb_build_object('ok',true,'orderId',v_id,'version',v_order.version+1,
    'status',case when p_action='send_on_challan' then 'ready_for_dispatch' else v_order.status end);
  perform private.finish_stockflow_command(v_email,p_action,v_key,p_payload,v_id,v_result);
  return v_result;
exception
  when serialization_failure or deadlock_detected or unique_violation then
    -- Restrict translation to the new actions; old commands delegate unchanged.
    if p_action in ('send_on_challan','bill_challan') then
      raise exception 'Order or invoice has changed; refresh before trying again' using errcode='PT409';
    end if;
    raise;
  when check_violation then
    if p_action in ('send_on_challan','bill_challan') then
      raise exception 'Invalid challan or Tally invoice reference' using errcode='22023';
    end if;
    raise;
end $$;
revoke all on function public.stockflow_order_gateway_before_challan(text,text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.stockflow_order_gateway(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.stockflow_order_gateway(text,text,text,jsonb) to service_role;

-- Each replacement must match once; fail deployment if the live definition has drifted.
do $migration$
declare f text; pair text[]; signature text;
begin
  f:=pg_get_functiondef('private.enforce_stockflow_order_status_transition()'::regprocedure);
  pair:=array[$a$if new.status is distinct from old.status and not exists ($a$,
    $a$if old.status='packed' and new.status='ready_for_dispatch'
     and old.challan_number is null and new.challan_number is not null
     and new.challan_at is not null and new.pricing_state='approved'
     and new.tally_invoice_number is null and new.archived_at is null then
    return new;
  end if;
  if new.status is distinct from old.status and not exists ($a$];
  if (length(f)-length(replace(f,pair[1],'')))/length(pair[1])<>1 then raise exception 'Challan transition trigger anchor changed'; end if;
  execute replace(f,pair[1],pair[2]);

  f:=pg_get_functiondef('private.stockflow_order_matches_filter(private.stockflow_orders,text,text,date)'::regprocedure);
  pair:=array[$a$when 'all' then true$a$,
    $a$when 'challan_unbilled' then p_order.challan_number is not null and p_order.tally_invoice_number is null and p_order.status<>'cancelled'
    when 'all' then true$a$];
  if (length(f)-length(replace(f,pair[1],'')))/length(pair[1])<>1 then raise exception 'Challan filter anchor changed'; end if;
  execute replace(f,pair[1],pair[2]);

  f:=pg_get_functiondef('public.stockflow_order_list_gateway(text,text,text,jsonb)'::regprocedure);
  foreach pair slice 1 in array array[
    array[$a$if v_status not in ($a$,$a$if v_status not in ('challan_unbilled',$a$],
    array[$a$'tallyInvoiceNumber',o.tally_invoice_number,$a$,
      $a$'tallyInvoiceNumber',o.tally_invoice_number,
      'challanNumber',o.challan_number,'challanAt',o.challan_at,'challanBilledAt',o.challan_billed_at,
      'challanOverdue',coalesce(o.challan_number is not null and o.tally_invoice_number is null
        and date_trunc('month',o.challan_at at time zone 'Asia/Kolkata')<date_trunc('month',now() at time zone 'Asia/Kolkata'),false),$a$]
  ] loop
    if (length(f)-length(replace(f,pair[1],'')))/length(pair[1])<>1 then raise exception 'Challan list anchor changed: %',pair[1]; end if;
    f:=replace(f,pair[1],pair[2]);
  end loop;
  execute f;

  foreach signature in array array['private.stockflow_operations_summary(text,text)',
    'private.stockflow_operations_summary(text,text[])'] loop
    f:=pg_get_functiondef(signature::regprocedure);
    pair:=array[$a$'phoneOrdersToday', counts.phone_orders_today,$a$,
      $a$'challanUnbilled',(select count(*) from accessible o where o.challan_number is not null and o.tally_invoice_number is null and o.status<>'cancelled'),
    'challanOverdue',(select count(*) from accessible o where o.challan_number is not null and o.tally_invoice_number is null and o.status<>'cancelled'
      and date_trunc('month',o.challan_at at time zone 'Asia/Kolkata')<date_trunc('month',now() at time zone 'Asia/Kolkata')),
    'phoneOrdersToday', counts.phone_orders_today,$a$];
    if (length(f)-length(replace(f,pair[1],'')))/length(pair[1])<>1 then raise exception 'Challan summary anchor changed: %',signature; end if;
    execute replace(f,pair[1],pair[2]);
  end loop;
end $migration$;

notify pgrst,'reload schema';
commit;
