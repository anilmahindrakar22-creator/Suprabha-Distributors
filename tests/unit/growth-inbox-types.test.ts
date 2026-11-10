import { describe, expect, it } from 'vitest';
import { buildGrowthDecision, growthReasonLine, inboxStake, normalizeGrowthDecision, normalizeGrowthInbox, normalizeGrowthInboxResponse, ruleLever, ruleTitle, type GrowthCard } from '@/lib/growth-inbox-types';

const card: GrowthCard = { cardKey: 'card-a', labKey: 'lab-a', customerId: 'customer-a', name: 'Lab A', town: null, rule: 'R1', ruleVersion: 1, period: '2026-10', stakePaise: 800000, inputs: { monthsBoughtPrev11: 7, lastBoughtOn: '2026-09-12', typicalPaise: 800000 }, alsoMatches: ['R3'], lastReason: null, state: 'review', action: null };
const inbox = () => ({ runMonth: '2026-11', salesTo: '2026-10-31', confirmed: true, confirmedReason: null, counts: { all: 1, R1: 1, R2: 0, R3: 0, R4: 0, R5: 0, toReview: 1, inProgress: 0, done: 0 }, stakeToReviewPaise: 800000, filter: 'all', page: 1, pageSize: 10, total: 1, owners: [{ email: 'manager@example.test' }], rows: [structuredClone(card)] });
const accept = { requestId: '12345678-1234-4123-8123-123456789abc', cardKey: 'card-a', decision: 'accept', actionType: 'visit', ownerEmail: 'manager@example.test', dueOn: '2026-11-16', detail: 'Call the lab' };

describe('Growth inbox responses', () => {
  const price = { ...card, rule: 'R5', alsoMatches: [], inputs: { items: 1, annualGapPaise: 120000, lastBoughtOn: '2026-10-12', lines: [{ itemKey: 'item-a', name: 'CRP', tallyItemKey: 'tally-a', unitPricePaise: 160800, typicalPricePaise: 250000, quantity: 1.5, gapPaise: 120000 }] } };
  it('parses a valid R5 card and its reason with an optional last purchase', () => {
    const result = normalizeGrowthInbox({ ...inbox(), filter: 'R5', rows: [price] });
    expect(result?.rows[0]).toEqual(price);
    expect(growthReasonLine(result!.rows[0] as GrowthCard, '2026-11')).toBe('Pays under 90% of the typical price on 1 item · last bought 12 Oct');
    expect(normalizeGrowthInbox({ ...inbox(), rows: [{ ...price, inputs: { ...price.inputs, lastBoughtOn: null } }] })).not.toBeNull();
  });
  it('rejects bad price lines and any cost or gp input keys', () => {
    for (const inputs of [
      { ...price.inputs, costPaise: 100 }, { ...price.inputs, gpPaise: 100 },
      { ...price.inputs, lines: 'invalid' }, { ...price.inputs, lines: [{ ...price.inputs.lines[0], quantity: -1 }] },
      { ...price.inputs, lines: [{ ...price.inputs.lines[0], typicalPricePaise: NaN }] },
      { ...price.inputs, lines: [{ ...price.inputs.lines[0], costPaise: 10 }] },
      { ...price.inputs, lines: [{ ...price.inputs.lines[0], gpPaise: 10 }] },
      { ...price.inputs, items: 51, lines: Array(51).fill(price.inputs.lines[0]) },
    ]) expect(normalizeGrowthInbox({ ...inbox(), rows: [{ ...price, inputs }] })).toBeNull();
    for (const patch of [{ state: 'in_progress' }, { alsoMatches: ['R1'] }]) expect(normalizeGrowthInbox({ ...inbox(), rows: [{ ...price, ...patch }] })).toBeNull();
    const { R5, ...counts } = inbox().counts;
    expect(normalizeGrowthInbox({ ...inbox(), counts })).toBeNull();
  });
  it('requires viewerEmail only for the client response and strips it from gateway normalization', () => {
    const response = { ...inbox(), viewerEmail: 'manager@example.test' };
    expect(normalizeGrowthInboxResponse(response)).toEqual(response);
    expect(normalizeGrowthInbox(response)).toEqual(inbox());
    expect(normalizeGrowthInboxResponse(inbox())).toBeNull();
    expect(normalizeGrowthInboxResponse({ ...response, viewerEmail: 'invalid' })).toBeNull();
  });
  it('accepts review, unlinked and in-progress cards', () => {
    expect(normalizeGrowthInbox(inbox())).toEqual(inbox());
    const unlinked = inbox(); unlinked.rows[0].customerId = null; unlinked.rows[0].name = null;
    expect(normalizeGrowthInbox(unlinked)).not.toBeNull();
    const progress = { ...inbox(), rows: [{ ...card, state: 'in_progress', action: { id: 'action-a', actionType: 'visit', ownerEmail: 'manager@example.test', dueOn: '2026-11-16' }, lastReason: { category: 'price', source: 'lab_said', on: '2026-10-12' } }] };
    expect(normalizeGrowthInbox(progress)).not.toBeNull();
  });
  it.each([
    { rule: 'R5' }, { state: 'hidden' }, { stakePaise: 1.5 }, { stakePaise: Infinity }, { stakePaise: NaN }, { stakePaise: -1 }, { ruleVersion: 0 }, { period: '2026-13' }, { alsoMatches: ['R9'] }, { state: 'in_progress', action: null },
    { inputs: { monthsBoughtPrev11: 7, lastBoughtOn: '2026-02-30', typicalPaise: 500 } },
    { inputs: { monthsBoughtPrev11: 7, lastBoughtOn: '2026-09-12', typicalPaise: 500.1 } },
    { lastReason: { category: 'one_off', source: 'lab_said', on: '2026-10-12' } },
    { lastReason: { category: 'price', source: 'guessed', on: '2026-10-12' } },
  ])('rejects invalid cards: %j', patch => {
    expect(normalizeGrowthInbox({ ...inbox(), rows: [{ ...card, ...patch }] })).toBeNull();
  });
  it.each([{ page: 0 }, { total: 0.5 }, { stakeToReviewPaise: Infinity }, { pageSize: 20 }, { filter: 'R9' }, { counts: { all: 1 } }, { confirmed: 'true' }, { owners: [{ email: 'bad' }] }])('rejects malformed envelopes: %j', patch => {
    expect(normalizeGrowthInbox({ ...inbox(), ...patch })).toBeNull();
  });
  const done = { ...inbox(), filter: 'done', rows: [{ cardKey: 'card-a', labKey: 'lab-a', customerId: 'customer-a', name: 'Lab A', town: null, rule: 'R1', period: '2026-10', action: { actionType: 'visit', ownerEmail: 'manager@example.test', result: 'done', note: 'Stock checked', closedOn: '2026-11-03' }, outcome: { status: 'bought', on: '2026-11-06', valuePaise: 820000, daysLeft: null } }] };
  it('accepts all outcome states and rejects unknown statuses/results and fractional paise', () => {
    expect(normalizeGrowthInbox(done)).not.toBeNull();
    const row = done.rows[0];
    for (const outcome of [{ status: 'waiting', on: null, valuePaise: null, daysLeft: 20 }, { status: 'not_bought', on: null, valuePaise: null, daysLeft: null }]) expect(normalizeGrowthInbox({ ...done, rows: [{ ...row, outcome }] })).not.toBeNull();
    for (const outcome of [{ ...row.outcome, status: 'maybe' }, { ...row.outcome, valuePaise: 0.1 }, { ...row.outcome, on: null }, { status: 'waiting', on: null, valuePaise: null, daysLeft: NaN }]) expect(normalizeGrowthInbox({ ...done, rows: [{ ...row, outcome }] })).toBeNull();
    expect(normalizeGrowthInbox({ ...done, rows: [{ ...row, action: { ...row.action, result: 'open' } }] })).toBeNull();
  });
});

describe('Growth decision payloads', () => {
  it('validates review requests, hidden results and agreed volume rates', () => {
    const base = { requestId: accept.requestId, cardKey: 'price-card', decision: 'review' };
    expect(buildGrowthDecision(base)).toEqual(base);
    expect(buildGrowthDecision({ ...base, note: ' Changed price ' })).toEqual({ ...base, note: 'Changed price' });
    for (const note of ['', '   ', null, 1, 'x'.repeat(501)]) expect(buildGrowthDecision({ ...base, note })).toBeNull();
    expect(buildGrowthDecision({ ...base, note: 'x'.repeat(500) })).not.toBeNull();
    expect(buildGrowthDecision({ ...base, category: 'price' })).toBeNull();
    const result = { cardKey: 'price-card', decision: 'review', state: 'hidden' };
    expect(normalizeGrowthDecision(result)).toEqual(result);
    expect(normalizeGrowthDecision({ ...result, state: 'in_progress' })).toBeNull();
    expect(buildGrowthDecision({ ...base, decision: 'reject', category: 'agreed_volume_rate' })).not.toBeNull();
    expect(buildGrowthDecision({ ...base, decision: 'reject', category: 'not_a_category' })).toBeNull();
  });
  it('builds only exact allowed payloads for each decision', () => {
    expect(buildGrowthDecision(accept)).toEqual(accept);
    const base = { requestId: accept.requestId, cardKey: accept.cardKey };
    for (const p of [{ ...base, decision: 'undo' }, { ...base, decision: 'snooze', until: '2w' }, { ...base, decision: 'snooze', until: 'next_run', category: 'unknown', note: 'Later' }, { ...base, decision: 'reject', category: 'price', note: 'Price concern' }]) expect(buildGrowthDecision(p)).toEqual(p);
  });
  it.each([{ extra: true }, { decision: 'delete' }, { requestId: 'bad' }, { actionType: 'call' }, { ownerEmail: 'bad' }, { dueOn: '2026-02-30' }, { detail: 'ab' }, { detail: 'a'.repeat(501) }, { category: 'price' }])('rejects invalid accept fields: %j', patch => expect(buildGrowthDecision({ ...accept, ...patch })).toBeNull());
  it('requires a supported category for reject and allows no extras for undo', () => {
    const base = { requestId: accept.requestId, cardKey: accept.cardKey };
    for (const patch of [{ decision: 'reject' }, { decision: 'reject', category: 'not_regular' }, { decision: 'undo', note: 'why' }, { decision: 'snooze', until: 'forever' }, { decision: 'snooze', until: '1m', category: '' }]) expect(buildGrowthDecision({ ...base, ...patch })).toBeNull();
  });
  it('normalizes decisions strictly', () => {
    const result = { cardKey: 'a', decision: 'accept', state: 'in_progress', actionId: 'action-a' };
    expect(normalizeGrowthDecision(result)).toEqual(result);
    expect(normalizeGrowthDecision({ ...result, decision: 'other' })).toBeNull();
    expect(normalizeGrowthDecision({ ...result, state: 'other' })).toBeNull();
  });
  it('requires a valid server snooze date only for snooze decisions', () => {
    const result = { cardKey: 'a', decision: 'snooze', state: 'snoozed', snoozeUntil: '2026-12-01' };
    expect(normalizeGrowthDecision(result)).toEqual(result);
    for (const snoozeUntil of [undefined, null, '', '2026-02-30', '2026-13-01', '2026-12-01T00:00:00Z']) expect(normalizeGrowthDecision({ ...result, snoozeUntil })).toBeNull();
    for (const decision of ['accept', 'reject', 'undo']) expect(normalizeGrowthDecision({ ...result, decision })).toBeNull();
  });
  it.each(['snooze', 'reject'])('trims optional %s notes and drops whitespace-only notes', decision => {
    const base = { requestId: accept.requestId, cardKey: 'card-a', decision, ...(decision === 'snooze' ? { until: '1m' } : { category: 'price' }) };
    expect(buildGrowthDecision({ ...base, note: '  Ask next week\n' })).toEqual({ ...base, note: 'Ask next week' });
    expect(buildGrowthDecision({ ...base, note: ' \n\t ' })).toEqual(base);
    expect(buildGrowthDecision({ ...base, note: '' })).toEqual(base);
  });
});

describe('Growth rule wording', () => {
  it('matches all four approved reason lines', () => {
    const examples: [Partial<GrowthCard>, string][] = [
      [{}, 'Bought in 7 of the previous 11 months, nothing in Oct · last bought Sep'],
      [{ rule: 'R2', inputs: { monthsBoughtH1: 3, lastBoughtOn: '2026-01-01', typicalPaise: 500 } }, 'Bought in 3 months Nov–Apr, nothing since · last bought Jan'],
      [{ rule: 'R3', inputs: { h1Paise: 8095100, h2Paise: 1285100, dropPct: 84.125 } }, '₹80,951 in Nov–Apr, ₹12,851 in May–Oct (−84%)'],
      [{ rule: 'R4', inputs: { firstMonth: '2026-07', firstPaise: 8880000 } }, 'First bought in Jul (₹88,800), not since'],
    ];
    for (const [patch, expected] of examples) {
      expect(growthReasonLine({ ...card, ...patch } as GrowthCard, '2026-11')).toBe(expected);
      expect(normalizeGrowthInbox({ ...inbox(), rows: [{ ...card, ...patch }] })).not.toBeNull();
    }
  });
  it('derives periods across year boundaries and formats rupees without crore notation', () => {
    expect(growthReasonLine({ ...card, period: '2027-01' }, '2027-02')).toContain('nothing in Jan');
    expect(inboxStake(10000000)).toBe('₹1.0 L');
    expect(inboxStake(9999900)).toBe('₹99,999');
    expect(ruleTitle.R1).toBe('Regular skipped a month');
    expect(ruleLever.R4).toBe('Acquire');
  });
});
