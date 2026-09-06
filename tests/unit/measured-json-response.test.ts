import { describe, expect, it } from 'vitest';
import { measuredJsonResponse } from '../../lib/measured-json-response';

describe('measured JSON responses', () => {
  it('reports UTF-8 transfer size and duration without making private data cacheable', async () => {
    const body = { customer: 'आरोग्य Lab', orders: [1, 2] };
    const expected = new TextEncoder().encode(JSON.stringify(body)).byteLength;
    const response = measuredJsonResponse(body, 100, 112.34);

    expect(response.headers.get('x-stockflow-response-bytes')).toBe(String(expected));
    expect(response.headers.get('server-timing')).toBe('stockflow;dur=12.3');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual(body);
  });

  it('never reports a negative duration when clocks differ', () => {
    expect(measuredJsonResponse({}, 20, 10).headers.get('server-timing')).toBe('stockflow;dur=0.0');
  });
});
