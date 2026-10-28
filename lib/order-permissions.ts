import { hasAnyStockFlowRole } from './user-types';

// Mirrors supabase/migrations/20260902091533_centralize_order_policy.sql:26-31.
export const ORDER_CREATE_ROLES = ['administrator', 'sales', 'operations', 'management'] as const;

// Mirrors supabase/migrations/20260902080651_harden_business_history.sql:48;
// combined-role matching: supabase/migrations/20261004073444_combined_role_operational_gateways.sql:24-25.
export const ORDER_EDIT_ROLES = ['administrator', 'sales', 'operations', 'management'] as const;

// Mirrors supabase/migrations/20260901143000_fulfilment_details.sql:23;
// combined-role matching: supabase/migrations/20261004073444_combined_role_operational_gateways.sql:24-25.
export const ORDER_FULFIL_ROLES = ['administrator', 'sales', 'operations', 'warehouse', 'accounts', 'management'] as const;

// Mirrors supabase/migrations/20261025090000_billing_role.sql:64 (order-note gateway role patch).
export const ORDER_NOTE_ROLES = ['administrator', 'sales', 'operations', 'warehouse', 'accounts', 'management', 'billing'] as const;

export function canAddOrderNotes(roles: unknown): boolean {
  return hasAnyStockFlowRole(roles, ORDER_NOTE_ROLES);
}

export function canCreateOrders(roles: unknown): boolean {
  return hasAnyStockFlowRole(roles, ORDER_CREATE_ROLES);
}

export function canEditOrders(roles: unknown): boolean {
  return hasAnyStockFlowRole(roles, ORDER_EDIT_ROLES);
}

export function canRecordFulfilment(roles: unknown): boolean {
  return hasAnyStockFlowRole(roles, ORDER_FULFIL_ROLES);
}
