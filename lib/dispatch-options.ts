/** Local delivery by our own staff: no courier or docket, recorded with fixed, readable values. */
export const LOCAL_DELIVERY = { courierName: 'Local delivery', trackingNumber: 'Hand delivery' } as const;

/** Couriers offered for outstation dispatch; "Other" lets staff type any name. */
export const OUTSTATION_COURIERS = ['DTDC', 'Professional Couriers', 'Shree Maruti Courier', 'Blue Dart', 'Delhivery', 'ST Courier', 'Trackon', 'India Post', 'VRL Logistics'] as const;

export type DispatchMode = 'local' | 'outstation';

export function isLocalDelivery(order: { courierName?: string | null }) {
  return order.courierName === LOCAL_DELIVERY.courierName;
}

/** Today's date in India (YYYY-MM-DD), so a dispatch just after midnight IST gets the right day. */
export function istToday(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

/** Courier dropdown choices: the known list, plus this order's existing courier if it is not on it. */
export function courierChoices(current?: string | null) {
  const name = current?.trim();
  return name && name !== LOCAL_DELIVERY.courierName && !OUTSTATION_COURIERS.includes(name as never) ? [...OUTSTATION_COURIERS, name] : [...OUTSTATION_COURIERS];
}

/** Who received a one-tap delivery: the customer, as recorded on the order (2–160 characters). */
export function defaultReceiver(order: { customerName?: string | null }) {
  const name = (order.customerName ?? '').trim().slice(0, 160);
  return name.length >= 2 ? name : 'Customer';
}
