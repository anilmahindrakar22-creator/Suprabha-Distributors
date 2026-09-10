import type { OrderBootstrap, OrderCommand, OrderSummary } from './order-types';

type CommandResult = { orderId?: string; status?: string; version?: number; exceptionId?: string; installationId?: string };

function patchedOrder(order: OrderSummary, command: OrderCommand, result: CommandResult, actor: OrderBootstrap['actor'], updatedAt: string): OrderSummary | null {
  if (!result.orderId || result.orderId !== order.id || !Number.isInteger(result.version)) return null;
  const base = { ...order, version: Number(result.version), updatedAt };
  if (command.action === 'transition_order') return { ...base, status: result.status || command.payload.toStatus, tallyInvoiceNumber: command.payload.tallyInvoiceNumber || base.tallyInvoiceNumber };
  if (command.action === 'save_fulfilment') return { ...base, deliveryAddress: command.payload.deliveryAddress || null, expectedDeliveryDate: command.payload.expectedDeliveryDate || null, lines: base.lines.map((line) => ({ ...line, fulfilledQuantity: command.payload.lines.find((item) => item.tallyKey === line.tallyKey)?.fulfilledQuantity ?? line.fulfilledQuantity })) };
  if (command.action === 'edit_order') {
    const lines = command.payload.lines.map((item) => {
      const current = base.lines.find((line) => line.tallyKey === item.tallyKey);
      return current ? { ...current, quantity: item.quantity } : null;
    });
    if (lines.some((line) => !line)) return null;
    return { ...base, customerName: command.payload.customerName, customerPhone: command.payload.customerPhone || null, notes: command.payload.notes || null, lines: lines as OrderSummary['lines'], totalQuantity: command.payload.lines.reduce((sum, line) => sum + line.quantity, 0), lineCount: lines.length };
  }
  if (command.action === 'save_dispatch') return { ...base, status: result.status || 'dispatched', courierName: command.payload.courierName, trackingNumber: command.payload.trackingNumber, dispatchDate: command.payload.dispatchDate, vehicleNumber: command.payload.vehicleNumber || null };
  if (command.action === 'confirm_delivery') return { ...base, status: result.status || 'delivered', deliveredAt: command.payload.deliveredAt, receivedBy: command.payload.receivedBy, podReference: command.payload.podReference || null };
  if (command.action === 'set_order_priority') return { ...base, priority: command.payload.priority };
  if (command.action === 'set_order_assignee') return { ...base, assignedToEmail: command.payload.assignedToEmail || null };
  if (command.action === 'create_exception') {
    if (!result.exceptionId) return null;
    return { ...base, exceptions: [...base.exceptions, { id: result.exceptionId, category: command.payload.category, status: 'open', summary: command.payload.summary, ownerEmail: command.payload.ownerEmail || null, resolution: null, createdBy: actor.email, createdAt: updatedAt, resolvedBy: null, resolvedAt: null }] };
  }
  if (command.action === 'resolve_exception') {
    if (!result.exceptionId || result.exceptionId !== command.payload.exceptionId) return null;
    return { ...base, exceptions: base.exceptions.map((item) => item.id === result.exceptionId ? { ...item, status: 'resolved', resolution: command.payload.resolution, resolvedBy: actor.email, resolvedAt: updatedAt } : item) };
  }
  if (command.action === 'schedule_installation') {
    if (!result.installationId) return null;
    const line = base.lines.find((item) => item.tallyKey === command.payload.tallyKey);
    if (!line) return null;
    return { ...base, installations: [...base.installations, { id: result.installationId, tallyKey: line.tallyKey, itemName: line.itemName, status: 'scheduled', scheduledDate: command.payload.scheduledDate, engineerEmail: command.payload.engineerEmail || null, siteContact: command.payload.siteContact || null, serialNumber: null, commissioningNotes: null, createdBy: actor.email, createdAt: updatedAt, completedBy: null, completedAt: null }] };
  }
  if (command.action === 'complete_installation') {
    if (!result.installationId || result.installationId !== command.payload.installationId) return null;
    return { ...base, installations: base.installations.map((item) => item.id === result.installationId ? { ...item, status: 'completed', serialNumber: command.payload.serialNumber, commissioningNotes: command.payload.commissioningNotes, completedBy: actor.email, completedAt: updatedAt } : item) };
  }
  if (command.action === 'record_billing_review') return base;
  if (command.action === 'add_order_note') return base;
  return null;
}

export function applyOrderAcknowledgement(data: OrderBootstrap, command: OrderCommand, result: CommandResult, updatedAt = new Date().toISOString()): OrderBootstrap | null {
  let changed = false;
  const orders = data.orders.map((order) => {
    const next = patchedOrder(order, command, result, data.actor, updatedAt);
    if (!next) return order;
    changed = true;
    return next;
  });
  if (!changed) return null;
  return {
    ...data,
    orders,
    operations: {
      ...data.operations,
      awaitingConfirmation: orders.filter((order) => order.status === 'awaiting_confirmation').length,
      awaitingTallyBilling: orders.filter((order) => order.status === 'awaiting_tally_billing').length,
    },
  };
}
