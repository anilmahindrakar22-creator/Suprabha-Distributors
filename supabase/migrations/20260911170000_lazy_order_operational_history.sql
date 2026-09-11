create or replace function public.stockflow_order_detail_gateway(
  p_gateway_key text, p_actor_email text, p_action text, p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_email text := lower(btrim(coalesce(p_actor_email,'')));
  v_role text;
  v_hash text;
  v_order_id uuid;
begin
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex') <> v_hash then raise exception 'Unauthorized gateway' using errcode='42501'; end if;
  if p_action <> 'get_order_details' then raise exception 'Unsupported order detail action' using errcode='22023'; end if;
  select role into v_role from public.stockflow_members where email=v_email and status='active';
  if v_role is null then raise exception 'Account is not approved' using errcode='42501'; end if;
  begin v_order_id := (p_payload->>'orderId')::uuid;
  exception when invalid_text_representation then raise exception 'Valid order ID is required' using errcode='22023'; end;
  if v_order_id is null or not exists(select 1 from private.stockflow_orders where id=v_order_id and archived_at is null) then raise exception 'Order was not found' using errcode='22023'; end if;
  perform private.assert_stockflow_order_access(v_email,v_role,v_order_id);

  return jsonb_build_object(
    'exceptions',coalesce((select jsonb_agg(jsonb_build_object(
      'id',i.id,'category',i.category,'status',i.status,'summary',i.summary,'ownerEmail',i.owner_email,
      'resolution',i.resolution,'createdBy',i.created_by_email,'resolvedBy',i.resolved_by_email,
      'createdAt',i.created_at,'resolvedAt',i.resolved_at
    ) order by i.created_at,i.id) from private.stockflow_delivery_exceptions i where i.order_id=v_order_id),'[]'::jsonb),
    'installations',coalesce((select jsonb_agg(jsonb_build_object(
      'id',i.id,'tallyKey',i.tally_key,'itemName',i.item_name,'status',i.status,'scheduledDate',i.scheduled_date,
      'engineerEmail',i.engineer_email,'siteContact',i.site_contact,'serialNumber',i.serial_number,
      'commissioningNotes',i.commissioning_notes,'createdBy',i.created_by_email,'createdAt',i.created_at,
      'completedBy',i.completed_by_email,'completedAt',i.completed_at
    ) order by i.scheduled_date,i.id) from private.stockflow_equipment_installations i where i.order_id=v_order_id),'[]'::jsonb)
  );
end;
$$;

revoke all on function public.stockflow_order_detail_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_order_detail_gateway(text,text,text,jsonb) to service_role;

do $migration$
declare f text; updated text;
begin
  select pg_get_functiondef('public.stockflow_order_list_gateway(text,text,text,jsonb)'::regprocedure) into f;
  updated := replace(f,
    'from private.stockflow_delivery_exceptions i where i.order_id=o.id)',
    $$from private.stockflow_delivery_exceptions i where i.order_id=o.id and i.status='open')$$);
  if updated=f then raise exception 'Expected list exception projection was not found'; end if;
  f := updated;
  updated := replace(f,
    'from private.stockflow_equipment_installations i where i.order_id=o.id)',
    $$from private.stockflow_equipment_installations i where i.order_id=o.id and i.status='scheduled')$$);
  if updated=f then raise exception 'Expected list installation projection was not found'; end if;
  execute updated;
end $migration$;

revoke all on function public.stockflow_order_list_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_order_list_gateway(text,text,text,jsonb) to service_role;
