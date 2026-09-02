alter table private.stockflow_member_events
add column request_id text check (request_id is null or char_length(request_id) >= 16);

do $$
declare
  f text;
begin
  select pg_get_functiondef('public.stockflow_fulfilment_gateway(text,text,text,jsonb)'::regprocedure) into f;
  if position('v_count integer := 0;' in f) = 0
     or position('  select * into v_order from private.stockflow_orders' in f) = 0
     or position($old$return jsonb_build_object('ok',true,'orderId',v_order.id,'version',v_order.version + 1);$old$ in f) = 0 then
    raise exception 'Expected fulfilment gateway blocks were not found';
  end if;
  f := replace(f, 'v_count integer := 0;', $new$v_count integer := 0;
  v_idempotency_key text; v_replayed_result jsonb; v_command_result jsonb;$new$);
  f := replace(f,
    '  select * into v_order from private.stockflow_orders',
    $new$  v_idempotency_key := p_payload->>'idempotencyKey';
  v_replayed_result := private.begin_stockflow_command(v_email,p_action,v_idempotency_key,p_payload);
  if v_replayed_result is not null then return v_replayed_result; end if;
  select * into v_order from private.stockflow_orders$new$);
  f := replace(f, $old$jsonb_build_object('linesUpdated',v_count)$old$,
    $new$jsonb_build_object('linesUpdated',v_count,'requestId',v_idempotency_key)$new$);
  f := replace(f,
    $old$return jsonb_build_object('ok',true,'orderId',v_order.id,'version',v_order.version + 1);$old$,
    $new$v_command_result := jsonb_build_object('ok',true,'orderId',v_order.id,'version',v_order.version + 1);
  perform private.finish_stockflow_command(v_email,p_action,v_idempotency_key,p_payload,v_order.id,v_command_result);
  return v_command_result;$new$);
  execute f;
end;
$$;

do $$
declare
  f text;
begin
  select pg_get_functiondef('public.stockflow_edit_gateway(text,text,text,jsonb)'::regprocedure) into f;
  if position('v_before jsonb; v_after jsonb;' in f) = 0
     or position('  select * into v_order from private.stockflow_orders' in f) = 0
     or position($old$return jsonb_build_object('ok',true,'orderId',v_order.id,'version',v_order.version+1);$old$ in f) = 0 then
    raise exception 'Expected edit gateway blocks were not found';
  end if;
  f := replace(f, 'v_before jsonb; v_after jsonb;', $new$v_before jsonb; v_after jsonb;
  v_idempotency_key text; v_replayed_result jsonb; v_command_result jsonb;$new$);
  f := replace(f,
    '  select * into v_order from private.stockflow_orders',
    $new$  v_idempotency_key := p_payload->>'idempotencyKey';
  v_replayed_result := private.begin_stockflow_command(v_email,p_action,v_idempotency_key,p_payload);
  if v_replayed_result is not null then return v_replayed_result; end if;
  select * into v_order from private.stockflow_orders$new$);
  f := replace(f,
    $old$jsonb_build_object('before',v_before,'after',v_after)$old$,
    $new$jsonb_build_object('before',v_before,'after',v_after,'requestId',v_idempotency_key)$new$);
  f := replace(f,
    $old$return jsonb_build_object('ok',true,'orderId',v_order.id,'version',v_order.version+1);$old$,
    $new$v_command_result := jsonb_build_object('ok',true,'orderId',v_order.id,'version',v_order.version+1);
  perform private.finish_stockflow_command(v_email,p_action,v_idempotency_key,p_payload,v_order.id,v_command_result);
  return v_command_result;$new$);
  execute f;
end;
$$;

do $$
declare
  f text;
begin
  select pg_get_functiondef('public.stockflow_exception_gateway(text,text,text,jsonb)'::regprocedure) into f;
  if position('v_category text; v_summary text; v_owner text; v_resolution text;' in f) = 0
     or position('  select * into v_order from private.stockflow_orders' in f) = 0
     or position($old$return jsonb_build_object('ok',true,'orderId',v_order.id,'exceptionId',v_exception.id,'version',v_order.version+1);$old$ in f) = 0 then
    raise exception 'Expected exception gateway blocks were not found';
  end if;
  f := replace(f, 'v_category text; v_summary text; v_owner text; v_resolution text;',
    $new$v_category text; v_summary text; v_owner text; v_resolution text;
  v_idempotency_key text; v_replayed_result jsonb; v_command_result jsonb;$new$);
  f := replace(f,
    '  select * into v_order from private.stockflow_orders',
    $new$  v_idempotency_key := p_payload->>'idempotencyKey';
  v_replayed_result := private.begin_stockflow_command(v_email,p_action,v_idempotency_key,p_payload);
  if v_replayed_result is not null then return v_replayed_result; end if;
  select * into v_order from private.stockflow_orders$new$);
  f := replace(f, $old$'ownerEmail',v_owner)$old$, $new$'ownerEmail',v_owner,'requestId',v_idempotency_key)$new$);
  f := replace(f, $old$'category',v_exception.category)$old$, $new$'category',v_exception.category,'requestId',v_idempotency_key)$new$);
  f := replace(f,
    $old$return jsonb_build_object('ok',true,'orderId',v_order.id,'exceptionId',v_exception.id,'version',v_order.version+1);$old$,
    $new$v_command_result := jsonb_build_object('ok',true,'orderId',v_order.id,'exceptionId',v_exception.id,'version',v_order.version+1);
  perform private.finish_stockflow_command(v_email,p_action,v_idempotency_key,p_payload,v_order.id,v_command_result);
  return v_command_result;$new$);
  execute f;
end;
$$;

do $$
declare
  f text;
begin
  select pg_get_functiondef('public.stockflow_installation_gateway(text,text,text,jsonb)'::regprocedure) into f;
  if position('v_line private.stockflow_order_lines%rowtype; v_engineer text; v_site text; v_serial text; v_notes text;' in f) = 0
     or position('  select * into v_order from private.stockflow_orders' in f) = 0
     or position($old$return jsonb_build_object('ok',true,'orderId',v_order.id,'installationId',v_installation.id,'version',v_order.version+1);$old$ in f) = 0 then
    raise exception 'Expected installation gateway blocks were not found';
  end if;
  f := replace(f,
    'v_line private.stockflow_order_lines%rowtype; v_engineer text; v_site text; v_serial text; v_notes text;',
    $new$v_line private.stockflow_order_lines%rowtype; v_engineer text; v_site text; v_serial text; v_notes text;
  v_idempotency_key text; v_replayed_result jsonb; v_command_result jsonb;$new$);
  f := replace(f,
    '  select * into v_order from private.stockflow_orders',
    $new$  v_idempotency_key := p_payload->>'idempotencyKey';
  v_replayed_result := private.begin_stockflow_command(v_email,p_action,v_idempotency_key,p_payload);
  if v_replayed_result is not null then return v_replayed_result; end if;
  select * into v_order from private.stockflow_orders$new$);
  f := replace(f, $old$'engineerEmail',v_engineer)$old$, $new$'engineerEmail',v_engineer,'requestId',v_idempotency_key)$new$);
  f := replace(f, $old$'serialNumber',v_serial)$old$, $new$'serialNumber',v_serial,'requestId',v_idempotency_key)$new$);
  f := replace(f,
    $old$return jsonb_build_object('ok',true,'orderId',v_order.id,'installationId',v_installation.id,'version',v_order.version+1);$old$,
    $new$v_command_result := jsonb_build_object('ok',true,'orderId',v_order.id,'installationId',v_installation.id,'version',v_order.version+1);
  perform private.finish_stockflow_command(v_email,p_action,v_idempotency_key,p_payload,v_order.id,v_command_result);
  return v_command_result;$new$);
  execute f;
end;
$$;

do $$
declare
  f text;
begin
  select pg_get_functiondef('public.stockflow_user_gateway(text,text,text,jsonb)'::regprocedure) into f;
  if position('v_previous public.stockflow_members%rowtype;' in f) = 0
     or position('  v_email := lower' in f) = 0
     or position($old$return jsonb_build_object('ok', true, 'email', v_email, 'role', v_role, 'status', v_status);$old$ in f) = 0 then
    raise exception 'Expected user gateway blocks were not found';
  end if;
  f := replace(f, 'v_previous public.stockflow_members%rowtype;', $new$v_previous public.stockflow_members%rowtype;
  v_idempotency_key text; v_replayed_result jsonb; v_command_result jsonb;$new$);
  f := replace(f,
    '  v_email := lower',
    $new$  v_idempotency_key := p_payload->>'idempotencyKey';
  v_replayed_result := private.begin_stockflow_command(v_actor_email,p_action,v_idempotency_key,p_payload);
  if v_replayed_result is not null then return v_replayed_result; end if;

  v_email := lower$new$);
  f := replace(f,
    $old$member_email, action, previous_role, new_role, previous_status, new_status, actor_email
  )$old$,
    $new$member_email, action, previous_role, new_role, previous_status, new_status, actor_email, request_id
  )$new$);
  f := replace(f,
    $old$v_previous.role, v_role, v_previous.status, v_status, v_actor_email
  );$old$,
    $new$v_previous.role, v_role, v_previous.status, v_status, v_actor_email, v_idempotency_key
  );$new$);
  f := replace(f,
    $old$return jsonb_build_object('ok', true, 'email', v_email, 'role', v_role, 'status', v_status);$old$,
    $new$v_command_result := jsonb_build_object('ok', true, 'email', v_email, 'role', v_role, 'status', v_status);
  perform private.finish_stockflow_command(v_actor_email,p_action,v_idempotency_key,p_payload,null,v_command_result);
  return v_command_result;$new$);
  execute f;
end;
$$;

revoke all on function public.stockflow_fulfilment_gateway(text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.stockflow_edit_gateway(text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.stockflow_exception_gateway(text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.stockflow_installation_gateway(text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.stockflow_user_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_fulfilment_gateway(text,text,text,jsonb) to service_role;
grant execute on function public.stockflow_edit_gateway(text,text,text,jsonb) to service_role;
grant execute on function public.stockflow_exception_gateway(text,text,text,jsonb) to service_role;
grant execute on function public.stockflow_installation_gateway(text,text,text,jsonb) to service_role;
grant execute on function public.stockflow_user_gateway(text,text,text,jsonb) to service_role;
