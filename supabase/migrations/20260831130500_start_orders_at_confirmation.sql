alter table private.stockflow_orders
alter column status set default 'awaiting_confirmation';

comment on column private.stockflow_orders.status is
  'Operational state. New orders start at awaiting_confirmation to avoid a redundant send-for-confirmation step.';
