import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LeakageCaseHistory, type LeakageCaseHistoryRecord } from '@/components/leakage-case-history';

const event = (overrides: Partial<LeakageCaseHistoryRecord> = {}): LeakageCaseHistoryRecord => ({
  id: 'event-private-123', caseId: 'case-a', action: 'update_case', actor: 'A. Patel', recordedAt: '2026-10-07T10:30:00Z',
  payload: { status: 'investigating' }, ...overrides,
});

describe('leakage case history', () => {
  it('shows only selected-case events with readable action, actor and allowlisted details', () => {
    const html = renderToStaticMarkup(<LeakageCaseHistory caseId="case-a" history={[
      event({ payload: { status: 'investigating', classification: { primaryReason: 'competitor_sourcing', reasonCodes: ['downtime'], confidence: 'suspected', evidenceReference: 'Visit note VN-12' } } }),
      event({ id: 'other-case-event', caseId: 'case-b', actor: 'Other person', payload: { outcome: 'wrong case' } }),
    ]} />);

    expect(html).toContain('<summary');
    expect(html).toContain('Case history');
    expect(html).toContain('Case updated');
    expect(html).toContain('A. Patel');
    expect(html).toContain('investigating');
    expect(html).toContain('Competitor sourcing');
    expect(html).toContain('Instrument downtime');
    expect(html).toContain('Visit note VN-12');
    expect(html).not.toContain('Other person');
    expect(html).not.toContain('wrong case');
    expect(html).not.toContain('case-a');
  });

  it('renders an explicit empty state', () => {
    const html = renderToStaticMarkup(<LeakageCaseHistory caseId="case-a" history={[]} />);
    expect(html).toContain('No case history is available.');
  });

  it('limits display to the newest twenty and says older events are retained', () => {
    const history = Array.from({ length: 21 }, (_, index) => event({ id: `event-${index}`, payload: { outcome: `outcome-${index}` } }));
    const html = renderToStaticMarkup(<LeakageCaseHistory caseId="case-a" history={history} />);
    expect(html).toContain('outcome-0');
    expect(html).toContain('outcome-19');
    expect(html).not.toContain('outcome-20');
    expect(html).toContain('Older events are retained');
  });

  it('reports truncated history and excludes secrets and arbitrary metadata', () => {
    const html = renderToStaticMarkup(<LeakageCaseHistory caseId="case-a" truncated history={[
      event({ payload: { owner: 'M. Shah', expectedActorEmail: 'private@example.com', idempotencyKey: 'secret-key', secret: 'do-not-render', extra: { token: 'hidden-token' } } }),
    ]} />);
    expect(html).toContain('M. Shah');
    expect(html).toContain('Older events are retained');
    expect(html).not.toContain('private@example.com');
    expect(html).not.toContain('secret-key');
    expect(html).not.toContain('do-not-render');
    expect(html).not.toContain('hidden-token');
    expect(html).not.toContain('event-private-123');
  });

});
