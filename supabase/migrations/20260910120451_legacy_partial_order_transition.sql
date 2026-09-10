insert into private.stockflow_order_transition_rules(
  from_status, to_status, allowed_roles, requires_reason, requires_tally_invoice
) values (
  'partially_reserved', 'packed', array['administrator','operations','warehouse'], false, false
);
