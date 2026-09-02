create table private.stockflow_command_results (
  actor_email text not null,
  action text not null,
  idempotency_key text not null check (char_length(idempotency_key) >= 16),
  request_hash text not null,
  aggregate_id uuid,
  result jsonb not null,
  completed_at timestamptz not null default now(),
  primary key (actor_email, action, idempotency_key)
);

alter table private.stockflow_command_results enable row level security;

create trigger stockflow_command_results_no_delete
before delete on private.stockflow_command_results
for each row execute function private.prevent_business_delete();

create or replace function private.begin_stockflow_command(
  p_actor_email text, p_action text, p_idempotency_key text, p_payload jsonb
) returns jsonb
language plpgsql
set search_path = pg_catalog, private, extensions
as $$
declare
  v_request_hash text;
  v_stored_hash text;
  v_stored_result jsonb;
begin
  if char_length(btrim(coalesce(p_idempotency_key, ''))) < 16 then
    raise exception 'A valid idempotency key is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    lower(btrim(p_actor_email)) || ':' || p_action || ':' || p_idempotency_key, 0
  ));
  v_request_hash := encode(extensions.digest(p_payload::text, 'sha256'), 'hex');

  select request_hash, result into v_stored_hash, v_stored_result
  from private.stockflow_command_results
  where actor_email = lower(btrim(p_actor_email))
    and action = p_action
    and idempotency_key = p_idempotency_key;

  if found and v_stored_hash <> v_request_hash then
    raise exception 'Idempotency key was already used for a different request' using errcode = '22023';
  end if;
  return v_stored_result;
end;
$$;

create or replace function private.finish_stockflow_command(
  p_actor_email text, p_action text, p_idempotency_key text,
  p_payload jsonb, p_aggregate_id uuid, p_result jsonb
) returns void
language plpgsql
set search_path = pg_catalog, private, extensions
as $$
begin
  insert into private.stockflow_command_results(
    actor_email, action, idempotency_key, request_hash, aggregate_id, result
  ) values (
    lower(btrim(p_actor_email)), p_action, p_idempotency_key,
    encode(extensions.digest(p_payload::text, 'sha256'), 'hex'), p_aggregate_id, p_result
  );
end;
$$;

revoke all on function private.begin_stockflow_command(text,text,text,jsonb) from public, anon, authenticated;
revoke all on function private.finish_stockflow_command(text,text,text,jsonb,uuid,jsonb) from public, anon, authenticated;

do $$
declare
  f text;
  old_declarations text := $old$  v_invoice text;
begin$old$;
  old_start text := $old$  v_order_id := (p_payload->>'orderId')::uuid;$old$;
  old_metadata text := $old$    case when v_invoice is null then '{}'::jsonb else jsonb_build_object('tallyInvoiceNumber', v_invoice) end$old$;
  old_outbox text := $old$  values ('order.status_changed', v_order_id, jsonb_build_object('from', v_from_status, 'to', v_to_status));
  return jsonb_build_object('ok', true, 'orderId', v_order_id, 'status', v_to_status, 'version', v_order.version + 1);$old$;
begin
  select pg_get_functiondef('public.stockflow_order_gateway(text,text,text,jsonb)'::regprocedure) into f;
  if position(old_declarations in f) = 0
     or position(old_start in f) = 0
     or position(old_metadata in f) = 0
     or position(old_outbox in f) = 0 then
    raise exception 'Expected order transition command blocks were not found';
  end if;

  f := replace(f, old_declarations, $new$  v_invoice text;
  v_idempotency_key text;
  v_replayed_result jsonb;
  v_command_result jsonb;
begin$new$);
  f := replace(f, old_start, $new$  v_idempotency_key := p_payload->>'idempotencyKey';
  v_replayed_result := private.begin_stockflow_command(
    v_actor_email, p_action, v_idempotency_key, p_payload
  );
  if v_replayed_result is not null then
    return v_replayed_result;
  end if;

  v_order_id := (p_payload->>'orderId')::uuid;$new$);
  f := replace(f, old_metadata, $new$    (case when v_invoice is null then '{}'::jsonb else jsonb_build_object('tallyInvoiceNumber', v_invoice) end)
      || jsonb_build_object('requestId', v_idempotency_key)$new$);
  f := replace(f, old_outbox, $new$  values ('order.status_changed', v_order_id, jsonb_build_object(
    'from', v_from_status, 'to', v_to_status, 'requestId', v_idempotency_key
  ));
  v_command_result := jsonb_build_object(
    'ok', true, 'orderId', v_order_id, 'status', v_to_status, 'version', v_order.version + 1
  );
  perform private.finish_stockflow_command(
    v_actor_email, p_action, v_idempotency_key, p_payload, v_order_id, v_command_result
  );
  return v_command_result;$new$);
  execute f;
end;
$$;

revoke all on function public.stockflow_order_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_order_gateway(text,text,text,jsonb) to service_role;
