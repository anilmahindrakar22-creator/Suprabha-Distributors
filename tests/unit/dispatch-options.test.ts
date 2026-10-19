import { describe, expect, it } from 'vitest';
import { courierChoices, isLocalDelivery, istToday, LOCAL_DELIVERY, OUTSTATION_COURIERS } from '@/lib/dispatch-options';
import { validateOrderCommand } from '@/lib/order-types';

describe('dispatch options', () => {
  it('uses the India date, not UTC, just after midnight IST', () => {
    expect(istToday(new Date('2026-10-19T19:00:00Z'))).toBe('2026-10-20');
    expect(istToday(new Date('2026-10-19T18:00:00Z'))).toBe('2026-10-19');
  });
  it('recognises local delivery and keeps an unknown existing courier in the list', () => {
    expect(isLocalDelivery({ courierName: 'Local delivery' })).toBe(true);
    expect(isLocalDelivery({ courierName: 'DTDC' })).toBe(false);
    expect(courierChoices('Anjani Courier')).toEqual([...OUTSTATION_COURIERS, 'Anjani Courier']);
    expect(courierChoices('DTDC')).toEqual([...OUTSTATION_COURIERS]);
    expect(courierChoices(LOCAL_DELIVERY.courierName)).toEqual([...OUTSTATION_COURIERS]);
  });
  it('produces a local dispatch command the server validation accepts', () => {
    const command = { action: 'save_dispatch', payload: { orderId: '7c9e6679-7425-40de-944b-e07fc1f90ae7', expectedVersion: 3, ...LOCAL_DELIVERY, dispatchDate: '2026-10-19', vehicleNumber: '', idempotencyKey: 'test-idempotency-key-0001' } }; // runCommand adds the key
    expect(validateOrderCommand(command)).not.toBeNull();
  });
});
