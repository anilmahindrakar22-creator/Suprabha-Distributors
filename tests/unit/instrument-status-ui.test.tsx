import { describe, expect, it, vi } from 'vitest';
vi.mock('next/link', () => ({ default: 'a' }));
import { renderToStaticMarkup } from 'react-dom/server';
import { InstrumentStatusBadge } from '@/components/instrument-status-badge';
describe('instrument service status presentation', () => {
  it.each([
    ['urgent', 'Urgent service', 'text-red-800'],
    ['attention', 'Service attention', 'text-amber-900'],
    ['clear', 'No open service issues', 'text-emerald-800'],
  ] as const)('shows %s with text, an icon and a distinct color', (status, label, color) => {
    const html = renderToStaticMarkup(<InstrumentStatusBadge status={status} />);
    expect(html).toContain(label); expect(html).toContain(color); expect(html).toContain('<svg');
  });
});
