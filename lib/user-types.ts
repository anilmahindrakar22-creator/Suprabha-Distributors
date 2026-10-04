export const stockFlowRoles = ['administrator', 'sales', 'operations', 'warehouse', 'accounts', 'management', 'viewer'] as const;
export const stockFlowUserStatuses = ['active', 'suspended'] as const;
export type StockFlowRole = typeof stockFlowRoles[number];

// Strict role-set boundary. Invalid assignments fail closed; never silently
// discard an unknown role or infer a more privileged replacement role.
export function normalizeStockFlowRoles(value: unknown): StockFlowRole[] | null {
  const roles = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(roles) || roles.length === 0 || roles.length > stockFlowRoles.length ||
    roles.some(role => typeof role !== 'string' || !stockFlowRoles.includes(role as StockFlowRole)) ||
    new Set(roles).size !== roles.length) return null;
  return stockFlowRoles.filter(role => roles.includes(role));
}

export function hasAnyStockFlowRole(assigned: unknown, allowed: readonly StockFlowRole[]): boolean {
  const roles = normalizeStockFlowRoles(assigned);
  return roles !== null && roles.some(role => allowed.includes(role));
}

export type UserMutation = {
  idempotencyKey: string;
  email: string;
  role: typeof stockFlowRoles[number];
  status: typeof stockFlowUserStatuses[number];
};

export function validateUserMutation(value: unknown): UserMutation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (
    typeof payload.idempotencyKey !== 'string' || payload.idempotencyKey.length < 16 || payload.idempotencyKey.length > 200 ||
    typeof payload.email !== 'string' || payload.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email) ||
    typeof payload.role !== 'string' || !stockFlowRoles.includes(payload.role as UserMutation['role']) ||
    typeof payload.status !== 'string' || !stockFlowUserStatuses.includes(payload.status as UserMutation['status'])
  ) return null;
  return payload as UserMutation;
}
