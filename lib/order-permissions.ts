import { hasAnyStockFlowRole } from './user-types';

// Mirrors supabase/migrations/20261029090000_challan_delivery.sql.
export const CHALLAN_SEND_ROLES = ['administrator', 'operations'] as const;
// Mirrors supabase/migrations/20261029090000_challan_delivery.sql.
export const CHALLAN_BILL_ROLES = ['administrator', 'operations', 'accounts', 'billing'] as const;

// Mirrors supabase/migrations/20261029090000_challan_delivery.sql.
export function canSendOnChallan(roles: unknown): boolean {
  return hasAnyStockFlowRole(roles, CHALLAN_SEND_ROLES);
}

// Mirrors supabase/migrations/20261029090000_challan_delivery.sql.
export function canBillChallan(roles: unknown): boolean {
  return hasAnyStockFlowRole(roles, CHALLAN_BILL_ROLES);
}

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

// Mirrors supabase/migrations/20260902110000_delivery_exceptions.sql:18;
// combined-role matching: supabase/migrations/20261004073444_combined_role_operational_gateways.sql:24-25.
export const DELIVERY_EXCEPTION_ROLES = ['administrator', 'operations', 'sales', 'warehouse', 'management'] as const;

// Mirrors supabase/migrations/20260902113000_equipment_installations.sql:39;
// combined-role matching: supabase/migrations/20261004073444_combined_role_operational_gateways.sql:24-25.
export const INSTALLATION_ROLES = ['administrator', 'operations', 'sales', 'warehouse', 'management'] as const;

export function canManageDeliveryExceptions(roles: unknown): boolean {
  return hasAnyStockFlowRole(roles, DELIVERY_EXCEPTION_ROLES);
}

export function canManageInstallations(roles: unknown): boolean {
  return hasAnyStockFlowRole(roles, INSTALLATION_ROLES);
}

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
