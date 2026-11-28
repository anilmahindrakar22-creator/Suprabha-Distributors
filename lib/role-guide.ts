import { canAddOrderNotes, canBillChallan, canCreateOrders, canEditOrders, canManageDeliveryExceptions, canManageInstallations, canManagePurchaseOrders, canRecordFulfilment, canSendOnChallan } from './order-permissions';
import { normalizeStockFlowRoles, type StockFlowRole } from './user-types';
import { stockFlowSurfaces, type Surface } from './stockflow-surfaces';

const roleLabels: Record<StockFlowRole, string> = {
  administrator: 'Administrator', sales: 'Sales', operations: 'Operations', warehouse: 'Warehouse',
  accounts: 'Accounts', billing: 'Billing', management: 'Management', viewer: 'Viewer',
};
const sectionLabels: Record<Surface, string> = {
  today: 'Today', stock: 'Stock', orders: 'Orders', requests: 'Purchase', accounts: 'Accounts',
  pricing: 'Pricing', economics: 'Economics', service: 'Service', users: 'Users', growth: 'Growth',
};

// Built from the same functions that drive navigation and order actions, never a separate table.
export function roleGuide(roles: unknown): { roleNames: string[]; sections: string[]; canDo: string[] } {
  const normalized = normalizeStockFlowRoles(roles) ?? [];
  const surfaces = stockFlowSurfaces(roles);
  const canDo: string[] = [];
  const add = (allowed: boolean, line: string) => { if (allowed) canDo.push(line); };
  add(canCreateOrders(roles), 'Create orders');
  add(canEditOrders(roles), 'Edit orders before they are dispatched');
  add(canRecordFulfilment(roles), 'Pack orders and record packed quantities');
  add(canSendOnChallan(roles), 'Send orders on a delivery challan');
  add(canBillChallan(roles), 'Bill challans and record Tally invoice numbers');
  add(canManageDeliveryExceptions(roles), 'Record delivery problems');
  add(canManageInstallations(roles), 'Schedule and complete installations');
  add(canAddOrderNotes(roles), 'Add notes to orders');
  add(canManagePurchaseOrders(roles), 'Raise purchase orders');
  add(surfaces.includes('economics'), 'See instrument economics');
  add(surfaces.includes('growth'), 'See growth reports');
  add(surfaces.includes('users'), 'Add people and change their roles');
  return { roleNames: normalized.map(role => roleLabels[role]), sections: surfaces.map(item => sectionLabels[item]), canDo };
}
