import { describe, expect, it } from 'vitest';
import { nextStepFor, nextStatus } from '../../lib/order-next-step';
import type { OrderSummary } from '../../lib/order-types';
import type { OrderPricingWorkspace } from '../../lib/pricing-types';

const order = (status: string, pricingState: OrderSummary['pricingState'] = 'review_required') => ({ status, pricingState } as OrderSummary);
const pricing = (overrides: Partial<OrderPricingWorkspace> = {}) => ({
  lines: [{ governed: false, proposedRate: null, guardrail: 'PRICE_REVIEW_REQUIRED' }], exceptions: [],
  ...overrides,
} as OrderPricingWorkspace);
const pending = () => pricing({ exceptions: [{ id: 'exception', enteredRate: 404.66, version: 7 } as OrderPricingWorkspace['exceptions'][number]] });

describe('nextStepFor', () => {
  it('confirms an order with the existing transition', () => {
    expect(nextStepFor(order('awaiting_confirmation'), ['administrator'], null)).toMatchObject({ kind: 'advance', label: 'Confirm order' });
    expect(nextStatus.packed.status).toBe('awaiting_tally_billing');
  });
  it('sends packed orders with approved pricing to billing', () => {
    expect(nextStepFor(order('packed', 'approved'), ['administrator'], null)).toMatchObject({ kind: 'advance', label: 'Send to Tally billing' });
  });
  it('applies ready governed prices', () => {
    const ready = pricing({ lines: [{ governed: true, proposedRate: 404.66, guardrail: 'PRICE_OK' } as OrderPricingWorkspace['lines'][number]] });
    expect(nextStepFor(order('packed'), ['accounts'], ready).kind).toBe('pricing_apply');
  });
  it('requests a missing rate', () => {
    expect(nextStepFor(order('packed'), ['administrator'], pricing()).kind).toBe('pricing_enter');
  });
  it('offers administrators the pending exception with its version', () => {
    expect(nextStepFor(order('packed'), ['administrator'], pending())).toMatchObject({ kind: 'pricing_approve', label: 'Approve ₹404.66', exception: { version: 7 } });
  });
  it('tells sales and billing who the price waits for, without showing any amount', () => {
    for (const roles of [['sales'], ['billing'], ['warehouse']]) {
      expect(nextStepFor({ ...order('packed'), pricingState: 'approval_required' }, roles, pending())).toEqual({ kind: 'pricing_waiting', label: 'Waiting for management to approve the price' });
      expect(nextStepFor({ ...order('packed'), pricingState: 'review_required' }, roles, null)).toEqual({ kind: 'pricing_waiting', label: 'Waiting for a price to be entered' });
    }
  });
  it('offers dispatch to operations', () => {
    expect(nextStepFor(order('ready_for_dispatch'), ['operations'], null).kind).toBe('dispatch');
  });
  it('tells sales dispatch is waiting for operations', () => {
    expect(nextStepFor(order('ready_for_dispatch'), ['sales'], null)).toMatchObject({ kind: 'waiting', label: 'Next: Dispatch order · waiting for Operations' });
  });
  it('offers delivery confirmation', () => {
    expect(nextStepFor(order('dispatched'), ['operations'], null).kind).toBe('deliver');
  });
  it('shows the delivery receipt', () => {
    expect(nextStepFor({ ...order('delivered'), receivedBy: 'Dr Rao', deliveredAt: '2026-10-18T12:00:00Z' }, ['sales'], null)).toMatchObject({ kind: 'done', label: expect.stringContaining('Delivered · received by Dr Rao on') });
  });
  it('has no step for cancelled orders', () => {
    expect(nextStepFor(order('cancelled'), ['administrator'], null).kind).toBe('none');
  });
  it('waits for pricing evidence before offering a pricing action', () => {
    expect(nextStepFor(order('packed'), ['administrator'], null)).toMatchObject({ kind: 'loading', label: 'Checking price…' });
  });
  it('preserves transition role checks and multi-role access', () => {
    expect(nextStepFor(order('packed', 'approved'), ['sales'], null).kind).toBe('waiting');
    expect(nextStepFor(order('ready_for_dispatch'), ['sales', 'operations'], null).kind).toBe('dispatch');
    expect(nextStepFor(order('packed'), ['sales'], pricing()).label).toBe('Waiting for a price to be entered');
    expect(nextStepFor(order('packed'), ['management'], pending()).kind).toBe('pricing_approve');
  });
});
