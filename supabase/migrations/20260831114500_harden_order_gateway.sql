revoke execute on function public.stockflow_order_gateway(text, text, text, jsonb)
from anon, authenticated;

grant execute on function public.stockflow_order_gateway(text, text, text, jsonb)
to service_role;

create index stockflow_reservations_order_idx
on private.stockflow_reservations (order_id);
