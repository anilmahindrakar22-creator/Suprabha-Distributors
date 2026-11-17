const RELOAD_KEY = 'stockflow:stale-chunk-reload-at';
const RELOAD_WINDOW_MS = 60_000;
const MODULE_FETCH_FAILURE = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i;

export function isStaleChunkError(error: unknown): boolean {
  if (error instanceof Error) {
    return MODULE_FETCH_FAILURE.test(error.message) || error.name === 'ChunkLoadError';
  }
  if (typeof error === 'object' && error !== null) {
    const candidate = error as { message?: unknown; name?: unknown };
    return candidate.name === 'ChunkLoadError'
      || (typeof candidate.message === 'string' && MODULE_FETCH_FAILURE.test(candidate.message));
  }
  return false;
}

export function reloadOnStaleChunk(error: unknown): Promise<never> {
  if (typeof window === 'undefined' || !isStaleChunkError(error)) throw error;

  let stored: string | null;
  try {
    stored = sessionStorage.getItem(RELOAD_KEY);
  } catch {
    throw error;
  }

  if (stored !== null) {
    const timestamp = Number(stored);
    if (Number.isFinite(timestamp) && Date.now() - timestamp < RELOAD_WINDOW_MS) throw error;
  }

  try {
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    throw error;
  }

  window.location.reload();
  return new Promise<never>(() => {});
}
