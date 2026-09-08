import { describe, expect, it } from 'vitest';
import { BoundedJsonRequestError, readBoundedJsonRequest } from '../../lib/bounded-json-request';

async function rejectedStatus(request: Request, maximumBytes?: number) {
  try {
    await readBoundedJsonRequest(request, maximumBytes);
  } catch (error) {
    return error instanceof BoundedJsonRequestError ? error.status : 0;
  }
  return 200;
}

describe('bounded JSON requests', () => {
  it('reads a JSON request within the byte budget', async () => {
    const request = new Request('https://stockflow.test/api/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'test' }) });
    await expect(readBoundedJsonRequest(request)).resolves.toEqual({ action: 'test' });
  });

  it('rejects unsupported media and malformed JSON', async () => {
    expect(await rejectedStatus(new Request('https://stockflow.test/api/orders', { method: 'POST', body: '{}' }))).toBe(415);
    expect(await rejectedStatus(new Request('https://stockflow.test/api/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }))).toBe(400);
  });

  it('rejects both declared and streamed bodies beyond the limit', async () => {
    const declared = new Request('https://stockflow.test/api/orders', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '100' }, body: '{}' });
    expect(await rejectedStatus(declared, 10)).toBe(413);
    const streamed = new Request('https://stockflow.test/api/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: '1234567890' }) });
    expect(await rejectedStatus(streamed, 10)).toBe(413);
  });
});
