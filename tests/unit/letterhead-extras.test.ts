import { describe, expect, it } from 'vitest';
import { logoBytes, parseLetterheadExtras, validateLetterheadExtrasCommand } from '../../lib/letterhead-extras';

function logo(type = 'image/png', size = 100) {
  const bytes = new Uint8Array(size);
  bytes.set(type === 'image/png' ? [137, 80, 78, 71, 13, 10, 26, 10] : [255, 216, 255]);
  return { type, base64: btoa(String.fromCharCode(...bytes)) };
}
const extras = { logo: logo(), terms: ['Payment within 30 days'], version: 1 };
const payload = { logo: extras.logo, terms: extras.terms, expectedVersion: 1, idempotencyKey: '00000000-0000-0000-0000-000000000001' };
const command = (p: unknown) => ({ action: 'set_letterhead_extras', payload: p });

describe('letterhead extras contract', () => {
  it('parses exact responses and validates commands', () => {
    expect(parseLetterheadExtras(extras)).toEqual(extras);
    expect(parseLetterheadExtras({ logo: null, terms: [], version: 1 })).toEqual({ logo: null, terms: [], version: 1 });
    expect(validateLetterheadExtrasCommand(command(payload))).toEqual(command(payload));
    expect(validateLetterheadExtrasCommand(command({ ...payload, logo: null, terms: ['  Trim me  '] }))?.payload.terms).toEqual(['Trim me']);
    expect(parseLetterheadExtras({ ...extras, logo: logo('image/jpeg', 40960), terms: Array(5).fill('a'.repeat(200)) })).toBeTruthy();
  });
  it.each([
    { extra: true }, { logo: { ...logo(), type: 'image/gif' } }, { logo: { ...logo(), extra: true } },
    { logo: { type: 'image/png', base64: 'bad%base64' } }, { terms: Array(6).fill('term') },
    { terms: ['first\nsecond'] }, { terms: ['first\rsecond'] }, { terms: ['   '] }, { terms: ['a'.repeat(201)] },
    { terms: [null] }, { terms: Array(1) }, { version: 0 }, { version: 1.5 }, { version: 2147483648 },
  ])('rejects invalid response %j', change => {
    expect(() => parseLetterheadExtras({ ...extras, ...change })).toThrow('Invalid letterhead extras response');
  });
  it('rejects command shape and scalar violations', () => {
    expect(validateLetterheadExtrasCommand({ ...command(payload), extra: true })).toBeNull();
    expect(validateLetterheadExtrasCommand({ ...command(payload), action: 'set_letterhead' })).toBeNull();
    for (const change of [{ extra: true }, { idempotencyKey: 'bad' }, { expectedVersion: 0 }, { expectedVersion: 1.5 },
      { terms: Array(6).fill('t') }, { terms: ['\n'] }, { terms: ['a'.repeat(201)] }, { terms: null }]) {
      expect(validateLetterheadExtrasCommand(command({ ...payload, ...change }))).toBeNull();
    }
    const { logo: _, ...missing } = payload;
    expect(validateLetterheadExtrasCommand(command(missing))).toBeNull();
  });
  it('rejects magic mismatches, invalid base64 and decoded size violations', () => {
    for (const invalid of [{ ...logo('image/jpeg'), type: 'image/png' }, { ...logo(), type: 'image/jpeg' },
      logo('image/png', 99), logo('image/png', 40961), { ...logo(), base64: 'a'.repeat(54620) },
      { ...logo(), base64: '%%%%' }, { ...logo(), base64: logo().base64 + '\n' }]) {
      expect(validateLetterheadExtrasCommand(command({ ...payload, logo: invalid }))).toBeNull();
    }
  });
  it('counts Unicode characters and accepts exactly the maximum decoded size', () => {
    expect(validateLetterheadExtrasCommand(command({ ...payload, logo: logo('image/png', 40960), terms: ['😀'.repeat(200)] }))).not.toBeNull();
    expect(validateLetterheadExtrasCommand(command({ ...payload, terms: ['😀'.repeat(201)] }))).toBeNull();
  });
  it('round-trips bytes for the renderer', () => {
    const parsed = parseLetterheadExtras(extras);
    const bytes = logoBytes(parsed)!;
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(btoa(String.fromCharCode(...bytes))).toBe(extras.logo.base64);
    expect(logoBytes({ ...parsed, logo: null })).toBeNull();
  });
});
