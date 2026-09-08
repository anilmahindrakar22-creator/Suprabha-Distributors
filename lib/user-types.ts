export const stockFlowRoles = ['administrator', 'sales', 'operations', 'warehouse', 'accounts', 'management', 'viewer'] as const;
export const stockFlowUserStatuses = ['active', 'suspended'] as const;

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
