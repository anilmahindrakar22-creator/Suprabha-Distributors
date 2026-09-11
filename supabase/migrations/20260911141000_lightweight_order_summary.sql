create or replace function public.stockflow_order_summary_gateway(
  p_gateway_key text, p_actor_email text, p_action text, p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_actor_email,'')));
  v_role text;
  v_hash text;
  v_business_date date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select secret_sha256 into v_hash from private.stockflow_gateway_config where name='orders';
  if v_hash is null or encode(extensions.digest(coalesce(p_gateway_key,''),'sha256'),'hex') <> v_hash then
    raise exception 'Unauthorized gateway' using errcode='42501';
  end if;
  if p_action <> 'get_order_summary' then raise exception 'Unsupported order summary action' using errcode='22023'; end if;
  select role into v_role from public.stockflow_members where email=v_email and status='active';
  if v_role is null then raise exception 'Account is not approved' using errcode='42501'; end if;

  return jsonb_build_object(
    'operations', private.stockflow_operations_summary(v_email,v_role) || jsonb_build_object(
      'delayedFailedDeliveries', (
        select count(*) from private.stockflow_orders o
        where o.archived_at is null
          and private.stockflow_can_access_order(v_email,v_role,o.id)
          and o.status not in ('delivered','cancelled')
          and (
            o.expected_delivery_date < current_date
            or exists(
              select 1 from private.stockflow_delivery_exceptions issue
              where issue.order_id=o.id and issue.status='open' and issue.category in ('delayed','failed_delivery')
            )
          )
      )
    ),
    'operationsDate', to_char(v_business_date,'YYYY-MM-DD')
  );
end;
$$;

revoke all on function public.stockflow_order_summary_gateway(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.stockflow_order_summary_gateway(text,text,text,jsonb) to service_role;
