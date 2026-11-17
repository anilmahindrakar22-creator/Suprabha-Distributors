import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isStaleChunkError, reloadOnStaleChunk } from '../../lib/stale-chunk-reload';

const RELOAD_KEY = 'stockflow:stale-chunk-reload-at';
const RELOAD_ERROR = new Error('Failed to fetch dynamically imported module: https://x/a.js');

function createStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

function stubBrowser() {
  const storage = createStorage();
  const reload = vi.fn();
  vi.stubGlobal('sessionStorage', storage);
  vi.stubGlobal('window', { location: { reload } });
  return { storage, reload };
}

async function expectSameRejection(action: () => Promise<never>, error: unknown) {
  try {
    await action();
    throw new Error('Expected the action to throw or reject');
  } catch (caught) {
    expect(caught).toBe(error);
  }
}

describe('stale chunk reload', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-17T12:00:00Z'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('recognizes browser module fetch failures and chunk load errors', () => {
    expect(isStaleChunkError(new Error('Failed to fetch dynamically imported module: https://x/a.js'))).toBe(true);
    expect(isStaleChunkError(new Error('error loading dynamically imported module'))).toBe(true);
    expect(isStaleChunkError(new Error('Importing a module script failed.'))).toBe(true);
    expect(isStaleChunkError(new Error('Unable to preload CSS for /a.css'))).toBe(true);
    expect(isStaleChunkError({ name: 'ChunkLoadError', message: 'x' })).toBe(true);
    expect(isStaleChunkError(new Error('boom'))).toBe(false);
    expect(isStaleChunkError(new TypeError('Failed to fetch'))).toBe(false);
    expect(isStaleChunkError(null)).toBe(false);
    expect(isStaleChunkError('Failed to fetch dynamically imported module')).toBe(false);
  });

  it('reloads once and leaves the promise pending', async () => {
    const { storage, reload } = stubBrowser();
    let settled = false;
    const result = reloadOnStaleChunk(RELOAD_ERROR).then(() => { settled = true; }, () => { settled = true; });
    await Promise.resolve();
    expect(reload).toHaveBeenCalledOnce();
    expect(storage.getItem(RELOAD_KEY)).toBe(String(Date.now()));
    expect(settled).toBe(false);
    void result;
  });

  it('rejects a second failure within 60 seconds without reloading', async () => {
    const { reload } = stubBrowser();
    void reloadOnStaleChunk(RELOAD_ERROR);
    await expectSameRejection(() => reloadOnStaleChunk(RELOAD_ERROR), RELOAD_ERROR);
    vi.advanceTimersByTime(10_000);
    await expectSameRejection(() => reloadOnStaleChunk(RELOAD_ERROR), RELOAD_ERROR);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('reloads again after 60 seconds have elapsed', () => {
    const { reload } = stubBrowser();
    void reloadOnStaleChunk(RELOAD_ERROR);
    vi.setSystemTime(new Date(Date.now() + 61_000));
    void reloadOnStaleChunk(RELOAD_ERROR);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('rethrows non-chunk errors without writing or reloading', async () => {
    const { storage, reload } = stubBrowser();
    const error = new Error('boom');
    await expectSameRejection(() => reloadOnStaleChunk(error), error);
    expect(reload).not.toHaveBeenCalled();
    expect(storage.values.size).toBe(0);
  });

  it('rethrows when reading session storage fails', async () => {
    const { reload } = stubBrowser();
    vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('blocked'); } });
    await expectSameRejection(() => reloadOnStaleChunk(RELOAD_ERROR), RELOAD_ERROR);
    expect(reload).not.toHaveBeenCalled();
  });

  it('rethrows when writing session storage fails', async () => {
    const { reload } = stubBrowser();
    vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => { throw new Error('blocked'); } });
    await expectSameRejection(() => reloadOnStaleChunk(RELOAD_ERROR), RELOAD_ERROR);
    expect(reload).not.toHaveBeenCalled();
  });

  it('rethrows when window is unavailable', async () => {
    stubBrowser();
    vi.stubGlobal('window', undefined);
    await expectSameRejection(() => reloadOnStaleChunk(RELOAD_ERROR), RELOAD_ERROR);
  });

  it('guards every lazy factory and preserves the order loader for warming', () => {
    const frame = readFileSync('components/stockflow-frame.tsx', 'utf8');
    const accounts = readFileSync('components/accounts-workspace.tsx', 'utf8');
    for (const source of [frame, accounts]) {
      for (const line of source.split('\n').filter(line => line.includes('lazy('))) {
        expect(line).toContain('.catch(reloadOnStaleChunk)');
      }
    }
    expect(frame).toContain("const loadOrderWorkspace = () => import('./order-workspace').then((module) => ({ default: module.OrderWorkspace }));");
  });
});
