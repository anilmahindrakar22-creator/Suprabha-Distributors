import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LeakageCaseStatus } from '@/components/leakage-case-status';
import type { LeakageCase } from '@/lib/instrument-economics-types';

const statuses: LeakageCase['status'][] = [
  'detected', 'qualified', 'in_progress', 'recovered', 'partially_recovered', 'no_recovery', 'dismissed',
];

describe('leakage case status badge', () => {
  it('renders readable labels and marks each decorative icon hidden from assistive technology', () => {
    const html = renderToStaticMarkup(<>{statuses.map(status => <LeakageCaseStatus key={status} status={status} />)}</>);
    for (const label of ['Detected', 'Qualified', 'In progress', 'Recovered', 'Partially recovered', 'No recovery', 'Dismissed']) {
      expect(html).toContain(label);
    }
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(statuses.length);
    expect(html.match(/focusable="false"/g)).toHaveLength(statuses.length);
  });
});
