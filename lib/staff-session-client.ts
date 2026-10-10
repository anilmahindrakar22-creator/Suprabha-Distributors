// Keep cookie rotation and sign-out ordered across tabs on supported browsers.
export async function withStaffSessionLock<T>(operation: () => Promise<T>): Promise<T> {
  if (!navigator.locks) return operation();
  return navigator.locks.request('stockflow-staff-session', { signal: AbortSignal.timeout(30000) }, operation);
}

let renewal: Promise<boolean> | undefined;
export async function resumeStaffSession(): Promise<boolean> {
  // Do not rotate credentials without cross-tab coordination on older browsers.
  if (!navigator.locks) return false;
  if (renewal) return renewal;
  renewal = withStaffSessionLock(async () => {
    const response = await fetch('/api/staff-auth/refresh', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000),
    });
    if (response.status === 401 || response.status === 403) return false;
    if (!response.ok) throw new Error('Session renewal unavailable');
    const confirmation = await fetch('/api/staff-auth', {
      credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000),
    });
    if (!confirmation.ok) throw new Error('Session verification unavailable');
    const result: unknown = await confirmation.json();
    if (!result || typeof result !== 'object' || !('ok' in result) || result.ok !== true) {
      throw new Error('Session verification unavailable');
    }
    return true;
  }).finally(() => { renewal = undefined; });
  return renewal;
}

export async function checkStaffSession(renew = false): Promise<number | null> {
  if (renew && !await resumeStaffSession()) return null;
  const check = () => fetch('/api/staff-auth', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000) });
  let response = await check();
  if (response.status === 401) {
    if (!await resumeStaffSession()) return null;
    response = await check();
  }
  if (response.status === 403) return null;
  if (!response.ok) throw new Error('Session verification unavailable');
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object' || !('ok' in body) || body.ok !== true ||
      !('renewAfterSeconds' in body) || typeof body.renewAfterSeconds !== 'number' ||
      !Number.isFinite(body.renewAfterSeconds)) throw new Error('Session verification unavailable');
  return Math.max(30, Math.min(3000, body.renewAfterSeconds));
}
