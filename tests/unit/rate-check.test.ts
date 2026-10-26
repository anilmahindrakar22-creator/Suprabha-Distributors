import { describe, expect, it } from 'vitest';
import { rateCheckSummary, rateLineLabel, type RateCheck, type RateCheckLine } from '@/lib/rate-check';

const check: RateCheck = { view: 'rate_check', orderId: 'o', orderNumber: 'SO/1', customerName: 'Hospital', status: 'billed_in_tally', tolerance: 1, state: 'matches', lines: [] };
const line: RateCheckLine = { lineId: 'l1', tallyKey: 'ITEM', itemName: 'Item', approvedRate: 4450, invoiceRates: [4448.5], difference: -1.5, state: 'different' };

describe('rateCheckSummary', () => {
  it.each([
    ['matches', undefined, 'Tally rates match the approved price (within ₹1)'],
    ['different', 1, '1 item differs from the approved price'],
    ['different', 2, '2 items differ from the approved price'],
    ['different', undefined, '0 items differ from the approved price'],
    ['waiting_for_tally', undefined, 'Waiting for Tally invoice rates to sync'],
    ['no_approved_price', undefined, 'No approved price to compare'],
    ['not_billed', undefined, 'Not billed yet'],
  ] as const)('%s (%s)', (state, differentCount, expected) => {
    expect(rateCheckSummary({ ...check, state, differentCount })).toBe(expected);
  });
});

describe('rateLineLabel', () => {
  it.each([
    ['different', -1.5, 'Billed ₹1.5 lower per unit'],
    ['different', 1250.25, 'Billed ₹1,250.25 higher per unit'],
    ['different', 2, 'Billed ₹2 higher per unit'],
    ['different', null, 'Billed ₹0 higher per unit'],
    ['missing_on_invoice', null, 'Not on the Tally invoice'],
    ['not_on_order', null, 'On the Tally invoice but not on the order'],
    ['no_approved_rate', null, 'No approved rate'],
    ['matches', 0, 'Matches'],
  ] as const)('%s (%s)', (state, difference, expected) => {
    expect(rateLineLabel({ ...line, state, difference })).toBe(expected);
  });
});
