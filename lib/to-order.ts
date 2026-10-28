export type ToOrderItem = {
  itemKey: string;
  itemName: string;
  group: string | null;
  closing: number | null;
  reorderLevel: number | null;
  minimumOrder: number | null;
  tallyOpenPurchase: number | null;
  openDemand: number;
  waitingOrders: number;
  oldestOrderAt: string | null;
  reasons: ('waiting_orders' | 'below_reorder')[];
  state: 'order' | 'stock_unknown';
  suggestedQty: number | null;
};

export type ToOrderResponse = {
  view: 'to_order';
  page: number;
  pageSize: 25;
  total: number;
  waitingCount: number;
  unknownCount: number;
  items: ToOrderItem[];
};

export function toOrderReasonText(item: ToOrderItem) {
  return item.reasons.map((reason) => reason === 'waiting_orders'
    ? `${item.waitingOrders} customer order${item.waitingOrders === 1 ? '' : 's'} waiting`
    : 'Below reorder level').join(' · ');
}

export function toOrderStockText(item: ToOrderItem) {
  if (item.state === 'stock_unknown') return 'Stock unknown, check Tally';
  return [item.closing === null ? null : `In stock ${item.closing}`,
    item.reorderLevel === null ? null : `reorder level ${item.reorderLevel}`].filter((part) => part !== null).join(' · ');
}
