import type { OrderBootstrap, OrderCommand, OrderSummary } from './order-types';

type CommandResult = { orderId?: string; status?: string; version?: number };

function patchedOrder(order: OrderSummary, command: OrderCommand, result: CommandResult, updatedAt: string): OrderSummary | null {
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
  return null;
}

export function applyOrderAcknowledgement(data: OrderBootstrap, command: OrderCommand, result: CommandResult, updatedAt = new Date().toISOString()): OrderBootstrap | null {
  let changed = false;
  const orders = data.orders.map((order) => {
    const next = patchedOrder(order, command, result, updatedAt);
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
