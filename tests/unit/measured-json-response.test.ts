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

  it('reports phases in insertion order followed by JSON serialization', () => {
    const response = measuredJsonResponse({}, 100, 112.34, { auth: 1.26, member: 2, rpc: 30.04 });
    expect(response.headers.get('server-timing')).toMatch(/^stockflow;dur=12\.3, auth;dur=1\.3, member;dur=2\.0, rpc;dur=30\.0, json;dur=\d+\.\d$/);
  });

  it('drops invalid names and non-finite values and clamps negative phases', () => {
    const response = measuredJsonResponse({}, 100, 112.34, { 'Bad Name': 1, ['x'.repeat(17)]: 2, auth: -1, member: NaN, rpc: Infinity });
    expect(response.headers.get('server-timing')).toMatch(/^stockflow;dur=12\.3, auth;dur=0\.0, json;dur=\d+\.\d$/);
  });

  it('respects the supplied response status', () => {
    expect(measuredJsonResponse({}, 100, 112.34, {}, { status: 201 }).status).toBe(201);
  });

  it('preserves the exact serialized body bytes with phases', async () => {
    const body = { customer: 'आरोग्य Lab', orders: [1, 2], nested: { missing: undefined, value: null } };
    const response = measuredJsonResponse(body, 100, 112.34, { auth: 1 });
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new TextEncoder().encode(JSON.stringify(body)));
  });
});
